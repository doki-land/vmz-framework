//! Unified Executor algebraic check (architecture notes / ).
//!
//! Same transaction across Surfaces; generation discard; DisposeRegion
//! authority + capability cancel. No real DOM/iOS/Android adapters.

use std::fs;
use std::path::Path;

use vmz_protocol::{
    DIAG_CANCEL_NOT_PROPAGATED, DIAG_DISPOSE_NOT_AUTHORITATIVE, DIAG_MISSING_ENVELOPE_IDS,
    DIAG_PRIVATE_OBJECT_CROSSING, DIAG_SPLIT_TRANSACTION, DIAG_STALE_GENERATION,
    DIAG_SURFACE_OWNS_STATE, EXECUTOR_CHECK_SCHEMA, EXECUTOR_SCENARIO_SCHEMA, ExecutorCheckReport,
    ExecutorEnvelopeHeader, ExecutorScenario, ProfileDiagnostic, ProfileProtocolCatalog,
};

fn diag(path: &str, severity: &str, message: impl Into<String>, code: &str) -> ProfileDiagnostic {
    ProfileDiagnostic {
        path: path.into(),
        severity: severity.into(),
        message: message.into(),
        code: Some(code.into()),
    }
}

fn check_header(path: &str, h: &ExecutorEnvelopeHeader, out: &mut Vec<ProfileDiagnostic>) {
    if h.schema.trim().is_empty() || !h.is_complete() {
        out.push(diag(
            path,
            "error",
            "envelope header requires applicationId/planVersion/generation/transactionId/regionId",
            DIAG_MISSING_ENVELOPE_IDS,
        ));
    }
}

// Validate an ExecutorScenario against hard contracts.
pub fn validate_executor_scenario(scenario: &ExecutorScenario, out: &mut Vec<ProfileDiagnostic>) {
    if scenario.schema != EXECUTOR_SCENARIO_SCHEMA {
        out.push(diag(
            "scenario.schema",
            "error",
            format!("ExecutorScenario schema must be `{EXECUTOR_SCENARIO_SCHEMA}`"),
            DIAG_MISSING_ENVELOPE_IDS,
        ));
    }

    // Rule 3: StateSlot single owner; surface driver must not own business state.
    for (i, slot) in scenario.state_slots.iter().enumerate() {
        if slot.owner_region_id.trim().is_empty() {
            out.push(diag(
                &format!("scenario.stateSlots[{i}].ownerRegionId"),
                "error",
                "StateSlot requires single ownerRegionId",
                DIAG_SURFACE_OWNS_STATE,
            ));
        }
        if slot.surface_driver_owns_business_state {
            out.push(diag(
                &format!("scenario.stateSlots[{i}].surfaceDriverOwnsBusinessState"),
                "error",
                "Surface driver must not own business state (projection cache only)",
                DIAG_SURFACE_OWNS_STATE,
            ));
        }
    }

    if let Some(ev) = &scenario.incoming_event {
        check_header("scenario.incomingEvent.header", &ev.header, out);
    }

    // Rule 4: stale generation discard.
    let event_gen = scenario.incoming_event.as_ref().map(|e| e.header.generation);
    if let Some(event_generation) = event_gen {
        if event_generation < scenario.current_generation {
            if !scenario.must_discard_stale {
                out.push(diag(
                    "scenario.mustDiscardStale",
                    "error",
                    "stale envelope generation must be discarded (mustDiscardStale=true)",
                    DIAG_STALE_GENERATION,
                ));
            }
            if scenario.produced_patches_from_stale || !scenario.patch_batches.is_empty() {
                out.push(diag(
                    "scenario.patchBatches",
                    "error",
                    "producing patches from stale generation is forbidden",
                    DIAG_STALE_GENERATION,
                ));
            }
        }
    }

    if let Some(tx) = &scenario.transaction {
        // Rule 2: no per-surface split transactions.
        if tx.split_per_surface {
            out.push(diag(
                "scenario.transaction.splitPerSurface",
                "error",
                "one write must be one Core Executor transaction — per-surface split forbidden",
                DIAG_SPLIT_TRANSACTION,
            ));
        }
        if tx.transaction_id.trim().is_empty() {
            out.push(diag(
                "scenario.transaction.transactionId",
                "error",
                "transactionId required",
                DIAG_MISSING_ENVELOPE_IDS,
            ));
        }

        // Patch batches share transactionId; cover affected bindings; group by surface.
        let mut covered: Vec<String> = Vec::new();
        let mut surfaces = std::collections::BTreeSet::new();
        for (i, batch) in scenario.patch_batches.iter().enumerate() {
            check_header(&format!("scenario.patchBatches[{i}].header"), &batch.header, out);
            if batch.header.transaction_id != tx.transaction_id {
                out.push(diag(
                    &format!("scenario.patchBatches[{i}].header.transactionId"),
                    "error",
                    format!(
                        "patch batch transactionId `{}` != transaction `{}` (split transaction)",
                        batch.header.transaction_id, tx.transaction_id
                    ),
                    DIAG_SPLIT_TRANSACTION,
                ));
            }
            if batch.surface_id.trim().is_empty() {
                out.push(diag(
                    &format!("scenario.patchBatches[{i}].surfaceId"),
                    "error",
                    "PatchBatch.surfaceId required",
                    DIAG_SPLIT_TRANSACTION,
                ));
            } else if !surfaces.insert(batch.surface_id.clone()) {
                // Multiple batches per surface ok only if same tx — already checked.
                // Duplicate surface still fine as long as same tx; no extra diag.
                let _ = surfaces.remove(&batch.surface_id);
                surfaces.insert(batch.surface_id.clone());
            }
            // Rule 5: no private runtime objects across surfaces.
            if batch.carries_private_runtime_object {
                out.push(diag(
                    &format!("scenario.patchBatches[{i}].carriesPrivateRuntimeObject"),
                    "error",
                    "cross-surface envelopes must not carry private runtime object references",
                    DIAG_PRIVATE_OBJECT_CROSSING,
                ));
            }
            covered.extend(batch.binding_ids.iter().cloned());
        }

        if !scenario.patch_batches.is_empty()
            || event_gen.map(|g| g >= scenario.current_generation).unwrap_or(true)
        {
            // Only require coverage when not a stale-discard scenario.
            let stale = event_gen.map(|g| g < scenario.current_generation).unwrap_or(false);
            if !stale {
                for binding in &tx.affected_bindings {
                    if !covered.iter().any(|c| c == binding) {
                        out.push(diag(
                            "scenario.transaction.affectedBindings",
                            "error",
                            format!(
                                "affected binding `{binding}` not covered by any PatchBatch (split/incomplete dispatch)"
                            ),
                            DIAG_SPLIT_TRANSACTION,
                        ));
                    }
                }
            }
        }
    } else if !scenario.patch_batches.is_empty() {
        out.push(diag(
            "scenario.transaction",
            "error",
            "patch batches without a single Core Executor transaction",
            DIAG_SPLIT_TRANSACTION,
        ));
    }

    // Rule 6: DisposeRegion is only terminate authority.
    if scenario.driver_unload_cancels_foreign_tasks && scenario.dispose_region.is_none() {
        out.push(diag(
            "scenario.driverUnloadCancelsForeignTasks",
            "error",
            "driver unload cannot cancel foreign-surface tasks without DisposeRegion",
            DIAG_DISPOSE_NOT_AUTHORITATIVE,
        ));
    }
    if let Some(dispose) = &scenario.dispose_region {
        check_header("scenario.disposeRegion.header", &dispose.header, out);
        if !dispose.is_authoritative_terminate {
            out.push(diag(
                "scenario.disposeRegion.isAuthoritativeTerminate",
                "error",
                "DisposeRegion must be the authoritative terminate",
                DIAG_DISPOSE_NOT_AUTHORITATIVE,
            ));
        }
        // Rule 7: dispose must cancel in-flight capabilities.
        if !dispose.cancels_capabilities {
            out.push(diag(
                "scenario.disposeRegion.cancelsCapabilities",
                "error",
                "DisposeRegion must cancel in-flight capabilities",
                DIAG_CANCEL_NOT_PROPAGATED,
            ));
        } else {
            // If cancel requests exist, they must be propagated.
            for (i, c) in scenario.cancel_requests.iter().enumerate() {
                check_header(&format!("scenario.cancelRequests[{i}].header"), &c.header, out);
                if !c.propagated {
                    out.push(diag(
                        &format!("scenario.cancelRequests[{i}].propagated"),
                        "error",
                        "cancel must propagate across surfaces",
                        DIAG_CANCEL_NOT_PROPAGATED,
                    ));
                }
            }
        }
    } else {
        for (i, c) in scenario.cancel_requests.iter().enumerate() {
            if !c.propagated {
                out.push(diag(
                    &format!("scenario.cancelRequests[{i}].propagated"),
                    "error",
                    "cancel must propagate across surfaces",
                    DIAG_CANCEL_NOT_PROPAGATED,
                ));
            }
        }
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
                    DIAG_MISSING_ENVELOPE_IDS,
                ));
                None
            }
        },
        Err(e) => {
            diags.push(diag(
                label,
                "error",
                format!("cannot read: {e}"),
                DIAG_MISSING_ENVELOPE_IDS,
            ));
            None
        }
    }
}

// check for a workspace root (optional executor-scenario.json).
pub fn check_unified_executor(root: &Path) -> ExecutorCheckReport {
    let mut diagnostics = Vec::new();
    let catalog = ProfileProtocolCatalog::v0();
    let scenario = load_json::<ExecutorScenario>(
        &root.join("executor-scenario.json"),
        "executor-scenario.json",
        &mut diagnostics,
    )
    .unwrap_or_else(ExecutorScenario::mixed_camera_t42_example);

    validate_executor_scenario(&scenario, &mut diagnostics);

    // Optional foul fixture accumulates extra rejects for gate smoke.
    if let Some(foul) = load_json::<ExecutorScenario>(
        &root.join("executor-scenario.foul.json"),
        "executor-scenario.foul.json",
        &mut diagnostics,
    ) {
        validate_executor_scenario(&foul, &mut diagnostics);
    }

    let failed = diagnostics.iter().any(|d| d.severity == "error");
    ExecutorCheckReport {
        schema: EXECUTOR_CHECK_SCHEMA.into(),
        catalog,
        scenario,
        diagnostics,
        status: if failed { "failed".into() } else { "ready".into() },
    }
}
