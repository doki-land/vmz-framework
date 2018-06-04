//! Cross-Host Conformance algebraic check (architecture notes).
//!
//! Same fixture on WebSurface, TemplateSurface, and Web+Native mixed host must
//! share stable IDs, state results, and trace invariants. No real adapters.

use std::fs;
use std::path::Path;

use vmz_protocol::{
    CONFORMANCE_CHECK_SCHEMA, CONFORMANCE_FIXTURE_SCHEMA, CONFORMANCE_HOST_RUN_SCHEMA,
    CONFORMANCE_SCENARIO_SCHEMA, CONFORMANCE_STATE_SNAPSHOT_SCHEMA, CONFORMANCE_TRACE_SCHEMA,
    ConformanceCheckReport, ConformanceHostRun, ConformanceScenario, ConformanceSurfaceRole,
    DIAG_CONFORMANCE_HOST_INCOMPLETE, DIAG_CONFORMANCE_SURFACE_ROLE_MISMATCH,
    DIAG_PRIVATE_OBJECT_CROSSING, DIAG_STABLE_ID_DIVERGENCE, DIAG_STATE_RESULT_DIVERGENCE,
    DIAG_TRACE_INVARIANT_BROKEN, ProfileDiagnostic, ProfileProtocolCatalog, SurfaceKind,
};

fn diag(
    path: &str,
    severity: vmz_protocol::Severity,
    message: impl Into<String>,
    code: &str,
) -> ProfileDiagnostic {
    ProfileDiagnostic::with_severity(path, severity, message).with_code(code)
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
            vmz_protocol::Severity::Error,
            format!("ConformanceHostRun schema must be `{CONFORMANCE_HOST_RUN_SCHEMA}`"),
            DIAG_CONFORMANCE_HOST_INCOMPLETE,
        ));
    }
    // Closed [`ConformanceSurfaceRole`] validates at deserialize.
    match run.surface_role {
        ConformanceSurfaceRole::Web => {
            if run.surface_kinds != [SurfaceKind::Web] {
                out.push(diag(
                    &format!("{prefix}.surfaceKinds"),
                    vmz_protocol::Severity::Error,
                    "web role requires surfaceKinds=[web] only",
                    DIAG_CONFORMANCE_SURFACE_ROLE_MISMATCH,
                ));
            }
        }
        ConformanceSurfaceRole::Template => {
            if run.surface_kinds != [SurfaceKind::Template] {
                out.push(diag(
                    &format!("{prefix}.surfaceKinds"),
                    vmz_protocol::Severity::Error,
                    "template role requires surfaceKinds=[template] only",
                    DIAG_CONFORMANCE_SURFACE_ROLE_MISMATCH,
                ));
            }
        }
        ConformanceSurfaceRole::Mixed => {
            let has_web = run.surface_kinds.contains(&SurfaceKind::Web);
            let has_native = run.surface_kinds.contains(&SurfaceKind::Native);
            if !has_web || !has_native {
                out.push(diag(
                    &format!("{prefix}.surfaceKinds"),
                    vmz_protocol::Severity::Error,
                    "mixed role requires both web and native surfaceKinds",
                    DIAG_CONFORMANCE_SURFACE_ROLE_MISMATCH,
                ));
            }
        }
    }
    if run.surface_ids.is_empty() {
        out.push(diag(
            &format!("{prefix}.surfaceIds"),
            vmz_protocol::Severity::Error,
            "host run must list surfaceIds",
            DIAG_CONFORMANCE_HOST_INCOMPLETE,
        ));
    }
    if run.uses_private_runtime_objects {
        out.push(diag(
            &format!("{prefix}.usesPrivateRuntimeObjects"),
            vmz_protocol::Severity::Error,
            "cross-host conformance must not rely on private runtime objects",
            DIAG_PRIVATE_OBJECT_CROSSING,
        ));
    }

    let expected_ids = scenario.fixture.all_stable_ids();
    let observed = sorted(&run.observed_stable_ids);
    if observed != expected_ids {
        out.push(diag(
            &format!("{prefix}.observedStableIds"),
            vmz_protocol::Severity::Error,
            format!("stable IDs diverge from fixture: expected {expected_ids:?}, got {observed:?}"),
            DIAG_STABLE_ID_DIVERGENCE,
        ));
    }

    if run.state.schema != CONFORMANCE_STATE_SNAPSHOT_SCHEMA {
        out.push(diag(
            &format!("{prefix}.state.schema"),
            vmz_protocol::Severity::Error,
            format!("state schema must be `{CONFORMANCE_STATE_SNAPSHOT_SCHEMA}`"),
            DIAG_STATE_RESULT_DIVERGENCE,
        ));
    }
    if run.state.normalized_pairs() != scenario.expected_state.normalized_pairs() {
        out.push(diag(
            &format!("{prefix}.state"),
            vmz_protocol::Severity::Error,
            "state result diverges from expected fixture state",
            DIAG_STATE_RESULT_DIVERGENCE,
        ));
    }

    if run.trace.schema != CONFORMANCE_TRACE_SCHEMA {
        out.push(diag(
            &format!("{prefix}.trace.schema"),
            vmz_protocol::Severity::Error,
            format!("trace schema must be `{CONFORMANCE_TRACE_SCHEMA}`"),
            DIAG_TRACE_INVARIANT_BROKEN,
        ));
    }
    let expected_keys = sorted(&scenario.expected_trace_invariant_keys);
    let got_keys = sorted(&run.trace.invariant_keys);
    if got_keys != expected_keys {
        out.push(diag(
            &format!("{prefix}.trace.invariantKeys"),
            vmz_protocol::Severity::Error,
            format!("trace invariant keys diverge: expected {expected_keys:?}, got {got_keys:?}"),
            DIAG_TRACE_INVARIANT_BROKEN,
        ));
    }
    for (ei, ev) in run.trace.events.iter().enumerate() {
        if ev.transaction_id.trim().is_empty() || ev.kind.trim().is_empty() {
            out.push(diag(
                &format!("{prefix}.trace.events[{ei}]"),
                vmz_protocol::Severity::Error,
                "trace event requires kind + transactionId",
                DIAG_TRACE_INVARIANT_BROKEN,
            ));
        }
        for sid in &ev.stable_ids {
            if !expected_ids.iter().any(|e| e == sid) {
                out.push(diag(
                    &format!("{prefix}.trace.events[{ei}].stableIds"),
                    vmz_protocol::Severity::Error,
                    format!("trace references unknown stable id `{sid}`"),
                    DIAG_STABLE_ID_DIVERGENCE,
                ));
            }
        }
    }
}

/// Validate a [`ConformanceScenario`] against schema and stable-id contracts.
///
/// Appends diagnostics for bad schemas, incomplete host fixtures, and trace
/// references that do not resolve to known stable ids.
pub fn validate_conformance_scenario(
    scenario: &ConformanceScenario,
    out: &mut Vec<ProfileDiagnostic>,
) {
    if scenario.schema != CONFORMANCE_SCENARIO_SCHEMA {
        out.push(diag(
            "scenario.schema",
            vmz_protocol::Severity::Error,
            format!("ConformanceScenario schema must be `{CONFORMANCE_SCENARIO_SCHEMA}`"),
            DIAG_CONFORMANCE_HOST_INCOMPLETE,
        ));
    }
    if scenario.fixture.schema != CONFORMANCE_FIXTURE_SCHEMA {
        out.push(diag(
            "scenario.fixture.schema",
            vmz_protocol::Severity::Error,
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
            vmz_protocol::Severity::Error,
            "fixture requires applicationId, planVersion, and stable IDs",
            DIAG_CONFORMANCE_HOST_INCOMPLETE,
        ));
    }
    if scenario.expected_state.slot_values.is_empty()
        || scenario.expected_trace_invariant_keys.is_empty()
    {
        out.push(diag(
            "scenario",
            vmz_protocol::Severity::Error,
            "expectedState + expectedTraceInvariantKeys required",
            DIAG_CONFORMANCE_HOST_INCOMPLETE,
        ));
    }
    for role in ConformanceSurfaceRole::ALL {
        if !scenario.runs.iter().any(|r| r.surface_role == *role) {
            out.push(diag(
                "scenario.runs",
                vmz_protocol::Severity::Error,
                format!("conformance requires host run with surfaceRole `{role}`"),
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
                    vmz_protocol::Severity::Error,
                    format!("invalid JSON: {e}"),
                    DIAG_CONFORMANCE_HOST_INCOMPLETE,
                ));
                None
            }
        },
        Err(e) => {
            diags.push(diag(
                label,
                vmz_protocol::Severity::Error,
                format!("cannot read: {e}"),
                DIAG_CONFORMANCE_HOST_INCOMPLETE,
            ));
            None
        }
    }
}

/// Run cross-host conformance checks for a workspace root.
///
/// Loads optional `conformance-scenario.json` (and foul twin); falls back to the
/// built-in counter example when the primary file is absent.
pub fn check_cross_host_conformance(root: &Path) -> ConformanceCheckReport {
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

    let failed = diagnostics.iter().any(|d| d.is_error());
    ConformanceCheckReport {
        schema: CONFORMANCE_CHECK_SCHEMA.into(),
        catalog,
        scenario,
        diagnostics,
        status: vmz_protocol::CheckReportStatus::from_failed(failed),
    }
}
