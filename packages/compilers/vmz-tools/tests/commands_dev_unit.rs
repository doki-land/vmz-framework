//! Moved from `src/commands/dev.rs` (cargo-cry: tests next to Cargo.toml).

use std::fs;
use vmz_tools::commands::dev::*;

#[test]
fn fingerprint_changes_when_file_updates() {
    let dir = std::env::temp_dir().join(format!("vmz-dev-fp-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let file = dir.join("x.vmz");
    fs::write(&file, "a").unwrap();
    let a = src_fingerprint(&dir).unwrap();
    thread::sleep(Duration::from_millis(20));
    fs::write(&file, "b").unwrap();
    let b = src_fingerprint(&dir).unwrap();
    assert_ne!(a, b);
    let _ = fs::remove_dir_all(&dir);
}
