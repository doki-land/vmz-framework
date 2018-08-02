//! Moved from `src/platform/profile.rs` (cargo-cry: tests next to Cargo.toml).

use std::fs;
use vmz_protocol::*;

use std::time::{SystemTime, UNIX_EPOCH};
use vmz_compiler::platform::profile::*;

fn tmp(prefix: &str) -> std::path::PathBuf {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let dir = std::env::temp_dir().join(format!("{prefix}{nanos}"));
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn browser_host_delivery_ready() {
    let dir = tmp("vmz-p0-");
    let report = check_host_profile_protocol(&dir);
    assert_eq!(report.status, vmz_protocol::CheckReportStatus::Ready);
    assert_eq!(report.host_profile.host_id, "vmz.host.browser");
    assert!(report.delivery_profile.resolution_digest.is_some());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rejects_runtime_driver_select() {
    let dir = tmp("vmz-p0-rt-");
    let mut host = HostProfile::browser_example();
    host.constraints.allows_runtime_driver_select = true;
    fs::write(dir.join("host-profile.json"), serde_json::to_string_pretty(&host).unwrap()).unwrap();
    let delivery = DeliveryProfile::browser_bundled_example(&host);
    fs::write(dir.join("delivery-profile.json"), serde_json::to_string_pretty(&delivery).unwrap())
        .unwrap();
    let report = check_host_profile_protocol(&dir);
    assert_eq!(report.status, vmz_protocol::CheckReportStatus::Failed);
    assert!(
        report
            .diagnostics
            .iter()
            .any(|d| d.code_string().as_deref() == Some(DIAG_HOST_PROFILE_INVALID))
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rejects_digest_mismatch() {
    let dir = tmp("vmz-p0-digest-");
    let host = HostProfile::browser_example();
    let mut delivery = DeliveryProfile::browser_bundled_example(&host);
    if let Some(d) = delivery.resolution_digest.as_mut() {
        d.value = "sha256:tampered".into();
    }
    fs::write(dir.join("host-profile.json"), serde_json::to_string_pretty(&host).unwrap()).unwrap();
    fs::write(dir.join("delivery-profile.json"), serde_json::to_string_pretty(&delivery).unwrap())
        .unwrap();
    let report = check_host_profile_protocol(&dir);
    assert_eq!(report.status, vmz_protocol::CheckReportStatus::Failed);
    assert!(
        report
            .diagnostics
            .iter()
            .any(|d| d.code_string().as_deref() == Some(DIAG_RESOLUTION_DIGEST_MISMATCH))
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rejects_core_id_override() {
    let dir = tmp("vmz-p0-core-");
    let foul = ProfileContribution {
        schema: PROFILE_CONTRIBUTION_SCHEMA.into(),
        plugin_namespace: "com.example".into(),
        surface_ids: vec!["vmz.surface.web.main".into()],
        capability_ids: vec![],
        provider_ids: vec![],
    };
    fs::write(dir.join("profile-contribution.json"), serde_json::to_string_pretty(&foul).unwrap())
        .unwrap();
    let report = check_host_profile_protocol(&dir);
    assert_eq!(report.status, vmz_protocol::CheckReportStatus::Failed);
    assert!(
        report
            .diagnostics
            .iter()
            .any(|d| d.code_string().as_deref() == Some(DIAG_CORE_ID_OVERRIDE))
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rejects_unresolved_host_ref() {
    let dir = tmp("vmz-p0-ref-");
    let host = HostProfile::browser_example();
    let mut delivery = DeliveryProfile::browser_bundled_example(&host);
    delivery.host_profile_ref = "vmz.host.missing".into();
    fs::write(dir.join("host-profile.json"), serde_json::to_string_pretty(&host).unwrap()).unwrap();
    fs::write(dir.join("delivery-profile.json"), serde_json::to_string_pretty(&delivery).unwrap())
        .unwrap();
    let report = check_host_profile_protocol(&dir);
    assert_eq!(report.status, vmz_protocol::CheckReportStatus::Failed);
    assert!(
        report
            .diagnostics
            .iter()
            .any(|d| d.code_string().as_deref() == Some(DIAG_HOST_PROFILE_REF_UNRESOLVED))
    );
    let _ = fs::remove_dir_all(&dir);
}
