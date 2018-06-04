//! Delivery Proof algebraic check (architecture notes / ).
//!
//! Package / security / update constraints + proof manifest. Browser / Mini /
//! Native share the same proof shape. No real packaging adapters.

use std::fs;
use std::path::Path;

use vmz_protocol::{
    ContentDeliveryMode, DELIVERY_ARTIFACT_MANIFEST_SCHEMA, DELIVERY_PACKAGE_CONSTRAINTS_SCHEMA,
    DELIVERY_PROFILE_SCHEMA, DELIVERY_PROOF_CHECK_SCHEMA, DELIVERY_PROOF_MANIFEST_SCHEMA,
    DELIVERY_PROOF_SCENARIO_SCHEMA, DELIVERY_SECURITY_POLICY_SCHEMA, DELIVERY_UPDATE_POLICY_SCHEMA,
    DIAG_DELIVERY_CONSTRAINT_EXCEEDED, DIAG_DELIVERY_PROFILE_INVALID,
    DIAG_HOST_PLAN_VERSION_MISMATCH, DIAG_HOST_PROFILE_REF_UNRESOLVED,
    DIAG_PROOF_COPIES_SEMANTIC_IR, DIAG_PROOF_MANIFEST_INCOMPLETE, DIAG_RESOLUTION_DIGEST_MISMATCH,
    DIAG_RESOLUTION_DIGEST_MISSING, DIAG_SECURITY_POLICY_INSECURE, DIAG_UPDATE_WITHOUT_REPROOF,
    DeliveryProofCheckReport, DeliveryProofScenario, DeliveryProofUnit, LifecycleHostKind,
    PROFILE_PROTOCOL, ProfileDiagnostic, ProfileProtocolCatalog, RESOLUTION_DIGEST_SCHEMA,
    canonical_digest_value,
};

fn diag(
    path: &str,
    severity: vmz_protocol::Severity,
    message: impl Into<String>,
    code: &str,
) -> ProfileDiagnostic {
    ProfileDiagnostic::with_severity(path, severity, message).with_code(code)
}

fn validate_unit(
    unit: &DeliveryProofUnit,
    idx: usize,
    expected_plan_version: &str,
    out: &mut Vec<ProfileDiagnostic>,
) {
    let prefix = format!("scenario.units[{idx}]");
    // `host_kind` is a closed enum — unknown labels fail at deserialize.
    if unit.delivery.schema != DELIVERY_PROFILE_SCHEMA {
        out.push(diag(
            &format!("{prefix}.delivery.schema"),
            vmz_protocol::Severity::Error,
            format!("DeliveryProfile schema must be `{DELIVERY_PROFILE_SCHEMA}`"),
            DIAG_DELIVERY_PROFILE_INVALID,
        ));
    }
    if unit.delivery.host_profile_ref != unit.host.host_id {
        out.push(diag(
            &format!("{prefix}.delivery.hostProfileRef"),
            vmz_protocol::Severity::Error,
            "delivery.hostProfileRef must resolve to unit.host.hostId",
            DIAG_HOST_PROFILE_REF_UNRESOLVED,
        ));
    }
    // Closed [`ContentDeliveryMode`] validates at deserialize.

    let proof = &unit.proof;
    if proof.schema != DELIVERY_PROOF_MANIFEST_SCHEMA {
        out.push(diag(
            &format!("{prefix}.proof.schema"),
            vmz_protocol::Severity::Error,
            format!("DeliveryProofManifest schema must be `{DELIVERY_PROOF_MANIFEST_SCHEMA}`"),
            DIAG_PROOF_MANIFEST_INCOMPLETE,
        ));
    }
    if proof.delivery_id != unit.delivery.delivery_id {
        out.push(diag(
            &format!("{prefix}.proof.deliveryId"),
            vmz_protocol::Severity::Error,
            "proof.deliveryId must match delivery.deliveryId",
            DIAG_PROOF_MANIFEST_INCOMPLETE,
        ));
    }
    if proof.host_profile_id != unit.host.host_id {
        out.push(diag(
            &format!("{prefix}.proof.hostProfileId"),
            vmz_protocol::Severity::Error,
            "proof.hostProfileId must match host.hostId",
            DIAG_PROOF_MANIFEST_INCOMPLETE,
        ));
    }
    if proof.constraint_proofs.is_empty() || proof.plan_version.trim().is_empty() {
        out.push(diag(
            &format!("{prefix}.proof"),
            vmz_protocol::Severity::Error,
            "proof requires planVersion + non-empty constraintProofs",
            DIAG_PROOF_MANIFEST_INCOMPLETE,
        ));
    }
    if proof.plan_version != expected_plan_version
        || proof.artifact.plan_version != expected_plan_version
    {
        out.push(diag(
            &format!("{prefix}.proof.planVersion"),
            vmz_protocol::Severity::Error,
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
            vmz_protocol::Severity::Error,
            format!("packageConstraints schema must be `{DELIVERY_PACKAGE_CONSTRAINTS_SCHEMA}`"),
            DIAG_PROOF_MANIFEST_INCOMPLETE,
        ));
    }
    if pc.requires_resolution_digest {
        match unit.delivery.resolution_digest.as_ref() {
            None => out.push(diag(
                &format!("{prefix}.delivery.resolutionDigest"),
                vmz_protocol::Severity::Error,
                "packageConstraints require resolutionDigest on DeliveryProfile",
                DIAG_RESOLUTION_DIGEST_MISSING,
            )),
            Some(digest) => {
                if digest.schema != RESOLUTION_DIGEST_SCHEMA {
                    out.push(diag(
                        &format!("{prefix}.delivery.resolutionDigest.schema"),
                        vmz_protocol::Severity::Error,
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
                        vmz_protocol::Severity::Error,
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
                vmz_protocol::Severity::Error,
                format!("included surface `{sid}` not provided by host"),
                DIAG_DELIVERY_CONSTRAINT_EXCEEDED,
            ));
        }
        if !pc.allowed_surface_ids.is_empty() && !pc.allowed_surface_ids.iter().any(|a| a == sid) {
            out.push(diag(
                &format!("{prefix}.proof.artifact.includedSurfaceIds"),
                vmz_protocol::Severity::Error,
                format!("included surface `{sid}` not in packageConstraints.allowedSurfaceIds"),
                DIAG_DELIVERY_CONSTRAINT_EXCEEDED,
            ));
        }
    }
    if let Some(max) = pc.max_surfaces {
        if proof.artifact.included_surface_ids.len() as u32 > max {
            out.push(diag(
                &format!("{prefix}.proof.packageConstraints.maxSurfaces"),
                vmz_protocol::Severity::Error,
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
                vmz_protocol::Severity::Error,
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
            vmz_protocol::Severity::Error,
            "securityPolicy requires schema + policyId",
            DIAG_PROOF_MANIFEST_INCOMPLETE,
        ));
    }
    if sec.allows_arbitrary_remote && !sec.requires_integrity_for_remote {
        out.push(diag(
            &format!("{prefix}.proof.securityPolicy.allowsArbitraryRemote"),
            vmz_protocol::Severity::Error,
            "arbitrary remote delivery requires integrity binding",
            DIAG_SECURITY_POLICY_INSECURE,
        ));
    }
    let remoteish = matches!(
        unit.delivery.asset_strategy,
        ContentDeliveryMode::Remote | ContentDeliveryMode::Hybrid
    );
    if remoteish && !sec.requires_integrity_for_remote {
        out.push(diag(
            &format!("{prefix}.proof.securityPolicy.requiresIntegrityForRemote"),
            vmz_protocol::Severity::Error,
            "remote/hybrid assetStrategy requires integrity for remote assets",
            DIAG_SECURITY_POLICY_INSECURE,
        ));
    }

    let upd = &proof.update_policy;
    if upd.schema != DELIVERY_UPDATE_POLICY_SCHEMA || upd.policy_id.trim().is_empty() {
        out.push(diag(
            &format!("{prefix}.proof.updatePolicy"),
            vmz_protocol::Severity::Error,
            "updatePolicy requires schema + policyId",
            DIAG_PROOF_MANIFEST_INCOMPLETE,
        ));
    }
    // Closed [`UpdateChannel`] validates at deserialize.
    if !upd.requires_reproof_on_semantic_change {
        out.push(diag(
            &format!("{prefix}.proof.updatePolicy.requiresReproofOnSemanticChange"),
            vmz_protocol::Severity::Error,
            "semantic/security profile changes must invalidate delivery and re-prove",
            DIAG_UPDATE_WITHOUT_REPROOF,
        ));
    }

    let art = &proof.artifact;
    if art.schema != DELIVERY_ARTIFACT_MANIFEST_SCHEMA {
        out.push(diag(
            &format!("{prefix}.proof.artifact.schema"),
            vmz_protocol::Severity::Error,
            format!(
                "DeliveryArtifactManifest schema must be `{DELIVERY_ARTIFACT_MANIFEST_SCHEMA}`"
            ),
            DIAG_PROOF_MANIFEST_INCOMPLETE,
        ));
    }
    if art.copies_semantic_ir {
        out.push(diag(
            &format!("{prefix}.proof.artifact.copiesSemanticIr"),
            vmz_protocol::Severity::Error,
            "DeliveryArtifactManifest must reference stable IDs only — must not copy semantic IR",
            DIAG_PROOF_COPIES_SEMANTIC_IR,
        ));
    }
    if art.included_surface_ids.is_empty() {
        out.push(diag(
            &format!("{prefix}.proof.artifact.includedSurfaceIds"),
            vmz_protocol::Severity::Error,
            "artifact must list included surfaces",
            DIAG_PROOF_MANIFEST_INCOMPLETE,
        ));
    }
}

/// Validate a [`DeliveryProofScenario`] against delivery proof contracts.
///
/// Checks schema, plan version, artifact inclusion, and related proof fields,
/// appending diagnostics into `out`.
pub fn validate_delivery_proof_scenario(
    scenario: &DeliveryProofScenario,
    out: &mut Vec<ProfileDiagnostic>,
) {
    if scenario.schema != DELIVERY_PROOF_SCENARIO_SCHEMA {
        out.push(diag(
            "scenario.schema",
            vmz_protocol::Severity::Error,
            format!("DeliveryProofScenario schema must be `{DELIVERY_PROOF_SCENARIO_SCHEMA}`"),
            DIAG_PROOF_MANIFEST_INCOMPLETE,
        ));
    }
    if scenario.expected_plan_version.trim().is_empty() {
        out.push(diag(
            "scenario.expectedPlanVersion",
            vmz_protocol::Severity::Error,
            "expectedPlanVersion required",
            DIAG_HOST_PLAN_VERSION_MISMATCH,
        ));
    }
    for kind in LifecycleHostKind::ALL {
        if !scenario.units.iter().any(|u| u.host_kind == *kind) {
            out.push(diag(
                "scenario.units",
                vmz_protocol::Severity::Error,
                format!("P4 requires delivery proof unit for hostKind `{}`", kind.as_str()),
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
                    vmz_protocol::Severity::Error,
                    format!("invalid JSON: {e}"),
                    DIAG_PROOF_MANIFEST_INCOMPLETE,
                ));
                None
            }
        },
        Err(e) => {
            diags.push(diag(
                label,
                vmz_protocol::Severity::Error,
                format!("cannot read: {e}"),
                DIAG_PROOF_MANIFEST_INCOMPLETE,
            ));
            None
        }
    }
}

/// Run delivery-proof checks for a workspace root.
///
/// Loads optional `delivery-proof-scenario.json` (and foul twin); falls back to
/// the built-in cross-delivery example when the primary file is absent.
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

    let failed = diagnostics.iter().any(|d| d.is_error());
    DeliveryProofCheckReport {
        schema: DELIVERY_PROOF_CHECK_SCHEMA.into(),
        catalog,
        scenario,
        diagnostics,
        status: vmz_protocol::CheckReportStatus::from_failed(failed),
    }
}
