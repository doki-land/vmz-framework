//! Moved from `src/native/bridge.rs` (cargo-cry: tests next to Cargo.toml).

use std::fs;
use vmz_protocol::*;

use vmz_compiler::native::bridge::*;

#[test]
fn example_bridge_ready() {
    let dir = std::env::temp_dir().join(format!(
        "vmz-nw2-{}",
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    ));
    let _ = fs::create_dir_all(&dir);
    let report = check_native_bridge_contract(&dir);
    assert_eq!(report.status, vmz_protocol::CheckReportStatus::Ready, "{:?}", report.diagnostics);
    assert_eq!(report.stub_catalog.allowlist.len(), 5);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rejects_missing_nonce() {
    let dir = std::env::temp_dir().join(format!(
        "vmz-nw2-nonce-{}",
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    ));
    let _ = fs::create_dir_all(&dir);
    let mut call = NativeCapabilityCall::camera_capture_example();
    call.nonce.clear();
    fs::write(dir.join("native-bridge.calls.json"), serde_json::to_string(&[call]).unwrap())
        .unwrap();
    let report = check_native_bridge_contract(&dir);
    assert_eq!(report.status, vmz_protocol::CheckReportStatus::Failed);
    assert!(
        report.diagnostics.iter().any(|d| d.code_string().as_deref() == Some(DIAG_MISSING_NONCE))
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rejects_not_allowlisted() {
    let dir = std::env::temp_dir().join(format!(
        "vmz-nw2-allow-{}",
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    ));
    let _ = fs::create_dir_all(&dir);
    let mut call = NativeCapabilityCall::camera_capture_example();
    call.capability_id = "payment.charge".into();
    fs::write(dir.join("native-bridge.calls.json"), serde_json::to_string(&[call]).unwrap())
        .unwrap();
    let report = check_native_bridge_contract(&dir);
    assert_eq!(report.status, vmz_protocol::CheckReportStatus::Failed);
    assert!(
        report
            .diagnostics
            .iter()
            .any(|d| d.code_string().as_deref() == Some(DIAG_CALL_NOT_ALLOWLISTED))
    );
    let _ = fs::remove_dir_all(&dir);
}
