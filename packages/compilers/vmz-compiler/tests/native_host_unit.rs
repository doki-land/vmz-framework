//! Moved from `src/native/host.rs` (cargo-cry: tests next to Cargo.toml).

use std::fs;
use vmz_protocol::*;

use vmz_compiler::native::host::*;

#[test]
fn rejects_window_native_pattern() {
    let mut diags = Vec::new();
    scan_bridge_text_for_arbitrary("x", "window.native = {}", &mut diags);
    assert!(diags.iter().any(|d| d.code.as_deref() == Some(DIAG_ARBITRARY_BRIDGE)));
}

#[test]
fn example_profile_is_ready() {
    let dir = std::env::temp_dir().join(format!(
        "vmz-nw0-{}",
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    ));
    let _ = fs::create_dir_all(&dir);
    let report = check_native_host_contract(&dir);
    assert_eq!(report.status, "ready", "{:?}", report.diagnostics);
    assert!(report.webview_deployment.reuses_browser_lowering);
    let _ = fs::remove_dir_all(&dir);
}
