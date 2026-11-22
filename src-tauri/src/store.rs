//! Snapshot file storage: one JSON file in the app data folder, replaced atomically with a one-step backup.
use std::fs;
use std::path::Path;

const MAX_BYTES: usize = 20 * 1024 * 1024;

pub fn read_opt(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Could not read {}: {e}", path.display())),
    }
}

pub fn write_atomic(path: &Path, data: &str) -> Result<(), String> {
    if data.len() > MAX_BYTES {
        return Err("Snapshot data is too large".into());
    }
    serde_json::from_str::<serde_json::Value>(data).map_err(|e| format!("Refusing to save invalid JSON: {e}"))?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, data).map_err(|e| format!("Could not write {}: {e}", tmp.display()))?;
    if path.exists() {
        let _ = fs::copy(path, path.with_extension("json.bak"));
    }
    fs::rename(&tmp, path).map_err(|e| format!("Could not replace {}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("stick-coach-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn missing_file_is_none_and_roundtrip_works() {
        let d = dir("rt");
        let p = d.join("sub").join("snapshots.json");
        assert_eq!(read_opt(&p).unwrap(), None);
        write_atomic(&p, "{\"version\":1,\"snapshots\":[]}").unwrap();
        assert_eq!(read_opt(&p).unwrap().unwrap(), "{\"version\":1,\"snapshots\":[]}");
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn second_save_keeps_a_backup_and_bad_json_is_refused() {
        let d = dir("bak");
        let p = d.join("snapshots.json");
        write_atomic(&p, "{\"a\":1}").unwrap();
        write_atomic(&p, "{\"a\":2}").unwrap();
        assert_eq!(fs::read_to_string(p.with_extension("json.bak")).unwrap(), "{\"a\":1}");
        assert!(write_atomic(&p, "not json").is_err());
        assert_eq!(read_opt(&p).unwrap().unwrap(), "{\"a\":2}"); // untouched
        let _ = fs::remove_dir_all(&d);
    }
}
