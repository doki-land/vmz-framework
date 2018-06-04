//! Lifecycle / Recovery algebraic check (architecture notes / ).
//!
//! Browser / Mini / Native map to unified lifecycle; crash recovery reattaches
//! surfaces without duplicating owner. No real DOM/iOS/Android adapters.

use std::fs;
use std::path::Path;

use vmz_protocol::{
    DIAG_LIFECYCLE_MAPPING_INCOMPLETE, DIAG_LIFECYCLE_UNPROVEN, DIAG_PERSISTENCE_WINDOW_INVALID,
    DIAG_RECOVERY_ASSUMES_HEAP, DIAG_RECOVERY_DUPLICATES_OWNER, LIFECYCLE_RECOVERY_CHECK_SCHEMA,
    LIFECYCLE_SCENARIO_SCHEMA, LifecycleHostKind, LifecycleRecoveryCheckReport, LifecycleScenario,
    PersistenceWindow, ProfileDiagnostic, ProfileProtocolCatalog, RECOVERY_POLICY_SCHEMA,
    UnifiedLifecycleEvent,
};

fn diag(
    path: &str,
    severity: vmz_protocol::Severity,
    message: impl Into<String>,
    code: &str,
) -> ProfileDiagnostic {
    ProfileDiagnostic::with_severity(path, severity, message).with_code(code)
}

/// Validate a [`LifecycleScenario`] against unified lifecycle mapping contracts.
///
/// Requires browser/mini/native hosts and a binding for every unified lifecycle
/// event; appends diagnostics into `out`.
pub fn validate_lifecycle_scenario(scenario: &LifecycleScenario, out: &mut Vec<ProfileDiagnostic>) {
    if scenario.schema != LIFECYCLE_SCENARIO_SCHEMA {
        out.push(diag(
            "scenario.schema",
            vmz_protocol::Severity::Error,
            format!("LifecycleScenario schema must be `{LIFECYCLE_SCENARIO_SCHEMA}`"),
            DIAG_LIFECYCLE_UNPROVEN,
        ));
    }

    for kind in LifecycleHostKind::ALL {
        if !scenario.hosts.iter().any(|h| h.host_kind == *kind) {
            out.push(diag(
                "scenario.hosts",
                vmz_protocol::Severity::Error,
                format!("P3 requires hostKind `{}` (browser/mini/native)", kind.as_str()),
                DIAG_LIFECYCLE_MAPPING_INCOMPLETE,
            ));
        }
    }

    for (i, host) in scenario.hosts.iter().enumerate() {
        if host.host_id.trim().is_empty() {
            out.push(diag(
                &format!("scenario.hosts[{i}].hostId"),
                vmz_protocol::Severity::Error,
                "hostId required",
                DIAG_LIFECYCLE_UNPROVEN,
            ));
        }
        for ev in UnifiedLifecycleEvent::ALL {
            let binding = host.lifecycle.iter().find(|b| b.vmz_lifecycle == *ev);
            match binding {
                None => out.push(diag(
                    &format!("scenario.hosts[{i}].lifecycle"),
                    vmz_protocol::Severity::Error,
                    format!(
                        "host `{}` missing LifecycleBinding for unified event `{}`",
                        host.host_id,
                        ev.as_str()
                    ),
                    DIAG_LIFECYCLE_MAPPING_INCOMPLETE,
                )),
                Some(b) => {
                    if b.host_event.trim().is_empty() {
                        out.push(diag(
                            &format!("scenario.hosts[{i}].lifecycle.{}.hostEvent", ev.as_str()),
                            vmz_protocol::Severity::Error,
                            "hostEvent required (mapping is not rename-only)",
                            DIAG_LIFECYCLE_UNPROVEN,
                        ));
                    }
                    if *ev == UnifiedLifecycleEvent::Recover {
                        if !b.may_be_missing_after_crash {
                            out.push(diag(
                                &format!(
                                    "scenario.hosts[{i}].lifecycle.recover.mayBeMissingAfterCrash"
                                ),
                                vmz_protocol::Severity::Error,
                                "recover must declare mayBeMissingAfterCrash=true",
                                DIAG_LIFECYCLE_UNPROVEN,
                            ));
                        }
                        if !matches!(
                            b.persistence_window,
                            PersistenceWindow::Crash | PersistenceWindow::Owner
                        ) {
                            out.push(diag(
                                &format!("scenario.hosts[{i}].lifecycle.recover.persistenceWindow"),
                                vmz_protocol::Severity::Error,
                                "recover persistenceWindow must be crash|owner",
                                DIAG_PERSISTENCE_WINDOW_INVALID,
                            ));
                        }
                    }
                    if *ev == UnifiedLifecycleEvent::Dispose && !b.cancels_capabilities {
                        out.push(diag(
                            &format!("scenario.hosts[{i}].lifecycle.dispose.cancelsCapabilities"),
                            vmz_protocol::Severity::Error,
                            "dispose must cancel in-flight capabilities",
                            DIAG_LIFECYCLE_UNPROVEN,
                        ));
                    }
                }
            }
        }
    }

    // Mapping table must cover every host × unified event (artifact refs only).
    for host in &scenario.hosts {
        for ev in UnifiedLifecycleEvent::ALL {
            let hit = scenario.mapping_table.entries.iter().any(|e| {
                e.host_id == host.host_id
                    && e.vmz_lifecycle == *ev
                    && !e.host_event.trim().is_empty()
            });
            if !hit {
                out.push(diag(
                    "scenario.mappingTable",
                    vmz_protocol::Severity::Error,
                    format!(
                        "LifecycleMappingTable missing `{}/{}` mapping",
                        host.host_id,
                        ev.as_str()
                    ),
                    DIAG_LIFECYCLE_MAPPING_INCOMPLETE,
                ));
            }
        }
    }

    let recovery = &scenario.recovery;
    if recovery.schema != RECOVERY_POLICY_SCHEMA {
        out.push(diag(
            "scenario.recovery.schema",
            vmz_protocol::Severity::Error,
            format!("RecoveryPolicy schema must be `{RECOVERY_POLICY_SCHEMA}`"),
            DIAG_LIFECYCLE_UNPROVEN,
        ));
    }
    if recovery.owner_region_id.trim().is_empty() {
        out.push(diag(
            "scenario.recovery.ownerRegionId",
            vmz_protocol::Severity::Error,
            "recovery requires single ownerRegionId",
            DIAG_LIFECYCLE_UNPROVEN,
        ));
    }
    if !recovery.rematerialize_from_snapshot || !recovery.rematerialize_plan_generation {
        out.push(diag(
            "scenario.recovery",
            vmz_protocol::Severity::Error,
            "crash recovery must rematerialize from Core Executor snapshot + plan generation",
            DIAG_LIFECYCLE_UNPROVEN,
        ));
    }
    if recovery.assumes_js_heap_survived {
        out.push(diag(
            "scenario.recovery.assumesJsHeapSurvived",
            vmz_protocol::Severity::Error,
            "crash restore must not assume JS heap survived",
            DIAG_RECOVERY_ASSUMES_HEAP,
        ));
    }
    if recovery.creates_new_owner_on_recover {
        out.push(diag(
            "scenario.recovery.createsNewOwnerOnRecover",
            vmz_protocol::Severity::Error,
            "crash recovery must not duplicate owner — reattach to existing RegionId",
            DIAG_RECOVERY_DUPLICATES_OWNER,
        ));
    }
    if recovery.surface_ids_to_reattach.is_empty() {
        out.push(diag(
            "scenario.recovery.surfaceIdsToReattach",
            vmz_protocol::Severity::Error,
            "recovery must list surfaces to reattach",
            DIAG_LIFECYCLE_UNPROVEN,
        ));
    }
    if !recovery.cancels_capabilities_only_on_owner_dispose {
        out.push(diag(
            "scenario.recovery.cancelsCapabilitiesOnlyOnOwnerDispose",
            vmz_protocol::Severity::Error,
            "surface crash must not cancel capabilities owned by the page owner",
            DIAG_LIFECYCLE_UNPROVEN,
        ));
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
                    DIAG_LIFECYCLE_UNPROVEN,
                ));
                None
            }
        },
        Err(e) => {
            diags.push(diag(
                label,
                vmz_protocol::Severity::Error,
                format!("cannot read: {e}"),
                DIAG_LIFECYCLE_UNPROVEN,
            ));
            None
        }
    }
}

/// Run lifecycle recovery checks for a workspace root.
///
/// Loads optional `lifecycle-scenario.json` (and foul twin); falls back to the
/// built-in cross-host recovery example when the primary file is absent.
pub fn check_lifecycle_recovery(root: &Path) -> LifecycleRecoveryCheckReport {
    let mut diagnostics = Vec::new();
    let catalog = ProfileProtocolCatalog::v0();
    let scenario = load_json::<LifecycleScenario>(
        &root.join("lifecycle-scenario.json"),
        "lifecycle-scenario.json",
        &mut diagnostics,
    )
    .unwrap_or_else(LifecycleScenario::cross_host_recovery_example);

    validate_lifecycle_scenario(&scenario, &mut diagnostics);

    if let Some(foul) = load_json::<LifecycleScenario>(
        &root.join("lifecycle-scenario.foul.json"),
        "lifecycle-scenario.foul.json",
        &mut diagnostics,
    ) {
        validate_lifecycle_scenario(&foul, &mut diagnostics);
    }

    let failed = diagnostics.iter().any(|d| d.is_error());
    LifecycleRecoveryCheckReport {
        schema: LIFECYCLE_RECOVERY_CHECK_SCHEMA.into(),
        catalog,
        scenario,
        diagnostics,
        status: vmz_protocol::CheckReportStatus::from_failed(failed),
    }
}
