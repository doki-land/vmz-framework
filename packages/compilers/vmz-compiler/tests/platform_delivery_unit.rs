//! Moved from `src/platform/delivery.rs` (cargo-cry: tests next to Cargo.toml).

use std::fs;
use vmz_protocol::*;

use std::path::PathBuf;

use std::time::{SystemTime, UNIX_EPOCH};
use vmz_compiler::platform::delivery::*;

fn tmp(prefix: &str) -> std::path::PathBuf {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let dir = std::env::temp_dir().join(format!("{prefix}{nanos}"));
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn cross_delivery_proof_ready() {
    let dir = tmp("vmz-p4-");
    let report = check_delivery_proof(&dir);
    assert_eq!(report.status, vmz_protocol::CheckReportStatus::Ready);
    assert_eq!(report.scenario.units.len(), 3);
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn reject_constraint_exceeded() {
    let dir = tmp("vmz-p4-bytes-");
    let mut s = DeliveryProofScenario::cross_delivery_proof_example();
    s.units[0].proof.artifact.estimated_package_bytes = u64::MAX;
    fs::write(dir.join("delivery-proof-scenario.json"), serde_json::to_string_pretty(&s).unwrap())
        .unwrap();
    let report = check_delivery_proof(&dir);
    assert_eq!(report.status, vmz_protocol::CheckReportStatus::Failed);
    assert!(
        report
            .diagnostics
            .iter()
            .any(|d| d.code_string().as_deref() == Some(DIAG_DELIVERY_CONSTRAINT_EXCEEDED))
    );
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn reject_plan_version_mismatch() {
    let dir = tmp("vmz-p4-plan-");
    let mut s = DeliveryProofScenario::cross_delivery_proof_example();
    s.units[1].proof.plan_version = "plan.stale".into();
    fs::write(dir.join("delivery-proof-scenario.json"), serde_json::to_string_pretty(&s).unwrap())
        .unwrap();
    let report = check_delivery_proof(&dir);
    assert_eq!(report.status, vmz_protocol::CheckReportStatus::Failed);
    assert!(
        report
            .diagnostics
            .iter()
            .any(|d| d.code_string().as_deref() == Some(DIAG_HOST_PLAN_VERSION_MISMATCH))
    );
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn reject_copies_semantic_ir() {
    let dir = tmp("vmz-p4-ir-");
    let mut s = DeliveryProofScenario::cross_delivery_proof_example();
    s.units[0].proof.artifact.copies_semantic_ir = true;
    fs::write(dir.join("delivery-proof-scenario.json"), serde_json::to_string_pretty(&s).unwrap())
        .unwrap();
    let report = check_delivery_proof(&dir);
    assert_eq!(report.status, vmz_protocol::CheckReportStatus::Failed);
    assert!(
        report
            .diagnostics
            .iter()
            .any(|d| d.code_string().as_deref() == Some(DIAG_PROOF_COPIES_SEMANTIC_IR))
    );
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn reject_update_without_reproof() {
    let dir = tmp("vmz-p4-upd-");
    let mut s = DeliveryProofScenario::cross_delivery_proof_example();
    s.units[0].proof.update_policy.requires_reproof_on_semantic_change = false;
    fs::write(dir.join("delivery-proof-scenario.json"), serde_json::to_string_pretty(&s).unwrap())
        .unwrap();
    let report = check_delivery_proof(&dir);
    assert_eq!(report.status, vmz_protocol::CheckReportStatus::Failed);
    assert!(
        report
            .diagnostics
            .iter()
            .any(|d| d.code_string().as_deref() == Some(DIAG_UPDATE_WITHOUT_REPROOF))
    );
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn reject_insecure_remote() {
    let dir = tmp("vmz-p4-sec-");
    let mut s = DeliveryProofScenario::cross_delivery_proof_example();
    s.units[2].delivery.asset_strategy = ContentDeliveryMode::Remote;
    s.units[2].proof.security_policy.requires_integrity_for_remote = false;
    s.units[2].proof.security_policy.allows_arbitrary_remote = true;
    fs::write(dir.join("delivery-proof-scenario.json"), serde_json::to_string_pretty(&s).unwrap())
        .unwrap();
    let report = check_delivery_proof(&dir);
    assert_eq!(report.status, vmz_protocol::CheckReportStatus::Failed);
    assert!(
        report
            .diagnostics
            .iter()
            .any(|d| d.code_string().as_deref() == Some(DIAG_SECURITY_POLICY_INSECURE))
    );
    let _ = fs::remove_dir_all(dir);
}
