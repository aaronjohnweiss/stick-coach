//! GameCube adapter (057e:0337) reader. Replaces WebUSB, which OS webviews do not provide.
use rusb::{Context, Direction, TransferType, UsbContext};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread::JoinHandle;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub const GC_VID: u16 = 0x057e;
pub const GC_PID: u16 = 0x0337;
const PACKET_LEN: usize = 37;

/// Raw bytes for one controller port; JS subtracts 128 from the stick values.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Port {
    pub connected: bool,
    pub b1: u8,
    pub b2: u8,
    pub lx: u8,
    pub ly: u8,
    pub cx: u8,
    pub cy: u8,
    pub l: u8,
    pub r: u8,
}

pub fn parse_packet(buf: &[u8]) -> Option<[Port; 4]> {
    if buf.len() < PACKET_LEN || buf[0] != 0x21 {
        return None;
    }
    let port = |i: usize| {
        let o = 1 + 9 * i;
        Port {
            connected: (buf[o] >> 4) != 0,
            b1: buf[o + 1],
            b2: buf[o + 2],
            lx: buf[o + 3],
            ly: buf[o + 4],
            cx: buf[o + 5],
            cy: buf[o + 6],
            l: buf[o + 7],
            r: buf[o + 8],
        }
    };
    Some([port(0), port(1), port(2), port(3)])
}

/// Name of another local process that has the adapter's device node open (Linux only; best effort).
#[cfg(target_os = "linux")]
fn holder_of(bus: u8, addr: u8) -> Option<String> {
    let node = std::fs::canonicalize(format!("/dev/bus/usb/{bus:03}/{addr:03}")).ok()?;
    let me = std::process::id().to_string();
    for entry in std::fs::read_dir("/proc").ok()?.flatten() {
        let pid = entry.file_name().to_string_lossy().to_string();
        if pid == me || !pid.bytes().all(|b| b.is_ascii_digit()) {
            continue;
        }
        let Ok(fds) = std::fs::read_dir(entry.path().join("fd")) else { continue };
        for fd in fds.flatten() {
            if std::fs::read_link(fd.path()).map_or(false, |l| l == node) {
                let name = std::fs::read_to_string(entry.path().join("comm")).unwrap_or_default();
                return Some(format!("{} (PID {pid})", name.trim()));
            }
        }
    }
    None
}

#[cfg(not(target_os = "linux"))]
fn holder_of(_bus: u8, _addr: u8) -> Option<String> {
    None
}

struct Running {
    stop: std::sync::Arc<AtomicBool>,
    handle: JoinHandle<()>,
}

#[derive(Default)]
pub struct Adapter(Mutex<Option<Running>>);

impl Adapter {
    pub fn start(&self, app: AppHandle) -> Result<(), String> {
        let mut slot = self.0.lock().map_err(|e| e.to_string())?;
        if slot.as_ref().map_or(false, |r| !r.handle.is_finished()) {
            return Err("Adapter already started".into());
        }
        if let Some(done) = slot.take() {
            let _ = done.handle.join(); // reader exited after an unplug
        }
        // Open on this thread so errors reach the caller.
        let ctx = Context::new().map_err(|e| e.to_string())?;
        let handle = ctx
            .open_device_with_vid_pid(GC_VID, GC_PID)
            .ok_or("GameCube adapter (057e:0337) not found or not accessible. See Help: driver / permissions.")?;
        let _ = handle.set_auto_detach_kernel_driver(true);
        let cfg = handle
            .device()
            .active_config_descriptor()
            .map_err(|e| e.to_string())?;
        let iface = cfg.interfaces().next().ok_or("Adapter has no interface")?;
        let iface_num = iface.number();
        let desc = iface.descriptors().next().ok_or("Adapter has no interface descriptor")?;
        let mut ep_in = None;
        let mut ep_out = None;
        for e in desc.endpoint_descriptors() {
            if e.transfer_type() != TransferType::Interrupt {
                continue;
            }
            match e.direction() {
                Direction::In => ep_in = Some(e.address()),
                Direction::Out => ep_out = Some(e.address()),
            }
        }
        let (ep_in, ep_out) = ep_in.zip(ep_out).ok_or("Adapter endpoints not found")?;
        if let Err(e) = handle.claim_interface(iface_num) {
            let dev = handle.device();
            return Err(match holder_of(dev.bus_number(), dev.address()) {
                Some(who) => format!("The adapter is in use by {who}. Close it and try again."),
                None => format!("Could not claim adapter (another program using it?): {e}"),
            });
        }
        handle
            .write_interrupt(ep_out, &[0x13], Duration::from_millis(1000))
            .map_err(|e| e.to_string())?;

        let stop = std::sync::Arc::new(AtomicBool::new(false));
        let stop_t = stop.clone();
        let join = std::thread::spawn(move || {
            let _ctx = ctx; // keep the context alive for the handle
            // Must be a multiple of the endpoint's max packet size (37), or Linux reports Overflow.
            let mut buf = [0u8; PACKET_LEN];
            while !stop_t.load(Ordering::Relaxed) {
                match handle.read_interrupt(ep_in, &mut buf, Duration::from_millis(250)) {
                    Ok(n) => {
                        if let Some(ports) = parse_packet(&buf[..n]) {
                            let _ = app.emit("adapter-sample", ports);
                        }
                    }
                    Err(rusb::Error::Timeout) => {}
                    Err(e) => {
                        if !stop_t.load(Ordering::Relaxed) {
                            let _ = app.emit("adapter-error", e.to_string());
                        }
                        break;
                    }
                }
            }
            let _ = handle.release_interface(iface_num);
        });
        *slot = Some(Running { stop, handle: join });
        Ok(())
    }

    pub fn stop(&self) {
        let running = self.0.lock().ok().and_then(|mut s| s.take());
        if let Some(r) = running {
            r.stop.store(true, Ordering::Relaxed);
            let _ = r.handle.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_four_ports() {
        let mut b = [0u8; 37];
        b[0] = 0x21;
        b[1] = 0x10; // port 0 connected
        b[4] = 200; // lx
        b[5] = 100; // ly
        b[10 + 3] = 7; // port 1 (disconnected) lx
        let p = parse_packet(&b).unwrap();
        assert!(p[0].connected && !p[1].connected);
        assert_eq!((p[0].lx, p[0].ly), (200, 100));
        assert_eq!(p[1].lx, 7);
    }

    #[test]
    fn rejects_bad_packets() {
        assert!(parse_packet(&[0x21; 10]).is_none());
        assert!(parse_packet(&[0u8; 37]).is_none());
    }
}
