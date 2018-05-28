//! P5: Cross-Host Conformance algebraic check (doc 13 §4.14).
//!
//! Same fixture on WebSurface, TemplateSurface, and Web+Native mixed host must
//! share stable IDs, state results, and trace invariants. No real adapters.

use std::fs;
use std::path::Path;

use vmz_protocol::{
    CONFORMANCE_CHECK_SCHEMA, CONFORMANCE_FIXTURE_SCHEMA, CONFORMANCE_HOST_RUN_SCHEMA,
    CONFORMANCE_SCENARIO_SCHEMA, CONFORMANCE_STATE_SNAPSHOT_SCHEMA, CONFORMANCE_SURFACE_ROLES,
    CONFORMANCE_TRACE_SCHEMA, ConformanceCheckReport, ConformanceHostRun, ConformanceScenario,
    DIAG_CONFORMANCE_HOST_INCOMPLETE, DIAG_CONFORMANCE_SURFACE_ROLE_MISMATCH,
    DIAG_PRIVATE_OBJECT_CROSSING, DIAG_STABLE_ID_DIVERGENCE, DIAG_STATE_RESULT_DIVERGENCE,
    DIAG_TRACE_INVARIANT_BROKEN, ProfileDiagnostic, ProfileProtocolCatalog,
};

fn diag(path: &str, severity: &str, message: impl Into<String>, code: &str) -> ProfileDiagnostic {
    ProfileDiagnostic {
        path: path.into(),
        severity: severity.into(),
        message: message.into(),
        code: Some(code.into()),
    }
}

fn sorted(ids: &[String]) -> Vec<String> {
    let mut v = ids.to_vec();
    v.sort();
    v.dedup();
    v
}

fn validate_run(
    run: &ConformanceHostRun,
    idx: usize,
    scenario: &ConformanceScenario,
    out: &mut Vec<ProfileDiagnostic>,
) {
    let prefix = format!("scenario.runs[{idx}]");
    if run.schema != CONFORMANCE_HOST_RUN_SCHEMA {
        out.push(diag(
            &format!("{prefix}.schema"),
            "error",
            format!("ConformanceHostRun schema must be `{CONFORMANCE_HOST_RUN_SCHEMA}`"),
            DIAG_CONFORMANCE_HOST_INCOMPLETE,
        ));
    }
    if !CONFORMANCE_SURFACE_ROLES.contains(&run.surface_role.as_str()) {
        out.push(diag(
            &format!("{prefix}.surfaceRole"),
            "error",
            format!(
                "surfaceRole must be one of {}; got `{}`",
                CONFORMANCE_SURFACE_ROLES.join("|"),
                run.surface_role
            ),
            DIAG_CONFORMANCE_SURFACE_ROLE_MISMATCH,
        ));
    }
    match run.surface_role.as_str() {
        "web" => {
            if run.surface_kinds != ["web".to_string()] {
                out.push(diag(
                    &format!("{prefix}.surfaceKinds"),
                    "error",
                    "web role requires surfaceKinds=[web] only",
                    DIAG_CONFORMANCE_SURFACE_ROLE_MISMATCH,
                ));
            }
        }
        "template" => {
            if run.surface_kinds != ["template".to_string()] {
                out.push(diag(
                    &format!("{prefix}.surfaceKinds"),
                    "error",
                    "template role requires surfaceKinds=[template] only",
                    DIAG_CONFORMANCE_SURFACE_ROLE_MISMATCH,
                ));
            }
        }
        "mixed" => {
            let has_web = run.surface_kinds.iter().any(|k| k == "web");
            let has_native = run.surface_kinds.iter().any(|k| k == "native");
            if !has_web || !has_native {
                out.push(diag(
                    &format!("{prefix}.surfaceKinds"),
                    "error",
                    "mixed role requires both web and native surfaceKinds",
                    DIAG_CONFORMANCE_SURFACE_ROLE_MISMATCH,
                ));
            }
        }
        _ => {}
    }
    if run.surface_ids.is_empty() {
        out.push(diag(
            &format!("{prefix}.surfaceIds"),
            "error",
            "host run must list surfaceIds",
            DIAG_CONFORMANCE_HOST_INCOMPLETE,
        ));
    }
    if run.uses_private_runtime_objects {
        out.push(diag(
            &format!("{prefix}.usesPrivateRuntimeObjects"),
            "error",
            "cross-host conformance must not rely on private runtime objects",
            DIAG_PRIVATE_OBJECT_CROSSING,
        ));
    }

    let expected_ids = scenario.fixture.all_stable_ids();
    let observed = sorted(&run.observed_stable_ids);
    if observed != expected_ids {
        out.push(diag(
            &format!("{prefix}.observedStableIds"),
            "error",
            format!("stable IDs diverge from fixture: expected {expected_ids:?}, got {observed:?}"),
            DIAG_STABLE_ID_DIVERGENCE,
        ));
    }

    if run.state.schema != CONFORMANCE_STATE_SNAPSHOT_SCHEMA {
        out.push(diag(
            &format!("{prefix}.state.schema"),
            "error",
            format!("state schema must be `{CONFORMANCE_STATE_SNAPSHOT_SCHEMA}`"),
            DIAG_STATE_RESULT_DIVERGENCE,
        ));
    }
    if run.state.normalized_pairs() != scenario.expected_state.normalized_pairs() {
        out.push(diag(
            &format!("{prefix}.state"),
            "error",
            "state result diverges from expected fixture state",
            DIAG_STATE_RESULT_DIVERGENCE,
        ));
    }

    if run.trace.schema != CONFORMANCE_TRACE_SCHEMA {
        out.push(diag(
            &format!("{prefix}.trace.schema"),
            "error",
            format!("trace schema must be `{CONFORMANCE_TRACE_SCHEMA}`"),
            DIAG_TRACE_INVARIANT_BROKEN,
        ));
    }
    let expected_keys = sorted(&scenario.expected_trace_invariant_keys);
    let got_keys = sorted(&run.trace.invariant_keys);
    if got_keys != expected_keys {
        out.push(diag(
            &format!("{prefix}.trace.invariantKeys"),
            "error",
            format!("trace invariant keys diverge: expected {expected_keys:?}, got {got_keys:?}"),
            DIAG_TRACE_INVARIANT_BROKEN,
        ));
    }
    for (ei, ev) in run.trace.events.iter().enumerate() {
        if ev.transaction_id.trim().is_empty() || ev.kind.trim().is_empty() {
            out.push(diag(
                &format!("{prefix}.trace.events[{ei}]"),
                "error",
                "trace event requires kind + transactionId",
                DIAG_TRACE_INVARIANT_BROKEN,
            ));
        }
        for sid in &ev.stable_ids {
            if !expected_ids.iter().any(|e| e == sid) {
                out.push(diag(
                    &format!("{prefix}.trace.events[{ei}].stableIds"),
                    "error",
                    format!("trace references unknown stable id `{sid}`"),
                    DIAG_STABLE_ID_DIVERGENCE,
                ));
            }
        }
    }
}

/// Validate a ConformanceScenario against P5 hard contracts.
pub fn validate_conformance_scenario(
    scenario: &ConformanceScenario,
    out: &mut Vec<ProfileDiagnostic>,
) {
    if scenario.schema != CONFORMANCE_SCENARIO_SCHEMA {
        out.push(diag(
            "scenario.schema",
            "error",
            format!("ConformanceScenario schema must be `{CONFORMANCE_SCENARIO_SCHEMA}`"),
            DIAG_CONFORMANCE_HOST_INCOMPLETE,
        ));
    }
    if scenario.fixture.schema != CONFORMANCE_FIXTURE_SCHEMA {
        out.push(diag(
            "scenario.fixture.schema",
            "error",
            format!("ConformanceFixture schema must be `{CONFORMANCE_FIXTURE_SCHEMA}`"),
            DIAG_CONFORMANCE_HOST_INCOMPLETE,
        ));
    }
    if scenario.fixture.application_id.trim().is_empty()
        || scenario.fixture.plan_version.trim().is_empty()
        || scenario.fixture.all_stable_ids().is_empty()
    {
        out.push(diag(
            "scenario.fixture",
            "error",
            "fixture requires applicationId, planVersion, and stable IDs",
            DIAG_CONFORMANCE_HOST_INCOMPLETE,
        ));
    }
    if scenario.expected_state.slot_values.is_empty()
        || scenario.expected_trace_invariant_keys.is_empty()
    {
        out.push(diag(
            "scenario",
            "error",
            "expectedState + expectedTraceInvariantKeys required",
            DIAG_CONFORMANCE_HOST_INCOMPLETE,
        ));
    }
    for role in CONFORMANCE_SURFACE_ROLES {
        if !scenario.runs.iter().any(|r| r.surface_role == *role) {
            out.push(diag(
                "scenario.runs",
                "error",
                format!("P5 requires host run with surfaceRole `{role}`"),
                DIAG_CONFORMANCE_HOST_INCOMPLETE,
            ));
        }
    }
    for (i, run) in scenario.runs.iter().enumerate() {
        validate_run(run, i, scenario, out);
    }
}

fn load_json<T: serde::de::DeserializeOwned>(
    path: &Path,
    label: &str,
    diags: &mut Vec<ProfileDiagnostic>,
) -> Option<T> {
    if !path.is_file() {
        return None;
    }
    match fs::read_to_string(path) {
        Ok(text) => match serde_json::from_str::<T>(&text) {
            Ok(v) => Some(v),
            Err(e) => {
                diags.push(diag(
                    label,
                    "error",
                    format!("invalid JSON: {e}"),
                    DIAG_CONFORMANCE_HOST_INCOMPLETE,
                ));
                None
            }
        },
        Err(e) => {
            diags.push(diag(
                label,
                "error",
                format!("cannot read: {e}"),
                DIAG_CONFORMANCE_HOST_INCOMPLETE,
            ));
            None
        }
    }
}

/// P5 check for a workspace root (optional conformance-scenario.json).
pub fn check_p5_cross_host_conformance(root: &Path) -> ConformanceCheckReport {
    let mut diagnostics = Vec::new();
    let catalog = ProfileProtocolCatalog::v0();
    let scenario = load_json::<ConformanceScenario>(
        &root.join("conformance-scenario.json"),
        "conformance-scenario.json",
        &mut diagnostics,
    )
    .unwrap_or_else(ConformanceScenario::counter_cross_host_example);

    validate_conformance_scenario(&scenario, &mut diagnostics);

    if let Some(foul) = load_json::<ConformanceScenario>(
        &root.join("conformance-scenario.foul.json"),
        "conformance-scenario.foul.json",
        &mut diagnostics,
    ) {
        validate_conformance_scenario(&foul, &mut diagnostics);
    }

    let failed = diagnostics.iter().any(|d| d.severity == "error");
    ConformanceCheckReport {
        schema: CONFORMANCE_CHECK_SCHEMA.into(),
        catalog,
        scenario,
        diagnostics,
        status: if failed { "failed".into() } else { "ready".into() },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn tmp(prefix: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("{prefix}{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn counter_cross_host_ready() {
        let dir = tmp("vmz-p5-");
        let report = check_p5_cross_host_conformance(&dir);
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
        let report = check_p5_cross_host_conformance(&dir);
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
        let report = check_p5_cross_host_conformance(&dir);
        assert_eq!(report.status, "failed");
        assert!(
            report
                .diagnostics
                .iter()
                .any(|d| d.code.as_deref() == Some(DIAG_STATE_RESULT_DIVERGENCE))
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
        let report = check_p5_cross_host_conformance(&dir);
        assert_eq!(report.status, "failed");
        assert!(
            report
                .diagnostics
                .iter()
                .any(|d| d.code.as_deref() == Some(DIAG_TRACE_INVARIANT_BROKEN))
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
        let report = check_p5_cross_host_conformance(&dir);
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
        let report = check_p5_cross_host_conformance(&dir);
        assert_eq!(report.status, "failed");
        assert!(
            report
                .diagnostics
                .iter()
                .any(|d| d.code.as_deref() == Some(DIAG_CONFORMANCE_SURFACE_ROLE_MISMATCH))
        );
        let _ = fs::remove_dir_all(dir);
    }
}
