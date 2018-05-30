//! Delivery Proof algebraic check (architecture notes / ).
//!
//! Package / security / update constraints + proof manifest. Browser / Mini /
//! Native share the same proof shape. No real packaging adapters.

use std::fs;
use std::path::Path;

use vmz_protocol::{
    DELIVERY_ARTIFACT_MANIFEST_SCHEMA, DELIVERY_ASSET_STRATEGIES,
    DELIVERY_PACKAGE_CONSTRAINTS_SCHEMA, DELIVERY_PROFILE_SCHEMA, DELIVERY_PROOF_CHECK_SCHEMA,
    DELIVERY_PROOF_MANIFEST_SCHEMA, DELIVERY_PROOF_SCENARIO_SCHEMA,
    DELIVERY_SECURITY_POLICY_SCHEMA, DELIVERY_UPDATE_CHANNELS, DELIVERY_UPDATE_POLICY_SCHEMA,
    DIAG_DELIVERY_CONSTRAINT_EXCEEDED, DIAG_DELIVERY_PROFILE_INVALID,
    DIAG_HOST_PLAN_VERSION_MISMATCH, DIAG_HOST_PROFILE_REF_UNRESOLVED,
    DIAG_PROOF_COPIES_SEMANTIC_IR, DIAG_PROOF_MANIFEST_INCOMPLETE, DIAG_RESOLUTION_DIGEST_MISMATCH,
    DIAG_RESOLUTION_DIGEST_MISSING, DIAG_SECURITY_POLICY_INSECURE, DIAG_UPDATE_WITHOUT_REPROOF,
    DeliveryProofCheckReport, DeliveryProofScenario, DeliveryProofUnit, LIFECYCLE_HOST_KINDS,
    PROFILE_PROTOCOL, ProfileDiagnostic, ProfileProtocolCatalog, RESOLUTION_DIGEST_SCHEMA,
    canonical_digest_value,
};

fn diag(path: &str, severity: &str, message: impl Into<String>, code: &str) -> ProfileDiagnostic {
    ProfileDiagnostic {
        path: path.into(),
        severity: severity.into(),
        message: message.into(),
        code: Some(code.into()),
    }
}

fn validate_unit(
    unit: &DeliveryProofUnit,
    idx: usize,
    expected_plan_version: &str,
    out: &mut Vec<ProfileDiagnostic>,
) {
    let prefix = format!("scenario.units[{idx}]");
    if !LIFECYCLE_HOST_KINDS.contains(&unit.host_kind.as_str()) {
        out.push(diag(
            &format!("{prefix}.hostKind"),
            "error",
            format!("unknown hostKind `{}`", unit.host_kind),
            DIAG_PROOF_MANIFEST_INCOMPLETE,
        ));
    }
    if unit.delivery.schema != DELIVERY_PROFILE_SCHEMA {
        out.push(diag(
            &format!("{prefix}.delivery.schema"),
            "error",
            format!("DeliveryProfile schema must be `{DELIVERY_PROFILE_SCHEMA}`"),
            DIAG_DELIVERY_PROFILE_INVALID,
        ));
    }
    if unit.delivery.host_profile_ref != unit.host.host_id {
        out.push(diag(
            &format!("{prefix}.delivery.hostProfileRef"),
            "error",
            "delivery.hostProfileRef must resolve to unit.host.hostId",
            DIAG_HOST_PROFILE_REF_UNRESOLVED,
        ));
    }
    if !DELIVERY_ASSET_STRATEGIES.contains(&unit.delivery.asset_strategy.as_str()) {
        out.push(diag(
            &format!("{prefix}.delivery.assetStrategy"),
            "error",
            format!(
                "assetStrategy must be one of {}; got `{}`",
                DELIVERY_ASSET_STRATEGIES.join("|"),
                unit.delivery.asset_strategy
            ),
            DIAG_DELIVERY_PROFILE_INVALID,
        ));
    }

    let proof = &unit.proof;
    if proof.schema != DELIVERY_PROOF_MANIFEST_SCHEMA {
        out.push(diag(
            &format!("{prefix}.proof.schema"),
            "error",
            format!("DeliveryProofManifest schema must be `{DELIVERY_PROOF_MANIFEST_SCHEMA}`"),
            DIAG_PROOF_MANIFEST_INCOMPLETE,
        ));
    }
    if proof.delivery_id != unit.delivery.delivery_id {
        out.push(diag(
            &format!("{prefix}.proof.deliveryId"),
            "error",
            "proof.deliveryId must match delivery.deliveryId",
            DIAG_PROOF_MANIFEST_INCOMPLETE,
        ));
    }
    if proof.host_profile_id != unit.host.host_id {
        out.push(diag(
            &format!("{prefix}.proof.hostProfileId"),
            "error",
            "proof.hostProfileId must match host.hostId",
            DIAG_PROOF_MANIFEST_INCOMPLETE,
        ));
    }
    if proof.constraint_proofs.is_empty() || proof.plan_version.trim().is_empty() {
        out.push(diag(
            &format!("{prefix}.proof"),
            "error",
            "proof requires planVersion + non-empty constraintProofs",
            DIAG_PROOF_MANIFEST_INCOMPLETE,
        ));
    }
    if proof.plan_version != expected_plan_version
        || proof.artifact.plan_version != expected_plan_version
    {
        out.push(diag(
            &format!("{prefix}.proof.planVersion"),
            "error",
            format!(
                "host/artifact planVersion mismatch: expected `{expected_plan_version}`, proof=`{}`, artifact=`{}`",
                proof.plan_version, proof.artifact.plan_version
            ),
            DIAG_HOST_PLAN_VERSION_MISMATCH,
        ));
    }

    let pc = &proof.package_constraints;
    if pc.schema != DELIVERY_PACKAGE_CONSTRAINTS_SCHEMA {
        out.push(diag(
            &format!("{prefix}.proof.packageConstraints.schema"),
            "error",
            format!("packageConstraints schema must be `{DELIVERY_PACKAGE_CONSTRAINTS_SCHEMA}`"),
            DIAG_PROOF_MANIFEST_INCOMPLETE,
        ));
    }
    if pc.requires_resolution_digest {
        match unit.delivery.resolution_digest.as_ref() {
            None => out.push(diag(
                &format!("{prefix}.delivery.resolutionDigest"),
                "error",
                "packageConstraints require resolutionDigest on DeliveryProfile",
                DIAG_RESOLUTION_DIGEST_MISSING,
            )),
            Some(digest) => {
                if digest.schema != RESOLUTION_DIGEST_SCHEMA {
                    out.push(diag(
                        &format!("{prefix}.delivery.resolutionDigest.schema"),
                        "error",
                        format!("resolutionDigest schema must be `{RESOLUTION_DIGEST_SCHEMA}`"),
                        DIAG_RESOLUTION_DIGEST_MISMATCH,
                    ));
                }
                let expected = canonical_digest_value(&unit.host, &unit.delivery.delivery_id);
                if digest.value != expected
                    || proof.artifact.resolution_digest.value != expected
                    || proof.artifact.resolution_digest.delivery_id != unit.delivery.delivery_id
                {
                    out.push(diag(
                        &format!("{prefix}.proof.artifact.resolutionDigest"),
                        "error",
                        "artifact resolutionDigest must match canonical host+delivery digest",
                        DIAG_RESOLUTION_DIGEST_MISMATCH,
                    ));
                }
            }
        }
    }

    let host_surface_ids: Vec<&str> =
        unit.host.surfaces.iter().map(|s| s.surface_id.as_str()).collect();
    for sid in &proof.artifact.included_surface_ids {
        if !host_surface_ids.contains(&sid.as_str()) {
            out.push(diag(
                &format!("{prefix}.proof.artifact.includedSurfaceIds"),
                "error",
                format!("included surface `{sid}` not provided by host"),
                DIAG_DELIVERY_CONSTRAINT_EXCEEDED,
            ));
        }
        if !pc.allowed_surface_ids.is_empty() && !pc.allowed_surface_ids.iter().any(|a| a == sid) {
            out.push(diag(
                &format!("{prefix}.proof.artifact.includedSurfaceIds"),
                "error",
                format!("included surface `{sid}` not in packageConstraints.allowedSurfaceIds"),
                DIAG_DELIVERY_CONSTRAINT_EXCEEDED,
            ));
        }
    }
    if let Some(max) = pc.max_surfaces {
        if proof.artifact.included_surface_ids.len() as u32 > max {
            out.push(diag(
                &format!("{prefix}.proof.packageConstraints.maxSurfaces"),
                "error",
                format!(
                    "included surfaces {} exceed maxSurfaces {max}",
                    proof.artifact.included_surface_ids.len()
                ),
                DIAG_DELIVERY_CONSTRAINT_EXCEEDED,
            ));
        }
    }
    if let Some(max_bytes) = pc.max_package_bytes {
        if proof.artifact.estimated_package_bytes > max_bytes {
            out.push(diag(
                &format!("{prefix}.proof.packageConstraints.maxPackageBytes"),
                "error",
                format!(
                    "estimatedPackageBytes {} exceed maxPackageBytes {max_bytes}",
                    proof.artifact.estimated_package_bytes
                ),
                DIAG_DELIVERY_CONSTRAINT_EXCEEDED,
            ));
        }
    }

    let sec = &proof.security_policy;
    if sec.schema != DELIVERY_SECURITY_POLICY_SCHEMA || sec.policy_id.trim().is_empty() {
        out.push(diag(
            &format!("{prefix}.proof.securityPolicy"),
            "error",
            "securityPolicy requires schema + policyId",
            DIAG_PROOF_MANIFEST_INCOMPLETE,
        ));
    }
    if sec.allows_arbitrary_remote && !sec.requires_integrity_for_remote {
        out.push(diag(
            &format!("{prefix}.proof.securityPolicy.allowsArbitraryRemote"),
            "error",
            "arbitrary remote delivery requires integrity binding",
            DIAG_SECURITY_POLICY_INSECURE,
        ));
    }
    let remoteish = matches!(unit.delivery.asset_strategy.as_str(), "remote" | "hybrid");
    if remoteish && !sec.requires_integrity_for_remote {
        out.push(diag(
            &format!("{prefix}.proof.securityPolicy.requiresIntegrityForRemote"),
            "error",
            "remote/hybrid assetStrategy requires integrity for remote assets",
            DIAG_SECURITY_POLICY_INSECURE,
        ));
    }

    let upd = &proof.update_policy;
    if upd.schema != DELIVERY_UPDATE_POLICY_SCHEMA || upd.policy_id.trim().is_empty() {
        out.push(diag(
            &format!("{prefix}.proof.updatePolicy"),
            "error",
            "updatePolicy requires schema + policyId",
            DIAG_PROOF_MANIFEST_INCOMPLETE,
        ));
    }
    if !DELIVERY_UPDATE_CHANNELS.contains(&upd.channel.as_str()) {
        out.push(diag(
            &format!("{prefix}.proof.updatePolicy.channel"),
            "error",
            format!(
                "update channel must be one of {}; got `{}`",
                DELIVERY_UPDATE_CHANNELS.join("|"),
                upd.channel
            ),
            DIAG_PROOF_MANIFEST_INCOMPLETE,
        ));
    }
    if !upd.requires_reproof_on_semantic_change {
        out.push(diag(
            &format!("{prefix}.proof.updatePolicy.requiresReproofOnSemanticChange"),
            "error",
            "semantic/security profile changes must invalidate delivery and re-prove",
            DIAG_UPDATE_WITHOUT_REPROOF,
        ));
    }

    let art = &proof.artifact;
    if art.schema != DELIVERY_ARTIFACT_MANIFEST_SCHEMA {
        out.push(diag(
            &format!("{prefix}.proof.artifact.schema"),
            "error",
            format!(
                "DeliveryArtifactManifest schema must be `{DELIVERY_ARTIFACT_MANIFEST_SCHEMA}`"
            ),
            DIAG_PROOF_MANIFEST_INCOMPLETE,
        ));
    }
    if art.copies_semantic_ir {
        out.push(diag(
            &format!("{prefix}.proof.artifact.copiesSemanticIr"),
            "error",
            "DeliveryArtifactManifest must reference stable IDs only — must not copy semantic IR",
            DIAG_PROOF_COPIES_SEMANTIC_IR,
        ));
    }
    if art.included_surface_ids.is_empty() {
        out.push(diag(
            &format!("{prefix}.proof.artifact.includedSurfaceIds"),
            "error",
            "artifact must list included surfaces",
            DIAG_PROOF_MANIFEST_INCOMPLETE,
        ));
    }
}

// Validate a DeliveryProofScenario against hard contracts.
pub fn validate_delivery_proof_scenario(
    scenario: &DeliveryProofScenario,
    out: &mut Vec<ProfileDiagnostic>,
) {
    if scenario.schema != DELIVERY_PROOF_SCENARIO_SCHEMA {
        out.push(diag(
            "scenario.schema",
            "error",
            format!("DeliveryProofScenario schema must be `{DELIVERY_PROOF_SCENARIO_SCHEMA}`"),
            DIAG_PROOF_MANIFEST_INCOMPLETE,
        ));
    }
    if scenario.expected_plan_version.trim().is_empty() {
        out.push(diag(
            "scenario.expectedPlanVersion",
            "error",
            "expectedPlanVersion required",
            DIAG_HOST_PLAN_VERSION_MISMATCH,
        ));
    }
    for kind in LIFECYCLE_HOST_KINDS {
        if !scenario.units.iter().any(|u| u.host_kind == *kind) {
            out.push(diag(
                "scenario.units",
                "error",
                format!("P4 requires delivery proof unit for hostKind `{kind}`"),
                DIAG_PROOF_MANIFEST_INCOMPLETE,
            ));
        }
    }
    for (i, unit) in scenario.units.iter().enumerate() {
        validate_unit(unit, i, &scenario.expected_plan_version, out);
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
                    DIAG_PROOF_MANIFEST_INCOMPLETE,
                ));
                None
            }
        },
        Err(e) => {
            diags.push(diag(
                label,
                "error",
                format!("cannot read: {e}"),
                DIAG_PROOF_MANIFEST_INCOMPLETE,
            ));
            None
        }
    }
}

// check for a workspace root (optional delivery-proof-scenario.json).
pub fn check_delivery_proof(root: &Path) -> DeliveryProofCheckReport {
    let mut diagnostics = Vec::new();
    let catalog = ProfileProtocolCatalog::v0();
    let _ = PROFILE_PROTOCOL;
    let scenario = load_json::<DeliveryProofScenario>(
        &root.join("delivery-proof-scenario.json"),
        "delivery-proof-scenario.json",
        &mut diagnostics,
    )
    .unwrap_or_else(DeliveryProofScenario::cross_delivery_proof_example);

    validate_delivery_proof_scenario(&scenario, &mut diagnostics);

    if let Some(foul) = load_json::<DeliveryProofScenario>(
        &root.join("delivery-proof-scenario.foul.json"),
        "delivery-proof-scenario.foul.json",
        &mut diagnostics,
    ) {
        validate_delivery_proof_scenario(&foul, &mut diagnostics);
    }

    let failed = diagnostics.iter().any(|d| d.severity == "error");
    DeliveryProofCheckReport {
        schema: DELIVERY_PROOF_CHECK_SCHEMA.into(),
        catalog,
        scenario,
        diagnostics,
        status: if failed { "failed".into() } else { "ready".into() },
    }
}
