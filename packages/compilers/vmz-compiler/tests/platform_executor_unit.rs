//! Moved from `src/platform/executor.rs` (cargo-cry: tests next to Cargo.toml).

use std::fs;
use vmz_protocol::*;

use std::path::PathBuf;

use std::time::{SystemTime, UNIX_EPOCH};
use vmz_compiler::platform::executor::*;
use vmz_protocol::{
    EVENT_ENVELOPE_SCHEMA, EXECUTOR_ENVELOPE_HEADER_SCHEMA, EXECUTOR_TRANSACTION_SCHEMA,
    PATCH_BATCH_SCHEMA, PatchBatch,
};

fn tmp(prefix: &str) -> std::path::PathBuf {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let dir = std::env::temp_dir().join(format!("{prefix}{nanos}"));
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn mixed_camera_t42_ready() {
    let dir = tmp("vmz-p2-");
    let report = check_unified_executor(&dir);
    assert_eq!(report.status, "ready");
    assert_eq!(report.scenario.patch_batches.len(), 3);
    assert_eq!(report.scenario.transaction.as_ref().unwrap().transaction_id, "T42");
    let surfaces: Vec<_> =
        report.scenario.patch_batches.iter().map(|b| b.surface_id.as_str()).collect();
    assert!(surfaces.iter().any(|s| s.contains("web")));
    assert!(surfaces.iter().any(|s| s.contains("native")));
    assert!(surfaces.iter().any(|s| s.contains("headless")));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rejects_missing_envelope_ids() {
    let dir = tmp("vmz-p2-ids-");
    let mut sc = ExecutorScenario::mixed_camera_t42_example();
    if let Some(ev) = sc.incoming_event.as_mut() {
        ev.header.application_id.clear();
    }
    fs::write(dir.join("executor-scenario.json"), serde_json::to_string_pretty(&sc).unwrap())
        .unwrap();
    let report = check_unified_executor(&dir);
    assert_eq!(report.status, "failed");
    assert!(
        report.diagnostics.iter().any(|d| d.code.as_deref() == Some(DIAG_MISSING_ENVELOPE_IDS))
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rejects_stale_generation_patches() {
    let dir = tmp("vmz-p2-stale-");
    let mut sc = ExecutorScenario::mixed_camera_t42_example();
    sc.current_generation = 99;
    sc.must_discard_stale = true;
    sc.produced_patches_from_stale = true;
    // keep patch batches → fail
    fs::write(dir.join("executor-scenario.json"), serde_json::to_string_pretty(&sc).unwrap())
        .unwrap();
    let report = check_unified_executor(&dir);
    assert_eq!(report.status, "failed");
    assert!(report.diagnostics.iter().any(|d| d.code.as_deref() == Some(DIAG_STALE_GENERATION)));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rejects_surface_owns_state() {
    let dir = tmp("vmz-p2-own-");
    let mut sc = ExecutorScenario::mixed_camera_t42_example();
    sc.state_slots[0].surface_driver_owns_business_state = true;
    fs::write(dir.join("executor-scenario.json"), serde_json::to_string_pretty(&sc).unwrap())
        .unwrap();
    let report = check_unified_executor(&dir);
    assert_eq!(report.status, "failed");
    assert!(report.diagnostics.iter().any(|d| d.code.as_deref() == Some(DIAG_SURFACE_OWNS_STATE)));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rejects_private_object_crossing() {
    let dir = tmp("vmz-p2-priv-");
    let mut sc = ExecutorScenario::mixed_camera_t42_example();
    sc.patch_batches[0].carries_private_runtime_object = true;
    fs::write(dir.join("executor-scenario.json"), serde_json::to_string_pretty(&sc).unwrap())
        .unwrap();
    let report = check_unified_executor(&dir);
    assert_eq!(report.status, "failed");
    assert!(
        report.diagnostics.iter().any(|d| d.code.as_deref() == Some(DIAG_PRIVATE_OBJECT_CROSSING))
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rejects_split_transaction() {
    let dir = tmp("vmz-p2-split-");
    let mut sc = ExecutorScenario::mixed_camera_t42_example();
    sc.transaction.as_mut().unwrap().split_per_surface = true;
    fs::write(dir.join("executor-scenario.json"), serde_json::to_string_pretty(&sc).unwrap())
        .unwrap();
    let report = check_unified_executor(&dir);
    assert_eq!(report.status, "failed");
    assert!(report.diagnostics.iter().any(|d| d.code.as_deref() == Some(DIAG_SPLIT_TRANSACTION)));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rejects_dispose_not_authoritative() {
    let dir = tmp("vmz-p2-disp-");
    let mut sc = ExecutorScenario::mixed_camera_t42_example();
    sc.driver_unload_cancels_foreign_tasks = true;
    sc.dispose_region = None;
    fs::write(dir.join("executor-scenario.json"), serde_json::to_string_pretty(&sc).unwrap())
        .unwrap();
    let report = check_unified_executor(&dir);
    assert_eq!(report.status, "failed");
    assert!(
        report
            .diagnostics
            .iter()
            .any(|d| d.code.as_deref() == Some(DIAG_DISPOSE_NOT_AUTHORITATIVE))
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rejects_cancel_not_propagated() {
    let dir = tmp("vmz-p2-cancel-");
    let mut sc = ExecutorScenario::mixed_camera_t42_example();
    let header = ExecutorEnvelopeHeader {
        schema: EXECUTOR_ENVELOPE_HEADER_SCHEMA.into(),
        application_id: "app:mixed-camera".into(),
        plan_version: "plan:v1".into(),
        generation: 7,
        transaction_id: "T42".into(),
        region_id: "region:pages/camera:page".into(),
    };
    sc.dispose_region = Some(vmz_protocol::DisposeRegion {
        schema: vmz_protocol::DISPOSE_REGION_SCHEMA.into(),
        header: header.clone(),
        cancels_capabilities: false,
        is_authoritative_terminate: true,
    });
    fs::write(dir.join("executor-scenario.json"), serde_json::to_string_pretty(&sc).unwrap())
        .unwrap();
    let report = check_unified_executor(&dir);
    assert_eq!(report.status, "failed");
    assert!(
        report.diagnostics.iter().any(|d| d.code.as_deref() == Some(DIAG_CANCEL_NOT_PROPAGATED))
    );
    let _ = fs::remove_dir_all(&dir);
    let _ = (
        EVENT_ENVELOPE_SCHEMA,
        EXECUTOR_TRANSACTION_SCHEMA,
        PATCH_BATCH_SCHEMA,
        PatchBatch {
            schema: PATCH_BATCH_SCHEMA.into(),
            header,
            surface_id: "x".into(),
            binding_ids: vec![],
            carries_private_runtime_object: false,
        },
    );
}
