//! P3: Lifecycle / Recovery algebraic check (doc 13 §4.8 / §4.14).
//!
//! Browser / Mini / Native map to unified lifecycle; crash recovery reattaches
//! surfaces without duplicating owner. No real DOM/iOS/Android adapters.

use std::fs;
use std::path::Path;

use vmz_protocol::{
    DIAG_LIFECYCLE_MAPPING_INCOMPLETE, DIAG_LIFECYCLE_UNPROVEN, DIAG_PERSISTENCE_WINDOW_INVALID,
    DIAG_RECOVERY_ASSUMES_HEAP, DIAG_RECOVERY_DUPLICATES_OWNER, LIFECYCLE_HOST_KINDS,
    LIFECYCLE_RECOVERY_CHECK_SCHEMA, LIFECYCLE_SCENARIO_SCHEMA, LifecycleRecoveryCheckReport,
    LifecycleScenario, PERSISTENCE_WINDOWS, ProfileDiagnostic, ProfileProtocolCatalog,
    RECOVERY_POLICY_SCHEMA, UNIFIED_LIFECYCLE_EVENTS,
};

fn diag(path: &str, severity: &str, message: impl Into<String>, code: &str) -> ProfileDiagnostic {
    ProfileDiagnostic {
        path: path.into(),
        severity: severity.into(),
        message: message.into(),
        code: Some(code.into()),
    }
}

/// Validate a LifecycleScenario against P3 hard contracts.
pub fn validate_lifecycle_scenario(scenario: &LifecycleScenario, out: &mut Vec<ProfileDiagnostic>) {
    if scenario.schema != LIFECYCLE_SCENARIO_SCHEMA {
        out.push(diag(
            "scenario.schema",
            "error",
            format!("LifecycleScenario schema must be `{LIFECYCLE_SCENARIO_SCHEMA}`"),
            DIAG_LIFECYCLE_UNPROVEN,
        ));
    }

    for kind in LIFECYCLE_HOST_KINDS {
        if !scenario.hosts.iter().any(|h| h.host_kind == *kind) {
            out.push(diag(
                "scenario.hosts",
                "error",
                format!("P3 requires hostKind `{kind}` (browser/mini/native)"),
                DIAG_LIFECYCLE_MAPPING_INCOMPLETE,
            ));
        }
    }

    for (i, host) in scenario.hosts.iter().enumerate() {
        if host.host_id.trim().is_empty() {
            out.push(diag(
                &format!("scenario.hosts[{i}].hostId"),
                "error",
                "hostId required",
                DIAG_LIFECYCLE_UNPROVEN,
            ));
        }
        if !LIFECYCLE_HOST_KINDS.contains(&host.host_kind.as_str()) {
            out.push(diag(
                &format!("scenario.hosts[{i}].hostKind"),
                "error",
                format!("unknown hostKind `{}`", host.host_kind),
                DIAG_LIFECYCLE_UNPROVEN,
            ));
        }
        for ev in UNIFIED_LIFECYCLE_EVENTS {
            let binding = host.lifecycle.iter().find(|b| b.vmz_lifecycle == *ev);
            match binding {
                None => out.push(diag(
                    &format!("scenario.hosts[{i}].lifecycle"),
                    "error",
                    format!(
                        "host `{}` missing LifecycleBinding for unified event `{ev}`",
                        host.host_id
                    ),
                    DIAG_LIFECYCLE_MAPPING_INCOMPLETE,
                )),
                Some(b) => {
                    if b.host_event.trim().is_empty() {
                        out.push(diag(
                            &format!("scenario.hosts[{i}].lifecycle.{ev}.hostEvent"),
                            "error",
                            "hostEvent required (mapping is not rename-only)",
                            DIAG_LIFECYCLE_UNPROVEN,
                        ));
                    }
                    let window = b.persistence_window.trim();
                    if window.is_empty() || !PERSISTENCE_WINDOWS.contains(&window) {
                        out.push(diag(
                            &format!("scenario.hosts[{i}].lifecycle.{ev}.persistenceWindow"),
                            "error",
                            format!(
                                "persistenceWindow must be one of {}; got `{window}`",
                                PERSISTENCE_WINDOWS.join("|")
                            ),
                            DIAG_PERSISTENCE_WINDOW_INVALID,
                        ));
                    }
                    if *ev == "recover" {
                        if !b.may_be_missing_after_crash {
                            out.push(diag(
                                &format!(
                                    "scenario.hosts[{i}].lifecycle.recover.mayBeMissingAfterCrash"
                                ),
                                "error",
                                "recover must declare mayBeMissingAfterCrash=true",
                                DIAG_LIFECYCLE_UNPROVEN,
                            ));
                        }
                        if window != "crash" && window != "owner" {
                            out.push(diag(
                                &format!("scenario.hosts[{i}].lifecycle.recover.persistenceWindow"),
                                "error",
                                "recover persistenceWindow must be crash|owner",
                                DIAG_PERSISTENCE_WINDOW_INVALID,
                            ));
                        }
                    }
                    if *ev == "dispose" && !b.cancels_capabilities {
                        out.push(diag(
                            &format!("scenario.hosts[{i}].lifecycle.dispose.cancelsCapabilities"),
                            "error",
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
        for ev in UNIFIED_LIFECYCLE_EVENTS {
            let hit = scenario.mapping_table.entries.iter().any(|e| {
                e.host_id == host.host_id
                    && e.vmz_lifecycle == *ev
                    && !e.host_event.trim().is_empty()
            });
            if !hit {
                out.push(diag(
                    "scenario.mappingTable",
                    "error",
                    format!("LifecycleMappingTable missing `{}/{}` mapping", host.host_id, ev),
                    DIAG_LIFECYCLE_MAPPING_INCOMPLETE,
                ));
            }
        }
    }

    let recovery = &scenario.recovery;
    if recovery.schema != RECOVERY_POLICY_SCHEMA {
        out.push(diag(
            "scenario.recovery.schema",
            "error",
            format!("RecoveryPolicy schema must be `{RECOVERY_POLICY_SCHEMA}`"),
            DIAG_LIFECYCLE_UNPROVEN,
        ));
    }
    if recovery.owner_region_id.trim().is_empty() {
        out.push(diag(
            "scenario.recovery.ownerRegionId",
            "error",
            "recovery requires single ownerRegionId",
            DIAG_LIFECYCLE_UNPROVEN,
        ));
    }
    if !recovery.rematerialize_from_snapshot || !recovery.rematerialize_plan_generation {
        out.push(diag(
            "scenario.recovery",
            "error",
            "crash recovery must rematerialize from Core Executor snapshot + plan generation",
            DIAG_LIFECYCLE_UNPROVEN,
        ));
    }
    if recovery.assumes_js_heap_survived {
        out.push(diag(
            "scenario.recovery.assumesJsHeapSurvived",
            "error",
            "crash restore must not assume JS heap survived",
            DIAG_RECOVERY_ASSUMES_HEAP,
        ));
    }
    if recovery.creates_new_owner_on_recover {
        out.push(diag(
            "scenario.recovery.createsNewOwnerOnRecover",
            "error",
            "crash recovery must not duplicate owner — reattach to existing RegionId",
            DIAG_RECOVERY_DUPLICATES_OWNER,
        ));
    }
    if recovery.surface_ids_to_reattach.is_empty() {
        out.push(diag(
            "scenario.recovery.surfaceIdsToReattach",
            "error",
            "recovery must list surfaces to reattach",
            DIAG_LIFECYCLE_UNPROVEN,
        ));
    }
    if !recovery.cancels_capabilities_only_on_owner_dispose {
        out.push(diag(
            "scenario.recovery.cancelsCapabilitiesOnlyOnOwnerDispose",
            "error",
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
                    "error",
                    format!("invalid JSON: {e}"),
                    DIAG_LIFECYCLE_UNPROVEN,
                ));
                None
            }
        },
        Err(e) => {
            diags.push(diag(label, "error", format!("cannot read: {e}"), DIAG_LIFECYCLE_UNPROVEN));
            None
        }
    }
}

/// P3 check for a workspace root (optional lifecycle-scenario.json).
pub fn check_p3_lifecycle_recovery(root: &Path) -> LifecycleRecoveryCheckReport {
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

    let failed = diagnostics.iter().any(|d| d.severity == "error");
    LifecycleRecoveryCheckReport {
        schema: LIFECYCLE_RECOVERY_CHECK_SCHEMA.into(),
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
    fn cross_host_recovery_ready() {
        let dir = tmp("vmz-p3-");
        let report = check_p3_lifecycle_recovery(&dir);
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
        let report = check_p3_lifecycle_recovery(&dir);
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
        let report = check_p3_lifecycle_recovery(&dir);
        assert_eq!(report.status, "failed");
        assert!(
            report
                .diagnostics
                .iter()
                .any(|d| d.code.as_deref() == Some(DIAG_RECOVERY_ASSUMES_HEAP))
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
        let report = check_p3_lifecycle_recovery(&dir);
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
        let report = check_p3_lifecycle_recovery(&dir);
        assert_eq!(report.status, "failed");
        assert!(
            report
                .diagnostics
                .iter()
                .any(|d| d.code.as_deref() == Some(DIAG_PERSISTENCE_WINDOW_INVALID))
        );
        let _ = fs::remove_dir_all(dir);
    }
}
