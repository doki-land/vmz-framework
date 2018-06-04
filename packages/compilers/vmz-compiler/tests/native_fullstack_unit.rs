//! Moved from `src/native/fullstack.rs` (cargo-cry: tests next to Cargo.toml).

use std::fs;
use vmz_protocol::*;

use vmz_compiler::native::fullstack::*;

#[test]
fn example_fullstack_ready() {
    let dir = std::env::temp_dir().join(format!(
        "vmz-nw4-{}",
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    ));
    let _ = fs::create_dir_all(&dir);
    let report = check_native_fullstack_contract(&dir);
    assert_eq!(report.status, vmz_protocol::CheckReportStatus::Ready, "{:?}", report.diagnostics);
    assert_eq!(report.fullstack.server_transport.scheme, "#server");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rejects_bridge_bypasses_server() {
    let dir = std::env::temp_dir().join(format!(
        "vmz-nw4-bypass-{}",
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    ));
    let _ = fs::create_dir_all(&dir);
    let mut p = NativeFullstackProfile::example();
    p.server_transport.bridge_bypasses_server = true;
    fs::write(dir.join("native-fullstack.json"), p.to_json()).unwrap();
    let report = check_native_fullstack_contract(&dir);
    assert_eq!(report.status, vmz_protocol::CheckReportStatus::Failed);
    assert!(
        report
            .diagnostics
            .iter()
            .any(|d| d.code_string().as_deref() == Some(DIAG_BRIDGE_BYPASSES_SERVER))
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rejects_remote_ssr_without_integrity() {
    let dir = std::env::temp_dir().join(format!(
        "vmz-nw4-remote-{}",
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    ));
    let _ = fs::create_dir_all(&dir);
    let mut p = NativeFullstackProfile::example();
    p.ssr.mode = ContentDeliveryMode::Remote;
    p.ssr.integrity.clear();
    fs::write(dir.join("native-fullstack.json"), p.to_json()).unwrap();
    let report = check_native_fullstack_contract(&dir);
    assert_eq!(report.status, vmz_protocol::CheckReportStatus::Failed);
    assert!(
        report
            .diagnostics
            .iter()
            .any(|d| d.code_string().as_deref() == Some(DIAG_REMOTE_WITHOUT_INTEGRITY))
    );
    let _ = fs::remove_dir_all(&dir);
}
