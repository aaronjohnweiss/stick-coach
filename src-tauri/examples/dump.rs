//! Debug tool: prints every change in a port's buttons/C-stick for 20 s. Close Stick Coach first.
//! Usage: cargo run --example dump [port 1-4]
use rusb::{Context, UsbContext};
use std::time::{Duration, Instant};

fn main() {
    let port: usize = std::env::args().nth(1).and_then(|s| s.parse().ok()).unwrap_or(1) - 1;
    let ctx = Context::new().unwrap();
    let h = ctx.open_device_with_vid_pid(0x057e, 0x0337).expect("adapter not found/accessible");
    let _ = h.set_auto_detach_kernel_driver(true);
    h.claim_interface(0).expect("claim failed (is Stick Coach or Dolphin running?)");
    h.write_interrupt(0x02, &[0x13], Duration::from_secs(1)).unwrap();
    let t0 = Instant::now();
    let mut last = [0u8; 9];
    let mut buf = [0u8; 37];
    println!("Hold A+Z, press D-pad Up on port {}. Running 20 s...", port + 1);
    while t0.elapsed() < Duration::from_secs(20) {
        if h.read_interrupt(0x81, &mut buf, Duration::from_millis(250)).is_err() { continue; }
        let o = 1 + 9 * port;
        let cur: [u8; 9] = buf[o..o + 9].try_into().unwrap();
        if cur != last {
            println!("{:6}ms stat={:02x} b1={:08b} b2={:08b} L=({:3},{:3}) C=({:3},{:3}) cx-128={:4} cy-128={:4}",
                t0.elapsed().as_millis(), cur[0], cur[1], cur[2], cur[3], cur[4], cur[5], cur[6],
                cur[5] as i32 - 128, cur[6] as i32 - 128);
            last = cur;
        }
    }
}
