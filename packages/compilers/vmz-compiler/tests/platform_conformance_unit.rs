//! Moved from `src/platform/conformance.rs` (cargo-cry: tests next to Cargo.toml).

use std::fs;
use vmz_protocol::*;

use std::path::PathBuf;

use std::time::{SystemTime, UNIX_EPOCH};
use vmz_compiler::platform::conformance::*;

fn tmp(prefix: &str) -> std::path::PathBuf {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let dir = std::env::temp_dir().join(format!("{prefix}{nanos}"));
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn counter_cross_host_ready() {
    let dir = tmp("vmz-p5-");
    let report = check_cross_host_conformance(&dir);
    assert_eq!(report.status, "ready");
    assert_eq!(report.scenario.runs.len(), 3);
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn reject_stable_id_divergence() {
    let dir = tmp("vmz-p5-id-");
    let mut s = ConformanceScenario::counter_cross_host_example();
    s.runs[0].observed_stable_ids.push("binding:host-private".into());
    fs::write(dir.join("conformance-scenario.json"), serde_json::to_string_pretty(&s).unwrap())
        .unwrap();
    let report = check_cross_host_conformance(&dir);
    assert_eq!(report.status, "failed");
    assert!(
        report.diagnostics.iter().any(|d| d.code.as_deref() == Some(DIAG_STABLE_ID_DIVERGENCE))
    );
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn reject_state_divergence() {
    let dir = tmp("vmz-p5-state-");
    let mut s = ConformanceScenario::counter_cross_host_example();
    s.runs[1].state.slot_values[0].value = "99".into();
    fs::write(dir.join("conformance-scenario.json"), serde_json::to_string_pretty(&s).unwrap())
        .unwrap();
    let report = check_cross_host_conformance(&dir);
    assert_eq!(report.status, "failed");
    assert!(
        report.diagnostics.iter().any(|d| d.code.as_deref() == Some(DIAG_STATE_RESULT_DIVERGENCE))
    );
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn reject_trace_invariant_broken() {
    let dir = tmp("vmz-p5-trace-");
    let mut s = ConformanceScenario::counter_cross_host_example();
    s.runs[2].trace.invariant_keys.pop();
    fs::write(dir.join("conformance-scenario.json"), serde_json::to_string_pretty(&s).unwrap())
        .unwrap();
    let report = check_cross_host_conformance(&dir);
    assert_eq!(report.status, "failed");
    assert!(
        report.diagnostics.iter().any(|d| d.code.as_deref() == Some(DIAG_TRACE_INVARIANT_BROKEN))
    );
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn reject_missing_surface_role() {
    let dir = tmp("vmz-p5-role-");
    let mut s = ConformanceScenario::counter_cross_host_example();
    s.runs.retain(|r| r.surface_role != "template");
    fs::write(dir.join("conformance-scenario.json"), serde_json::to_string_pretty(&s).unwrap())
        .unwrap();
    let report = check_cross_host_conformance(&dir);
    assert_eq!(report.status, "failed");
    assert!(
        report
            .diagnostics
            .iter()
            .any(|d| d.code.as_deref() == Some(DIAG_CONFORMANCE_HOST_INCOMPLETE))
    );
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn reject_mixed_without_native() {
    let dir = tmp("vmz-p5-mixed-");
    let mut s = ConformanceScenario::counter_cross_host_example();
    let mixed = s.runs.iter_mut().find(|r| r.surface_role == "mixed").unwrap();
    mixed.surface_kinds = vec!["web".into()];
    fs::write(dir.join("conformance-scenario.json"), serde_json::to_string_pretty(&s).unwrap())
        .unwrap();
    let report = check_cross_host_conformance(&dir);
    assert_eq!(report.status, "failed");
    assert!(
        report
            .diagnostics
            .iter()
            .any(|d| d.code.as_deref() == Some(DIAG_CONFORMANCE_SURFACE_ROLE_MISMATCH))
    );
    let _ = fs::remove_dir_all(dir);
}
