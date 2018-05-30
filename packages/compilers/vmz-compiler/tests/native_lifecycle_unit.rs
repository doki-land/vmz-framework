//! Moved from `src/native/lifecycle.rs` (cargo-cry: tests next to Cargo.toml).

use std::fs;
use vmz_protocol::*;

use vmz_compiler::native::lifecycle::*;

#[test]
fn example_lifecycle_ready() {
    let dir = std::env::temp_dir().join(format!(
        "vmz-nw3-{}",
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    ));
    let _ = fs::create_dir_all(&dir);
    let report = check_native_lifecycle_contract(&dir);
    assert_eq!(report.status, "ready", "{:?}", report.diagnostics);
    assert!(!report.lifecycle.background_equals_destroy);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rejects_background_equals_destroy() {
    let dir = std::env::temp_dir().join(format!(
        "vmz-nw3-bg-{}",
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    ));
    let _ = fs::create_dir_all(&dir);
    let mut p = NativeAppLifecyclePolicy::example();
    p.background_equals_destroy = true;
    fs::write(dir.join("native-lifecycle.json"), p.to_json()).unwrap();
    let report = check_native_lifecycle_contract(&dir);
    assert_eq!(report.status, "failed");
    assert!(
        report.diagnostics.iter().any(|d| d.code.as_deref() == Some(DIAG_BACKGROUND_IS_DESTROY))
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rejects_crash_assumes_js_heap() {
    let dir = std::env::temp_dir().join(format!(
        "vmz-nw3-crash-{}",
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    ));
    let _ = fs::create_dir_all(&dir);
    let mut p = NativeAppLifecyclePolicy::example();
    p.crash_restore_assumes_js_heap = true;
    fs::write(dir.join("native-lifecycle.json"), p.to_json()).unwrap();
    let report = check_native_lifecycle_contract(&dir);
    assert_eq!(report.status, "failed");
    assert!(
        report.diagnostics.iter().any(|d| d.code.as_deref() == Some(DIAG_CRASH_ASSUMES_JS_HEAP))
    );
    let _ = fs::remove_dir_all(&dir);
}
