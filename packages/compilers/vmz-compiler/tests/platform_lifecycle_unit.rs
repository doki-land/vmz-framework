//! Moved from `src/platform/lifecycle.rs` (cargo-cry: tests next to Cargo.toml).

use std::fs;
use vmz_protocol::*;

use std::path::PathBuf;

use std::time::{SystemTime, UNIX_EPOCH};
use vmz_compiler::platform::lifecycle::*;

fn tmp(prefix: &str) -> std::path::PathBuf {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let dir = std::env::temp_dir().join(format!("{prefix}{nanos}"));
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn cross_host_recovery_ready() {
    let dir = tmp("vmz-p3-");
    let report = check_lifecycle_recovery(&dir);
    assert_eq!(report.status, "ready");
    assert_eq!(report.scenario.hosts.len(), 3);
    assert!(!report.scenario.recovery.creates_new_owner_on_recover);
    assert!(!report.scenario.recovery.assumes_js_heap_survived);
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn reject_duplicate_owner() {
    let dir = tmp("vmz-p3-dup-");
    let mut s = LifecycleScenario::cross_host_recovery_example();
    s.recovery.creates_new_owner_on_recover = true;
    fs::write(dir.join("lifecycle-scenario.json"), serde_json::to_string_pretty(&s).unwrap())
        .unwrap();
    let report = check_lifecycle_recovery(&dir);
    assert_eq!(report.status, "failed");
    assert!(
        report
            .diagnostics
            .iter()
            .any(|d| d.code.as_deref() == Some(DIAG_RECOVERY_DUPLICATES_OWNER))
    );
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn reject_assumes_heap() {
    let dir = tmp("vmz-p3-heap-");
    let mut s = LifecycleScenario::cross_host_recovery_example();
    s.recovery.assumes_js_heap_survived = true;
    fs::write(dir.join("lifecycle-scenario.json"), serde_json::to_string_pretty(&s).unwrap())
        .unwrap();
    let report = check_lifecycle_recovery(&dir);
    assert_eq!(report.status, "failed");
    assert!(
        report.diagnostics.iter().any(|d| d.code.as_deref() == Some(DIAG_RECOVERY_ASSUMES_HEAP))
    );
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn reject_missing_host_kind() {
    let dir = tmp("vmz-p3-host-");
    let mut s = LifecycleScenario::cross_host_recovery_example();
    s.hosts.retain(|h| h.host_kind != "mini");
    s.mapping_table = vmz_protocol::LifecycleMappingTable::from_hosts(&s.hosts);
    fs::write(dir.join("lifecycle-scenario.json"), serde_json::to_string_pretty(&s).unwrap())
        .unwrap();
    let report = check_lifecycle_recovery(&dir);
    assert_eq!(report.status, "failed");
    assert!(
        report
            .diagnostics
            .iter()
            .any(|d| d.code.as_deref() == Some(DIAG_LIFECYCLE_MAPPING_INCOMPLETE))
    );
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn reject_invalid_persistence() {
    let dir = tmp("vmz-p3-persist-");
    let mut s = LifecycleScenario::cross_host_recovery_example();
    s.hosts[0].lifecycle[0].persistence_window = "heap".into();
    s.mapping_table = vmz_protocol::LifecycleMappingTable::from_hosts(&s.hosts);
    fs::write(dir.join("lifecycle-scenario.json"), serde_json::to_string_pretty(&s).unwrap())
        .unwrap();
    let report = check_lifecycle_recovery(&dir);
    assert_eq!(report.status, "failed");
    assert!(
        report
            .diagnostics
            .iter()
            .any(|d| d.code.as_deref() == Some(DIAG_PERSISTENCE_WINDOW_INVALID))
    );
    let _ = fs::remove_dir_all(dir);
}
