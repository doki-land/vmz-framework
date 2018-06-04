//! Moved from `src/native/surface.rs` (cargo-cry: tests next to Cargo.toml).

use std::fs;
use vmz_protocol::*;

use vmz_compiler::native::surface::*;

#[test]
fn example_camera_preview_ready() {
    let dir = std::env::temp_dir().join(format!(
        "vmz-nw5-{}",
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    ));
    let _ = fs::create_dir_all(&dir);
    let report = check_native_surface_contract(&dir);
    assert_eq!(report.status, vmz_protocol::CheckReportStatus::Ready, "{:?}", report.diagnostics);
    assert_eq!(report.surface.kind, NativeSurfaceKind::Camera);
    assert!(!report.surface.confused_with_capability);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rejects_implicit_state_share() {
    let dir = std::env::temp_dir().join(format!(
        "vmz-nw5-share-{}",
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    ));
    let _ = fs::create_dir_all(&dir);
    let mut s = NativeSurfaceManifest::camera_preview_example();
    s.shares_implicit_webview_state = true;
    fs::write(dir.join("native-surface.json"), s.to_json()).unwrap();
    let report = check_native_surface_contract(&dir);
    assert_eq!(report.status, vmz_protocol::CheckReportStatus::Failed);
    assert!(
        report
            .diagnostics
            .iter()
            .any(|d| d.code_string().as_deref() == Some(DIAG_IMPLICIT_STATE_SHARE))
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rejects_surface_as_capability() {
    let dir = std::env::temp_dir().join(format!(
        "vmz-nw5-cap-{}",
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    ));
    let _ = fs::create_dir_all(&dir);
    let mut s = NativeSurfaceManifest::camera_preview_example();
    s.confused_with_capability = true;
    fs::write(dir.join("native-surface.json"), s.to_json()).unwrap();
    let report = check_native_surface_contract(&dir);
    assert_eq!(report.status, vmz_protocol::CheckReportStatus::Failed);
    assert!(
        report
            .diagnostics
            .iter()
            .any(|d| d.code_string().as_deref() == Some(DIAG_SURFACE_IS_CAPABILITY))
    );
    let _ = fs::remove_dir_all(&dir);
}
