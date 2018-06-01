//! HostProfile / DeliveryProfile protocol.
//!
//! Freezes HostProfile + DeliveryProfile + binding schemas, namespaced
//! contribution rules, resolution digests, surface/capability/route solver
//! artifacts, unified executor envelopes, lifecycle mapping + crash recovery,
//! delivery package/security/update proofs, and cross-host conformance
//! (Web / Template / mixed) check documents exchanged by CLI and N-API.

use serde::{Deserialize, Serialize};

/// Umbrella profile protocol id for handshake / catalog (Browser / Mini / Native).
pub const PROFILE_PROTOCOL: &str = "vmz.profile.protocol.v0";

/// Schema id for a HostProfile document (surfaces, capabilities, lifecycle, navigation).
pub const HOST_PROFILE_SCHEMA: &str = "vmz.profile.host.v0";

/// Schema id for a DeliveryProfile document bound to one HostProfile ref.
pub const DELIVERY_PROFILE_SCHEMA: &str = "vmz.profile.delivery.v0";

/// Schema id for one SurfaceBinding row inside a HostProfile.
pub const SURFACE_BINDING_SCHEMA: &str = "vmz.profile.surface_binding.v0";

/// Schema id for one CapabilityBinding row inside a HostProfile.
pub const CAPABILITY_BINDING_SCHEMA: &str = "vmz.profile.capability_binding.v0";

/// Schema id for one host-event to unified-lifecycle mapping row.
pub const LIFECYCLE_BINDING_SCHEMA: &str = "vmz.profile.lifecycle_binding.v0";

/// Schema id for host navigation / stack / deep-link binding.
pub const NAVIGATION_BINDING_SCHEMA: &str = "vmz.profile.navigation_binding.v0";

/// Schema id for a transport endpoint binding used by capabilities.
pub const TRANSPORT_BINDING_SCHEMA: &str = "vmz.profile.transport_binding.v0";

/// Schema id for HostConstraints (max surfaces, digest requirements).
pub const HOST_CONSTRAINTS_SCHEMA: &str = "vmz.profile.host_constraints.v0";

/// Schema id for a Host+Delivery resolution digest document.
pub const RESOLUTION_DIGEST_SCHEMA: &str = "vmz.profile.resolution_digest.v0";

/// Schema id for a namespaced plugin ProfileContribution.
pub const PROFILE_CONTRIBUTION_SCHEMA: &str = "vmz.profile.contribution.v0";

/// Schema id for the structured profile check / N-API result.
pub const PROFILE_CHECK_SCHEMA: &str = "vmz.profile.check.v0";

/// Schema id for region SurfaceRequirements inferred for the solver.
pub const SURFACE_REQUIREMENTS_SCHEMA: &str = "vmz.profile.surface_requirements.v0";

/// Schema id for one CapabilityRequirement row in solver input.
pub const CAPABILITY_REQUIREMENT_SCHEMA: &str = "vmz.profile.capability_requirement.v0";

/// Schema id for the SurfaceAssignmentTable solver artifact.
pub const SURFACE_ASSIGNMENT_TABLE_SCHEMA: &str = "vmz.profile.surface_assignment_table.v0";

/// Schema id for the CapabilityResolutionTable solver artifact.
pub const CAPABILITY_RESOLUTION_TABLE_SCHEMA: &str = "vmz.profile.capability_resolution_table.v0";

/// Schema id for the RouteRealizationTable solver artifact.
pub const ROUTE_REALIZATION_TABLE_SCHEMA: &str = "vmz.profile.route_realization_table.v0";

/// Schema id for the assembled HostResolutionManifest (stable ids only).
pub const HOST_RESOLUTION_MANIFEST_SCHEMA: &str = "vmz.profile.host_resolution_manifest.v0";

/// Schema id for ProfileSolverInput (regions / capabilities / routes).
pub const SOLVER_INPUT_SCHEMA: &str = "vmz.profile.solver_input.v0";

/// Schema id for the surface/capability/route solver check report.
pub const SOLVER_CHECK_SCHEMA: &str = "vmz.profile.solver_check.v0";

/// Schema id for the shared ExecutorEnvelopeHeader on event/patch/dispose envelopes.
pub const EXECUTOR_ENVELOPE_HEADER_SCHEMA: &str = "vmz.profile.executor_envelope_header.v0";

/// Schema id for an EventEnvelope entering the unified executor.
pub const EVENT_ENVELOPE_SCHEMA: &str = "vmz.profile.event_envelope.v0";

/// Schema id for an ExecutorTransaction (one logical write generation).
pub const EXECUTOR_TRANSACTION_SCHEMA: &str = "vmz.profile.executor_transaction.v0";

/// Schema id for a per-surface PatchBatch under one transaction.
pub const PATCH_BATCH_SCHEMA: &str = "vmz.profile.patch_batch.v0";

/// Schema id for an authoritative DisposeRegion terminate envelope.
pub const DISPOSE_REGION_SCHEMA: &str = "vmz.profile.dispose_region.v0";

/// Schema id for a CancelRequest that must propagate to capability providers.
pub const CANCEL_REQUEST_SCHEMA: &str = "vmz.profile.cancel_request.v0";

/// Schema id for an algebraic Unified Executor scenario fixture.
pub const EXECUTOR_SCENARIO_SCHEMA: &str = "vmz.profile.executor_scenario.v0";

/// Schema id for the executor invariant check report.
pub const EXECUTOR_CHECK_SCHEMA: &str = "vmz.profile.executor_check.v0";

/// Schema id for one LifecycleMappingEntry (host event + unified lifecycle).
pub const LIFECYCLE_MAPPING_ENTRY_SCHEMA: &str = "vmz.profile.lifecycle_mapping_entry.v0";

/// Schema id for a cross-host LifecycleMappingTable.
pub const LIFECYCLE_MAPPING_TABLE_SCHEMA: &str = "vmz.profile.lifecycle_mapping_table.v0";

/// Schema id for a crash RecoveryPolicy (reattach, no duplicate owner).
pub const RECOVERY_POLICY_SCHEMA: &str = "vmz.profile.recovery_policy.v0";

/// Schema id for a LifecycleScenario fixture spanning Browser / Mini / Native.
pub const LIFECYCLE_SCENARIO_SCHEMA: &str = "vmz.profile.lifecycle_scenario.v0";

/// Schema id for the lifecycle + recovery check report.
pub const LIFECYCLE_RECOVERY_CHECK_SCHEMA: &str = "vmz.profile.lifecycle_recovery_check.v0";

/// Schema id for structured DeliveryPackageConstraints proved at assembly.
pub const DELIVERY_PACKAGE_CONSTRAINTS_SCHEMA: &str = "vmz.profile.delivery_package_constraints.v0";

/// Schema id for a DeliverySecurityPolicy (origin / integrity / CSP).
pub const DELIVERY_SECURITY_POLICY_SCHEMA: &str = "vmz.profile.delivery_security_policy.v0";

/// Schema id for a DeliveryUpdatePolicy (channel + reproof on semantic change).
pub const DELIVERY_UPDATE_POLICY_SCHEMA: &str = "vmz.profile.delivery_update_policy.v0";

/// Schema id for a DeliveryArtifactManifest (stable ids + digest, no semantic IR).
pub const DELIVERY_ARTIFACT_MANIFEST_SCHEMA: &str = "vmz.profile.delivery_artifact_manifest.v0";

/// Schema id for a DeliveryProofManifest bundling constraints + artifact.
pub const DELIVERY_PROOF_MANIFEST_SCHEMA: &str = "vmz.profile.delivery_proof_manifest.v0";

/// Schema id for a multi-host DeliveryProofScenario fixture.
pub const DELIVERY_PROOF_SCENARIO_SCHEMA: &str = "vmz.profile.delivery_proof_scenario.v0";

/// Schema id for the delivery proof check report.
pub const DELIVERY_PROOF_CHECK_SCHEMA: &str = "vmz.profile.delivery_proof_check.v0";

/// Schema id for a shared ConformanceFixture (stable ids only).
pub const CONFORMANCE_FIXTURE_SCHEMA: &str = "vmz.profile.conformance_fixture.v0";

/// Schema id for an algebraic ConformanceStateSnapshot after the fixture script.
pub const CONFORMANCE_STATE_SNAPSHOT_SCHEMA: &str = "vmz.profile.conformance_state_snapshot.v0";

/// Schema id for a ConformanceTrace with shared invariant keys.
pub const CONFORMANCE_TRACE_SCHEMA: &str = "vmz.profile.conformance_trace.v0";

/// Schema id for one host's ConformanceHostRun of the shared fixture.
pub const CONFORMANCE_HOST_RUN_SCHEMA: &str = "vmz.profile.conformance_host_run.v0";

/// Schema id for a ConformanceScenario (web / template / mixed runs).
pub const CONFORMANCE_SCENARIO_SCHEMA: &str = "vmz.profile.conformance_scenario.v0";

/// Schema id for the cross-host conformance check report.
pub const CONFORMANCE_CHECK_SCHEMA: &str = "vmz.profile.conformance_check.v0";

/// Required surface roles for web, template, and web+native mixed conformance runs.
pub const CONFORMANCE_SURFACE_ROLES: &[&str] = &["web", "template", "mixed"];

/// Allowed [`DeliveryUpdatePolicy`] `channel` values.
pub const DELIVERY_UPDATE_CHANNELS: &[&str] = &["rebuild", "store", "hot", "hybrid"];

/// Allowed [`DeliveryProfile`] `assetStrategy` values used in delivery proof.
pub const DELIVERY_ASSET_STRATEGIES: &[&str] = &["bundled", "remote", "hybrid"];

/// Host kinds covered by cross-host lifecycle proof fixtures.
pub const LIFECYCLE_HOST_KINDS: &[&str] = &["browser", "mini", "native"];

/// Allowed `persistenceWindow` values on [`LifecycleBinding`].
pub const PERSISTENCE_WINDOWS: &[&str] = &["none", "suspend", "crash", "owner"];

/// Hard: HostProfile failed structural or invariant validation.
pub const DIAG_HOST_PROFILE_INVALID: &str = "vmz::profile::host_profile_invalid";

/// Hard: DeliveryProfile failed structural or invariant validation.
pub const DIAG_DELIVERY_PROFILE_INVALID: &str = "vmz::profile::delivery_profile_invalid";

/// Hard: DeliveryProfile.hostProfileRef names an unknown or unloaded HostProfile.
pub const DIAG_HOST_PROFILE_REF_UNRESOLVED: &str = "vmz::profile::host_profile_ref_unresolved";

/// Hard: required ResolutionDigest is absent on Delivery or proof assembly.
pub const DIAG_RESOLUTION_DIGEST_MISSING: &str = "vmz::profile::resolution_digest_missing";

/// Hard: ResolutionDigest value does not match the canonical Host+Delivery pair.
pub const DIAG_RESOLUTION_DIGEST_MISMATCH: &str = "vmz::profile::resolution_digest_mismatch";

/// Hard: a contribution overrides an id under the reserved [`CORE_ID_PREFIX`].
pub const DIAG_CORE_ID_OVERRIDE: &str = "vmz::profile::core_id_override";

/// Hard: contributed surface/capability/provider ids are not under the plugin namespace.
pub const DIAG_CONTRIBUTION_NOT_NAMESPACED: &str = "vmz::profile::contribution_not_namespaced";

/// Hard: profile schemaVersion is missing, empty, or not a recognized generation.
pub const DIAG_PROFILE_VERSION_INVALID: &str = "vmz::profile::profile_version_invalid";

/// Hard: no HostProfile surface satisfies the region's SurfaceRequirements.
pub const DIAG_SURFACE_NO_MATCH: &str = "vmz::profile::surface_no_match";

/// Hard: two or more surfaces remain after hard filters with no deterministic tie-break.
pub const DIAG_SURFACE_AMBIGUOUS: &str = "vmz::profile::surface_ambiguous";

/// Hard: a required capability id has no matching CapabilityBinding / provider.
pub const DIAG_CAPABILITY_UNRESOLVED: &str = "vmz::profile::capability_unresolved";

/// Hard: required permissions are not declared on the resolved CapabilityBinding.
pub const DIAG_CAPABILITY_PERMISSION_UNDECLARED: &str =
    "vmz::profile::capability_permission_undeclared";

/// Hard: a route cannot be realized under the host navigation / stack model.
pub const DIAG_ROUTE_UNREALIZABLE: &str = "vmz::profile::route_unrealizable";

/// Hard: envelope generation is older than the executor currentGeneration (stale).
pub const DIAG_STALE_GENERATION: &str = "vmz::profile::stale_generation";

/// Hard: envelope header is missing applicationId / planVersion / transactionId / regionId.
pub const DIAG_MISSING_ENVELOPE_IDS: &str = "vmz::profile::missing_envelope_ids";

/// Hard: a surface driver claims ownership of business state (projection cache only).
pub const DIAG_SURFACE_OWNS_STATE: &str = "vmz::profile::surface_owns_state";

/// Hard: a private runtime object crossed a surface / host boundary in an envelope.
pub const DIAG_PRIVATE_OBJECT_CROSSING: &str = "vmz::profile::private_object_crossing";

/// Hard: one logical write was split into per-surface transactions.
pub const DIAG_SPLIT_TRANSACTION: &str = "vmz::profile::split_transaction";

/// Hard: terminate/cancel was issued without an authoritative DisposeRegion.
pub const DIAG_DISPOSE_NOT_AUTHORITATIVE: &str = "vmz::profile::dispose_not_authoritative";

/// Hard: CancelRequest did not propagate to the listed capability providers.
pub const DIAG_CANCEL_NOT_PROPAGATED: &str = "vmz::profile::cancel_not_propagated";

/// Hard: host lifecycle coverage for required unified events is unproven.
pub const DIAG_LIFECYCLE_UNPROVEN: &str = "vmz::profile::lifecycle_unproven";

/// Hard: LifecycleMappingTable is missing rows for a required unified event on a host.
pub const DIAG_LIFECYCLE_MAPPING_INCOMPLETE: &str = "vmz::profile::lifecycle_mapping_incomplete";

/// Hard: recovery creates a second owner for the same region (duplicate owner).
pub const DIAG_RECOVERY_DUPLICATES_OWNER: &str = "vmz::profile::recovery_duplicates_owner";

/// Hard: recovery assumes JS heap survived across crash / process recreate.
pub const DIAG_RECOVERY_ASSUMES_HEAP: &str = "vmz::profile::recovery_assumes_heap";

/// Hard: persistenceWindow is not one of [`PERSISTENCE_WINDOWS`].
pub const DIAG_PERSISTENCE_WINDOW_INVALID: &str = "vmz::profile::persistence_window_invalid";

/// Hard: delivery package exceeds max surfaces / bytes / allowed surface set.
pub const DIAG_DELIVERY_CONSTRAINT_EXCEEDED: &str = "vmz::profile::delivery_constraint_exceeded";

/// Hard: proof or artifact planVersion does not match the host expected plan version.
pub const DIAG_HOST_PLAN_VERSION_MISMATCH: &str = "vmz::profile::host_plan_version_mismatch";

/// Hard: DeliveryProofManifest is missing required constraint or artifact slices.
pub const DIAG_PROOF_MANIFEST_INCOMPLETE: &str = "vmz::profile::proof_manifest_incomplete";

/// Hard: proof/artifact copies VPG / Plan semantic IR instead of stable id refs.
pub const DIAG_PROOF_COPIES_SEMANTIC_IR: &str = "vmz::profile::proof_copies_semantic_ir";

/// Hard: semantic update shipped without invalidating and re-proving the delivery.
pub const DIAG_UPDATE_WITHOUT_REPROOF: &str = "vmz::profile::update_without_reproof";

/// Hard: security policy allows arbitrary remote without integrity requirements.
pub const DIAG_SECURITY_POLICY_INSECURE: &str = "vmz::profile::security_policy_insecure";

/// Hard: observed stable ids diverge across hosts for the same conformance fixture.
pub const DIAG_STABLE_ID_DIVERGENCE: &str = "vmz::profile::stable_id_divergence";

/// Hard: algebraic state slot results diverge across hosts for the same fixture.
pub const DIAG_STATE_RESULT_DIVERGENCE: &str = "vmz::profile::state_result_divergence";

/// Hard: shared trace invariant keys are missing or broken on a host run.
pub const DIAG_TRACE_INVARIANT_BROKEN: &str = "vmz::profile::trace_invariant_broken";

/// Hard: conformance scenario is missing a required host kind / surface role run.
pub const DIAG_CONFORMANCE_HOST_INCOMPLETE: &str = "vmz::profile::conformance_host_incomplete";

/// Hard: host run surfaceRole is not in [`CONFORMANCE_SURFACE_ROLES`] or mismatches kinds.
pub const DIAG_CONFORMANCE_SURFACE_ROLE_MISMATCH: &str =
    "vmz::profile::conformance_surface_role_mismatch";

/// Reserved core id prefix; plugin contributions must not override ids under it.
pub const CORE_ID_PREFIX: &str = "vmz.";

/// Allowed SurfaceBinding.kind values (`web` / `template` / `native` / `headless`).
pub const SURFACE_KINDS: &[&str] = &["web", "template", "native", "headless"];

/// Unified lifecycle events every HostProfile must map from host-native events.
pub const UNIFIED_LIFECYCLE_EVENTS: &[&str] =
    &["activate", "visible", "hidden", "suspend", "resume", "recover", "dispose"];

/// One document kind entry inside [`ProfileProtocolCatalog`].
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProfileDocumentKind {
    /// Kind id (`host_profile`, `delivery_profile`, `solver_check`, ...).
    pub kind: String,
    /// Schema id for that kind.
    pub schema: String,
}

/// Handshake catalog of frozen profile schemas, diagnostics, and surface/lifecycle vocab.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProfileProtocolCatalog {
    /// Always [`PROFILE_PROTOCOL`].
    pub schema: String,
    /// Same as `schema` (parity with other domain catalogs).
    pub protocol: String,
    /// Document kinds this generation publishes.
    pub documents: Vec<ProfileDocumentKind>,
    /// Stable diagnostic codes callers may see.
    pub diagnostics: Vec<String>,
    /// Allowed surface kinds (copy of [`SURFACE_KINDS`]).
    #[serde(rename = "surfaceKinds")]
    pub surface_kinds: Vec<String>,
    /// Unified lifecycle event vocabulary (copy of [`UNIFIED_LIFECYCLE_EVENTS`]).
    #[serde(rename = "unifiedLifecycleEvents")]
    pub unified_lifecycle_events: Vec<String>,
    /// Reserved core id prefix (copy of [`CORE_ID_PREFIX`]).
    #[serde(rename = "coreIdPrefix")]
    pub core_id_prefix: String,
}

impl ProfileProtocolCatalog {
    /// Frozen catalog for the current profile protocol generation.
    pub fn v0() -> Self {
        Self {
            schema: PROFILE_PROTOCOL.into(),
            protocol: PROFILE_PROTOCOL.into(),
            documents: vec![
                ProfileDocumentKind {
                    kind: "host_profile".into(),
                    schema: HOST_PROFILE_SCHEMA.into(),
                },
                ProfileDocumentKind {
                    kind: "delivery_profile".into(),
                    schema: DELIVERY_PROFILE_SCHEMA.into(),
                },
                ProfileDocumentKind {
                    kind: "surface_binding".into(),
                    schema: SURFACE_BINDING_SCHEMA.into(),
                },
                ProfileDocumentKind {
                    kind: "capability_binding".into(),
                    schema: CAPABILITY_BINDING_SCHEMA.into(),
                },
                ProfileDocumentKind {
                    kind: "lifecycle_binding".into(),
                    schema: LIFECYCLE_BINDING_SCHEMA.into(),
                },
                ProfileDocumentKind {
                    kind: "navigation_binding".into(),
                    schema: NAVIGATION_BINDING_SCHEMA.into(),
                },
                ProfileDocumentKind {
                    kind: "transport_binding".into(),
                    schema: TRANSPORT_BINDING_SCHEMA.into(),
                },
                ProfileDocumentKind {
                    kind: "host_constraints".into(),
                    schema: HOST_CONSTRAINTS_SCHEMA.into(),
                },
                ProfileDocumentKind {
                    kind: "resolution_digest".into(),
                    schema: RESOLUTION_DIGEST_SCHEMA.into(),
                },
                ProfileDocumentKind {
                    kind: "contribution".into(),
                    schema: PROFILE_CONTRIBUTION_SCHEMA.into(),
                },
                ProfileDocumentKind { kind: "check".into(), schema: PROFILE_CHECK_SCHEMA.into() },
                ProfileDocumentKind {
                    kind: "surface_requirements".into(),
                    schema: SURFACE_REQUIREMENTS_SCHEMA.into(),
                },
                ProfileDocumentKind {
                    kind: "capability_requirement".into(),
                    schema: CAPABILITY_REQUIREMENT_SCHEMA.into(),
                },
                ProfileDocumentKind {
                    kind: "surface_assignment_table".into(),
                    schema: SURFACE_ASSIGNMENT_TABLE_SCHEMA.into(),
                },
                ProfileDocumentKind {
                    kind: "capability_resolution_table".into(),
                    schema: CAPABILITY_RESOLUTION_TABLE_SCHEMA.into(),
                },
                ProfileDocumentKind {
                    kind: "route_realization_table".into(),
                    schema: ROUTE_REALIZATION_TABLE_SCHEMA.into(),
                },
                ProfileDocumentKind {
                    kind: "host_resolution_manifest".into(),
                    schema: HOST_RESOLUTION_MANIFEST_SCHEMA.into(),
                },
                ProfileDocumentKind {
                    kind: "solver_input".into(),
                    schema: SOLVER_INPUT_SCHEMA.into(),
                },
                ProfileDocumentKind {
                    kind: "solver_check".into(),
                    schema: SOLVER_CHECK_SCHEMA.into(),
                },
                ProfileDocumentKind {
                    kind: "executor_envelope_header".into(),
                    schema: EXECUTOR_ENVELOPE_HEADER_SCHEMA.into(),
                },
                ProfileDocumentKind {
                    kind: "event_envelope".into(),
                    schema: EVENT_ENVELOPE_SCHEMA.into(),
                },
                ProfileDocumentKind {
                    kind: "executor_transaction".into(),
                    schema: EXECUTOR_TRANSACTION_SCHEMA.into(),
                },
                ProfileDocumentKind {
                    kind: "patch_batch".into(),
                    schema: PATCH_BATCH_SCHEMA.into(),
                },
                ProfileDocumentKind {
                    kind: "dispose_region".into(),
                    schema: DISPOSE_REGION_SCHEMA.into(),
                },
                ProfileDocumentKind {
                    kind: "cancel_request".into(),
                    schema: CANCEL_REQUEST_SCHEMA.into(),
                },
                ProfileDocumentKind {
                    kind: "executor_scenario".into(),
                    schema: EXECUTOR_SCENARIO_SCHEMA.into(),
                },
                ProfileDocumentKind {
                    kind: "executor_check".into(),
                    schema: EXECUTOR_CHECK_SCHEMA.into(),
                },
                ProfileDocumentKind {
                    kind: "lifecycle_mapping_entry".into(),
                    schema: LIFECYCLE_MAPPING_ENTRY_SCHEMA.into(),
                },
                ProfileDocumentKind {
                    kind: "lifecycle_mapping_table".into(),
                    schema: LIFECYCLE_MAPPING_TABLE_SCHEMA.into(),
                },
                ProfileDocumentKind {
                    kind: "recovery_policy".into(),
                    schema: RECOVERY_POLICY_SCHEMA.into(),
                },
                ProfileDocumentKind {
                    kind: "lifecycle_scenario".into(),
                    schema: LIFECYCLE_SCENARIO_SCHEMA.into(),
                },
                ProfileDocumentKind {
                    kind: "lifecycle_recovery_check".into(),
                    schema: LIFECYCLE_RECOVERY_CHECK_SCHEMA.into(),
                },
                ProfileDocumentKind {
                    kind: "delivery_package_constraints".into(),
                    schema: DELIVERY_PACKAGE_CONSTRAINTS_SCHEMA.into(),
                },
                ProfileDocumentKind {
                    kind: "delivery_security_policy".into(),
                    schema: DELIVERY_SECURITY_POLICY_SCHEMA.into(),
                },
                ProfileDocumentKind {
                    kind: "delivery_update_policy".into(),
                    schema: DELIVERY_UPDATE_POLICY_SCHEMA.into(),
                },
                ProfileDocumentKind {
                    kind: "delivery_artifact_manifest".into(),
                    schema: DELIVERY_ARTIFACT_MANIFEST_SCHEMA.into(),
                },
                ProfileDocumentKind {
                    kind: "delivery_proof_manifest".into(),
                    schema: DELIVERY_PROOF_MANIFEST_SCHEMA.into(),
                },
                ProfileDocumentKind {
                    kind: "delivery_proof_scenario".into(),
                    schema: DELIVERY_PROOF_SCENARIO_SCHEMA.into(),
                },
                ProfileDocumentKind {
                    kind: "delivery_proof_check".into(),
                    schema: DELIVERY_PROOF_CHECK_SCHEMA.into(),
                },
                ProfileDocumentKind {
                    kind: "conformance_fixture".into(),
                    schema: CONFORMANCE_FIXTURE_SCHEMA.into(),
                },
                ProfileDocumentKind {
                    kind: "conformance_state_snapshot".into(),
                    schema: CONFORMANCE_STATE_SNAPSHOT_SCHEMA.into(),
                },
                ProfileDocumentKind {
                    kind: "conformance_trace".into(),
                    schema: CONFORMANCE_TRACE_SCHEMA.into(),
                },
                ProfileDocumentKind {
                    kind: "conformance_host_run".into(),
                    schema: CONFORMANCE_HOST_RUN_SCHEMA.into(),
                },
                ProfileDocumentKind {
                    kind: "conformance_scenario".into(),
                    schema: CONFORMANCE_SCENARIO_SCHEMA.into(),
                },
                ProfileDocumentKind {
                    kind: "conformance_check".into(),
                    schema: CONFORMANCE_CHECK_SCHEMA.into(),
                },
            ],
            diagnostics: vec![
                DIAG_HOST_PROFILE_INVALID.into(),
                DIAG_DELIVERY_PROFILE_INVALID.into(),
                DIAG_HOST_PROFILE_REF_UNRESOLVED.into(),
                DIAG_RESOLUTION_DIGEST_MISSING.into(),
                DIAG_RESOLUTION_DIGEST_MISMATCH.into(),
                DIAG_CORE_ID_OVERRIDE.into(),
                DIAG_CONTRIBUTION_NOT_NAMESPACED.into(),
                DIAG_PROFILE_VERSION_INVALID.into(),
                DIAG_SURFACE_NO_MATCH.into(),
                DIAG_SURFACE_AMBIGUOUS.into(),
                DIAG_CAPABILITY_UNRESOLVED.into(),
                DIAG_CAPABILITY_PERMISSION_UNDECLARED.into(),
                DIAG_ROUTE_UNREALIZABLE.into(),
                DIAG_STALE_GENERATION.into(),
                DIAG_MISSING_ENVELOPE_IDS.into(),
                DIAG_SURFACE_OWNS_STATE.into(),
                DIAG_PRIVATE_OBJECT_CROSSING.into(),
                DIAG_SPLIT_TRANSACTION.into(),
                DIAG_DISPOSE_NOT_AUTHORITATIVE.into(),
                DIAG_CANCEL_NOT_PROPAGATED.into(),
                DIAG_LIFECYCLE_UNPROVEN.into(),
                DIAG_LIFECYCLE_MAPPING_INCOMPLETE.into(),
                DIAG_RECOVERY_DUPLICATES_OWNER.into(),
                DIAG_RECOVERY_ASSUMES_HEAP.into(),
                DIAG_PERSISTENCE_WINDOW_INVALID.into(),
                DIAG_DELIVERY_CONSTRAINT_EXCEEDED.into(),
                DIAG_HOST_PLAN_VERSION_MISMATCH.into(),
                DIAG_PROOF_MANIFEST_INCOMPLETE.into(),
                DIAG_PROOF_COPIES_SEMANTIC_IR.into(),
                DIAG_UPDATE_WITHOUT_REPROOF.into(),
                DIAG_SECURITY_POLICY_INSECURE.into(),
                DIAG_STABLE_ID_DIVERGENCE.into(),
                DIAG_STATE_RESULT_DIVERGENCE.into(),
                DIAG_TRACE_INVARIANT_BROKEN.into(),
                DIAG_CONFORMANCE_HOST_INCOMPLETE.into(),
                DIAG_CONFORMANCE_SURFACE_ROLE_MISMATCH.into(),
            ],
            surface_kinds: SURFACE_KINDS.iter().map(|s| (*s).into()).collect(),
            unified_lifecycle_events: UNIFIED_LIFECYCLE_EVENTS
                .iter()
                .map(|s| (*s).into())
                .collect(),
            core_id_prefix: CORE_ID_PREFIX.into(),
        }
    }

    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// One diagnostic finding inside a profile / solver / executor / proof check report.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProfileDiagnostic {
    /// JSON-pointer or logical path to the offending node.
    pub path: String,
    /// Severity token (`error` / `warning` / `advice`).
    pub severity: String,
    /// Human-readable explanation for CLI / LSP presentation.
    pub message: String,
    /// Optional stable `vmz::profile::*` diagnostic code.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

/// Host-declared surface: driver + operation/element/event/style/a11y capabilities.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SurfaceBinding {
    /// Always [`SURFACE_BINDING_SCHEMA`].
    pub schema: String,
    /// Stable SurfaceId used by Delivery defaultSurface and solver assignments.
    #[serde(rename = "surfaceId")]
    pub surface_id: String,
    /// `web` | `template` | `native` | `headless` (see [`SURFACE_KINDS`]).
    pub kind: String,
    /// Driver implementation id that realizes this surface on the host.
    #[serde(rename = "driverId")]
    pub driver_id: String,
    /// Patch / create / dispose operations this driver supports.
    #[serde(rename = "supportedOperations", default)]
    pub supported_operations: Vec<String>,
    /// Element kinds the driver can host (`element`, `text`, `native-view`, ...).
    #[serde(rename = "supportedElementKinds", default)]
    pub supported_element_kinds: Vec<String>,
    /// Event kinds the driver can emit (`click`, `tap`, `capture`, ...).
    #[serde(rename = "supportedEventKinds", default)]
    pub supported_event_kinds: Vec<String>,
    /// Style feature tokens (`css`, `wxss`, ...).
    #[serde(rename = "supportedStyleFeatures", default)]
    pub supported_style_features: Vec<String>,
    /// Accessibility feature tokens (`aria`, ...).
    #[serde(rename = "supportedAccessibility", default)]
    pub supported_accessibility: Vec<String>,
}

/// Host-declared capability: provider, domain, optional transport, permissions.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CapabilityBinding {
    /// Always [`CAPABILITY_BINDING_SCHEMA`].
    pub schema: String,
    /// Stable CapabilityId required by regions / Delivery overrides.
    #[serde(rename = "capabilityId")]
    pub capability_id: String,
    /// Semver range this binding satisfies (e.g. `^0`).
    #[serde(rename = "versionRange")]
    pub version_range: String,
    /// Where the provider runs (`server`, `native`, `client`, ...).
    #[serde(rename = "executionDomain")]
    pub execution_domain: String,
    /// Provider implementation id that fulfills the capability.
    #[serde(rename = "providerId")]
    pub provider_id: String,
    /// Optional TransportId from [`HostProfile::transports`].
    #[serde(rename = "transportId", default, skip_serializing_if = "Option::is_none")]
    pub transport_id: Option<String>,
    /// Host-declared permission tokens the provider may request.
    #[serde(default)]
    pub permissions: Vec<String>,
}

/// Maps one host-native event onto a unified VMZ lifecycle event.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LifecycleBinding {
    /// Always [`LIFECYCLE_BINDING_SCHEMA`].
    pub schema: String,
    /// Host-native event name (e.g. `page.onShow`, `document.attach`).
    #[serde(rename = "hostEvent")]
    pub host_event: String,
    /// Unified lifecycle token from [`UNIFIED_LIFECYCLE_EVENTS`].
    #[serde(rename = "vmzLifecycle")]
    pub vmz_lifecycle: String,
    /// True when the host may emit this mapping more than once per owner lifetime.
    #[serde(rename = "mayRepeat", default)]
    pub may_repeat: bool,
    /// True when the host guarantees delivery of this event under normal operation.
    #[serde(rename = "guaranteed", default)]
    pub guaranteed: bool,
    /// True when crash recovery may skip this event before rematerialization.
    #[serde(rename = "mayBeMissingAfterCrash", default)]
    pub may_be_missing_after_crash: bool,
    /// Resource persistence window: `none` | `suspend` | `crash` | `owner`.
    #[serde(rename = "persistenceWindow", default)]
    pub persistence_window: String,
    /// When true, this lifecycle edge cancels in-flight capabilities for the owner.
    #[serde(rename = "cancelsCapabilities", default)]
    pub cancels_capabilities: bool,
}

/// How the host realizes RouteIds (stack model, deep link, back, restoration).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NavigationBinding {
    /// Always [`NAVIGATION_BINDING_SCHEMA`].
    pub schema: String,
    /// Route realizer implementation id (`vmz.nav.history`, mini page-stack, ...).
    #[serde(rename = "routeRealizerId")]
    pub route_realizer_id: String,
    /// `history` | `page-stack` | `native-stack` | `none`.
    #[serde(rename = "stackModel")]
    pub stack_model: String,
    /// Deep-link acceptance policy token (`url`, `mini-path`, `app-url`, ...).
    #[serde(rename = "deepLinkPolicy", default)]
    pub deep_link_policy: String,
    /// Back-navigation policy token (`history.back`, `navigateBack`, ...).
    #[serde(rename = "backPolicy", default)]
    pub back_policy: String,
    /// State restoration policy token (`bfcache+resume`, `snapshot+reattach`, ...).
    #[serde(rename = "stateRestorationPolicy", default)]
    pub state_restoration_policy: String,
}

/// Named transport used by capability providers (http, mini-request, native-bridge).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TransportBinding {
    /// Always [`TRANSPORT_BINDING_SCHEMA`].
    pub schema: String,
    /// Stable TransportId referenced by CapabilityBinding.transportId.
    #[serde(rename = "transportId")]
    pub transport_id: String,
    /// Transport kind token (`http`, `mini-request`, `native-bridge`, ...).
    pub kind: String,
    /// Endpoint scheme (`#server`, `vmz-native`, ...).
    #[serde(rename = "endpointScheme", default)]
    pub endpoint_scheme: String,
}

/// Hard limits and digest requirements imposed by the host.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HostConstraints {
    /// Always [`HOST_CONSTRAINTS_SCHEMA`].
    pub schema: String,
    /// Optional upper bound on concurrently assigned surfaces.
    #[serde(rename = "maxSurfaces", default, skip_serializing_if = "Option::is_none")]
    pub max_surfaces: Option<u32>,
    /// When false, driver selection is compile-time only (no runtime switch).
    #[serde(rename = "allowsRuntimeDriverSelect", default)]
    pub allows_runtime_driver_select: bool,
    /// When true, Delivery / proof assembly must carry a ResolutionDigest.
    #[serde(rename = "requiresResolutionDigest", default)]
    pub requires_resolution_digest: bool,
}

/// Complete host contract: surfaces, capabilities, lifecycle, navigation, transports.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HostProfile {
    /// Always [`HOST_PROFILE_SCHEMA`].
    pub schema: String,
    /// Profile document generation (`0` for this freeze).
    #[serde(rename = "schemaVersion")]
    pub schema_version: String,
    /// Stable HostId referenced by DeliveryProfile.hostProfileRef.
    #[serde(rename = "hostId")]
    pub host_id: String,
    /// Host implementation version included in ResolutionDigest.
    #[serde(rename = "hostVersion")]
    pub host_version: String,
    /// Surfaces this host can assign to regions.
    #[serde(default)]
    pub surfaces: Vec<SurfaceBinding>,
    /// Capabilities this host can resolve for regions.
    #[serde(default)]
    pub capabilities: Vec<CapabilityBinding>,
    /// Host-event to unified-lifecycle mappings.
    #[serde(default)]
    pub lifecycle: Vec<LifecycleBinding>,
    /// Navigation / stack / deep-link contract for RouteRealization.
    pub navigation: NavigationBinding,
    /// Transports available to capability providers.
    #[serde(default)]
    pub transports: Vec<TransportBinding>,
    /// Host-imposed assignment and digest constraints.
    pub constraints: HostConstraints,
}

impl HostProfile {
    /// Build LifecycleBinding rows from host-event to unified-lifecycle pairs.
    pub fn lifecycle_from_pairs(pairs: &[(&str, &str)]) -> Vec<LifecycleBinding> {
        pairs
            .iter()
            .map(|(host_event, vmz)| LifecycleBinding {
                schema: LIFECYCLE_BINDING_SCHEMA.into(),
                host_event: (*host_event).into(),
                vmz_lifecycle: (*vmz).into(),
                may_repeat: matches!(*vmz, "visible" | "hidden" | "suspend" | "resume"),
                guaranteed: *vmz != "recover",
                may_be_missing_after_crash: matches!(*vmz, "recover" | "suspend" | "resume"),
                persistence_window: match *vmz {
                    "suspend" | "resume" => "suspend".into(),
                    "recover" => "crash".into(),
                    "dispose" => "none".into(),
                    _ => "owner".into(),
                },
                cancels_capabilities: *vmz == "dispose",
            })
            .collect()
    }

    /// Algebraic BrowserHost example (WebSurface + history navigation).
    pub fn browser_example() -> Self {
        Self {
            schema: HOST_PROFILE_SCHEMA.into(),
            schema_version: "0".into(),
            host_id: "vmz.host.browser".into(),
            host_version: "0.1.0".into(),
            surfaces: vec![SurfaceBinding {
                schema: SURFACE_BINDING_SCHEMA.into(),
                surface_id: "vmz.surface.web.main".into(),
                kind: "web".into(),
                driver_id: "vmz.driver.web-dom".into(),
                supported_operations: vec![
                    "CreateNode".into(),
                    "PatchProperty".into(),
                    "PatchText".into(),
                    "DisposeRegion".into(),
                ],
                supported_element_kinds: vec!["element".into(), "text".into()],
                supported_event_kinds: vec!["click".into()],
                supported_style_features: vec!["css".into()],
                supported_accessibility: vec!["aria".into()],
            }],
            capabilities: vec![CapabilityBinding {
                schema: CAPABILITY_BINDING_SCHEMA.into(),
                capability_id: "vmz.capability.server.rpc".into(),
                version_range: "^0".into(),
                execution_domain: "server".into(),
                provider_id: "vmz.provider.browser.fetch".into(),
                transport_id: Some("vmz.transport.http".into()),
                permissions: vec![],
            }],
            lifecycle: Self::lifecycle_from_pairs(&[
                ("document.attach", "activate"),
                ("visibility.visible", "visible"),
                ("visibility.hidden", "hidden"),
                ("page.freeze", "suspend"),
                ("page.thaw", "resume"),
                ("renderer.recover", "recover"),
                ("document.teardown", "dispose"),
            ]),
            navigation: NavigationBinding {
                schema: NAVIGATION_BINDING_SCHEMA.into(),
                route_realizer_id: "vmz.nav.history".into(),
                stack_model: "history".into(),
                deep_link_policy: "url".into(),
                back_policy: "history.back".into(),
                state_restoration_policy: "bfcache+resume".into(),
            },
            transports: vec![TransportBinding {
                schema: TRANSPORT_BINDING_SCHEMA.into(),
                transport_id: "vmz.transport.http".into(),
                kind: "http".into(),
                endpoint_scheme: "#server".into(),
            }],
            constraints: HostConstraints {
                schema: HOST_CONSTRAINTS_SCHEMA.into(),
                max_surfaces: Some(1),
                allows_runtime_driver_select: false,
                requires_resolution_digest: true,
            },
        }
    }

    /// Algebraic WeChatMiniHost example (TemplateSurface + page-stack).
    pub fn wechat_mini_example() -> Self {
        Self {
            schema: HOST_PROFILE_SCHEMA.into(),
            schema_version: "0".into(),
            host_id: "vmz.host.wechat-mini".into(),
            host_version: "0.1.0".into(),
            surfaces: vec![SurfaceBinding {
                schema: SURFACE_BINDING_SCHEMA.into(),
                surface_id: "vmz.surface.template.page".into(),
                kind: "template".into(),
                driver_id: "vmz.driver.mini-template".into(),
                supported_operations: vec![
                    "CreateNode".into(),
                    "PatchProperty".into(),
                    "PatchText".into(),
                    "DisposeRegion".into(),
                ],
                supported_element_kinds: vec!["element".into(), "text".into()],
                supported_event_kinds: vec!["tap".into()],
                supported_style_features: vec!["wxss".into()],
                supported_accessibility: vec![],
            }],
            capabilities: vec![CapabilityBinding {
                schema: CAPABILITY_BINDING_SCHEMA.into(),
                capability_id: "vmz.capability.server.rpc".into(),
                version_range: "^0".into(),
                execution_domain: "server".into(),
                provider_id: "vmz.provider.mini.request".into(),
                transport_id: Some("vmz.transport.mini-request".into()),
                permissions: vec![],
            }],
            lifecycle: Self::lifecycle_from_pairs(&[
                ("page.onLoad", "activate"),
                ("page.onShow", "visible"),
                ("page.onHide", "hidden"),
                ("app.onHide.suspend", "suspend"),
                ("page.onShow.afterSuspend", "resume"),
                ("page.runtime.recover", "recover"),
                ("page.onUnload", "dispose"),
            ]),
            navigation: NavigationBinding {
                schema: NAVIGATION_BINDING_SCHEMA.into(),
                route_realizer_id: "vmz.nav.mini-page-stack".into(),
                stack_model: "page-stack".into(),
                deep_link_policy: "mini-path".into(),
                back_policy: "navigateBack".into(),
                state_restoration_policy: "page-data+resume".into(),
            },
            transports: vec![TransportBinding {
                schema: TRANSPORT_BINDING_SCHEMA.into(),
                transport_id: "vmz.transport.mini-request".into(),
                kind: "mini-request".into(),
                endpoint_scheme: "#server".into(),
            }],
            constraints: HostConstraints {
                schema: HOST_CONSTRAINTS_SCHEMA.into(),
                max_surfaces: Some(1),
                allows_runtime_driver_select: false,
                requires_resolution_digest: true,
            },
        }
    }

    /// Algebraic NativeAppHost example (Web + Native + Headless surfaces).
    pub fn native_app_example() -> Self {
        Self {
            schema: HOST_PROFILE_SCHEMA.into(),
            schema_version: "0".into(),
            host_id: "vmz.host.native-app".into(),
            host_version: "0.1.0".into(),
            surfaces: vec![
                SurfaceBinding {
                    schema: SURFACE_BINDING_SCHEMA.into(),
                    surface_id: "vmz.surface.web.form".into(),
                    kind: "web".into(),
                    driver_id: "vmz.driver.webview".into(),
                    supported_operations: vec![
                        "CreateNode".into(),
                        "PatchProperty".into(),
                        "DisposeRegion".into(),
                    ],
                    supported_element_kinds: vec!["element".into(), "text".into()],
                    supported_event_kinds: vec!["click".into()],
                    supported_style_features: vec!["css".into()],
                    supported_accessibility: vec!["aria".into()],
                },
                SurfaceBinding {
                    schema: SURFACE_BINDING_SCHEMA.into(),
                    surface_id: "vmz.surface.native.camera".into(),
                    kind: "native".into(),
                    driver_id: "vmz.driver.native-camera".into(),
                    supported_operations: vec!["MountSurface".into(), "DisposeRegion".into()],
                    supported_element_kinds: vec!["native-view".into()],
                    supported_event_kinds: vec!["capture".into()],
                    supported_style_features: vec![],
                    supported_accessibility: vec![],
                },
                SurfaceBinding {
                    schema: SURFACE_BINDING_SCHEMA.into(),
                    surface_id: "vmz.surface.headless.upload".into(),
                    kind: "headless".into(),
                    driver_id: "vmz.driver.headless-task".into(),
                    supported_operations: vec!["ActivateTask".into(), "DisposeRegion".into()],
                    supported_element_kinds: vec![],
                    supported_event_kinds: vec![],
                    supported_style_features: vec![],
                    supported_accessibility: vec![],
                },
            ],
            capabilities: vec![CapabilityBinding {
                schema: CAPABILITY_BINDING_SCHEMA.into(),
                capability_id: "vmz.capability.camera.capture".into(),
                version_range: "^0".into(),
                execution_domain: "native".into(),
                provider_id: "vmz.provider.native.camera".into(),
                transport_id: Some("vmz.transport.native-bridge".into()),
                permissions: vec!["camera".into()],
            }],
            lifecycle: Self::lifecycle_from_pairs(&[
                ("scene.attach", "activate"),
                ("app.foreground", "visible"),
                ("app.background.covered", "hidden"),
                ("process.suspend", "suspend"),
                ("app.foreground.restore", "resume"),
                ("webview.process.recreate", "recover"),
                ("owner.teardown", "dispose"),
            ]),
            navigation: NavigationBinding {
                schema: NAVIGATION_BINDING_SCHEMA.into(),
                route_realizer_id: "vmz.nav.native-stack".into(),
                stack_model: "native-stack".into(),
                deep_link_policy: "app-url".into(),
                back_policy: "native.back".into(),
                state_restoration_policy: "snapshot+reattach".into(),
            },
            transports: vec![TransportBinding {
                schema: TRANSPORT_BINDING_SCHEMA.into(),
                transport_id: "vmz.transport.native-bridge".into(),
                kind: "native-bridge".into(),
                endpoint_scheme: "vmz-native".into(),
            }],
            constraints: HostConstraints {
                schema: HOST_CONSTRAINTS_SCHEMA.into(),
                max_surfaces: Some(8),
                allows_runtime_driver_select: false,
                requires_resolution_digest: true,
            },
        }
    }

    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Digest binding a HostProfile identity to a DeliveryId (algebraic, not packaging crypto).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ResolutionDigest {
    /// Always [`RESOLUTION_DIGEST_SCHEMA`].
    pub schema: String,
    /// Digest algorithm token (fixtures use `sha256`).
    pub algorithm: String,
    /// Canonical digest string for the Host+Delivery pair.
    pub value: String,
    /// HostId copied from the bound HostProfile.
    #[serde(rename = "hostProfileId")]
    pub host_profile_id: String,
    /// HostVersion copied from the bound HostProfile.
    #[serde(rename = "hostVersion")]
    pub host_version: String,
    /// DeliveryId this digest seals.
    #[serde(rename = "deliveryId")]
    pub delivery_id: String,
}

impl ResolutionDigest {
    /// Build a digest row for a HostProfile + DeliveryId with an explicit value.
    pub fn for_pair(host: &HostProfile, delivery_id: &str, value: impl Into<String>) -> Self {
        Self {
            schema: RESOLUTION_DIGEST_SCHEMA.into(),
            algorithm: "sha256".into(),
            value: value.into(),
            host_profile_id: host.host_id.clone(),
            host_version: host.host_version.clone(),
            delivery_id: delivery_id.into(),
        }
    }
}

/// Delivery assembly bound to one HostProfile: routes, surfaces, assets, policies, digest.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeliveryProfile {
    /// Always [`DELIVERY_PROFILE_SCHEMA`].
    pub schema: String,
    /// Delivery document generation (`0` for this freeze).
    #[serde(rename = "schemaVersion")]
    pub schema_version: String,
    /// Stable DeliveryId unique within the workspace / catalog.
    #[serde(rename = "deliveryId")]
    pub delivery_id: String,
    /// HostId of the HostProfile this delivery must resolve against.
    #[serde(rename = "hostProfileRef")]
    pub host_profile_ref: String,
    /// Entry RouteIds included in this delivery package.
    #[serde(rename = "entryRoutes", default)]
    pub entry_routes: Vec<String>,
    /// Default SurfaceId when the solver has no requires/prefers edge.
    #[serde(rename = "defaultSurface")]
    pub default_surface: String,
    /// Soft surface selection policy tokens (prefer-default, web-default;native-camera, ...).
    #[serde(rename = "surfacePolicies", default)]
    pub surface_policies: Vec<String>,
    /// Capability override tokens applied after HostProfile bindings.
    #[serde(rename = "capabilityOverrides", default)]
    pub capability_overrides: Vec<String>,
    /// Asset strategy: `bundled` | `remote` | `hybrid` (see [`DELIVERY_ASSET_STRATEGIES`]).
    #[serde(rename = "assetStrategy", default)]
    pub asset_strategy: String,
    /// Update channel token (`rebuild`, `store`, `hot`, `hybrid`).
    #[serde(rename = "updatePolicy", default)]
    pub update_policy: String,
    /// Security policy token (`origin+csp`, `mini-sandbox`, ...).
    #[serde(rename = "securityPolicy", default)]
    pub security_policy: String,
    /// Free-form package constraint labels (main-package, store-bundle, ...).
    #[serde(rename = "packageConstraints", default)]
    pub package_constraints: Vec<String>,
    /// Optional sealed Host+Delivery digest (required when host asks for it).
    #[serde(rename = "resolutionDigest", default, skip_serializing_if = "Option::is_none")]
    pub resolution_digest: Option<ResolutionDigest>,
}

impl DeliveryProfile {
    /// Algebraic Browser Delivery with bundled assets and rebuild updates.
    pub fn browser_bundled_example(host: &HostProfile) -> Self {
        let delivery_id = "vmz.delivery.browser.bundled";
        let digest_value = canonical_digest_value(host, delivery_id);
        Self {
            schema: DELIVERY_PROFILE_SCHEMA.into(),
            schema_version: "0".into(),
            delivery_id: delivery_id.into(),
            host_profile_ref: host.host_id.clone(),
            entry_routes: vec!["pages/index".into()],
            default_surface: "vmz.surface.web.main".into(),
            surface_policies: vec!["prefer-default".into()],
            capability_overrides: vec![],
            asset_strategy: "bundled".into(),
            update_policy: "rebuild".into(),
            security_policy: "origin+csp".into(),
            package_constraints: vec![],
            resolution_digest: Some(ResolutionDigest::for_pair(host, delivery_id, digest_value)),
        }
    }

    /// Algebraic WeChat Mini Delivery (template surface + page-stack package).
    pub fn wechat_mini_example(host: &HostProfile) -> Self {
        let delivery_id = "vmz.delivery.wechat-mini.main";
        let digest_value = canonical_digest_value(host, delivery_id);
        Self {
            schema: DELIVERY_PROFILE_SCHEMA.into(),
            schema_version: "0".into(),
            delivery_id: delivery_id.into(),
            host_profile_ref: host.host_id.clone(),
            entry_routes: vec!["pages/index".into()],
            default_surface: "vmz.surface.template.page".into(),
            surface_policies: vec!["prefer-default".into()],
            capability_overrides: vec![],
            asset_strategy: "bundled".into(),
            update_policy: "store".into(),
            security_policy: "mini-sandbox".into(),
            package_constraints: vec!["main-package".into()],
            resolution_digest: Some(ResolutionDigest::for_pair(host, delivery_id, digest_value)),
        }
    }

    /// Algebraic Native App Delivery (hybrid WebView + native surfaces).
    pub fn native_app_hybrid_example(host: &HostProfile) -> Self {
        let delivery_id = "vmz.delivery.native-app.hybrid";
        let digest_value = canonical_digest_value(host, delivery_id);
        Self {
            schema: DELIVERY_PROFILE_SCHEMA.into(),
            schema_version: "0".into(),
            delivery_id: delivery_id.into(),
            host_profile_ref: host.host_id.clone(),
            entry_routes: vec!["pages/camera".into()],
            default_surface: "vmz.surface.web.form".into(),
            surface_policies: vec!["web-default;native-camera".into()],
            capability_overrides: vec![],
            asset_strategy: "hybrid".into(),
            update_policy: "store".into(),
            security_policy: "app-sandbox+integrity".into(),
            package_constraints: vec!["store-bundle".into()],
            resolution_digest: Some(ResolutionDigest::for_pair(host, delivery_id, digest_value)),
        }
    }

    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Namespaced profile contribution (plugin may only add ids under its namespace).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProfileContribution {
    /// Always [`PROFILE_CONTRIBUTION_SCHEMA`].
    pub schema: String,
    /// Plugin namespace prefix required on all contributed ids.
    #[serde(rename = "pluginNamespace")]
    pub plugin_namespace: String,
    /// SurfaceIds added by the plugin (must be namespaced).
    #[serde(rename = "surfaceIds", default)]
    pub surface_ids: Vec<String>,
    /// CapabilityIds added by the plugin (must be namespaced).
    #[serde(rename = "capabilityIds", default)]
    pub capability_ids: Vec<String>,
    /// ProviderIds added by the plugin (must be namespaced).
    #[serde(rename = "providerIds", default)]
    pub provider_ids: Vec<String>,
}

impl ProfileContribution {
    /// Valid namespaced contribution fixture (no core-id override).
    pub fn example_ok() -> Self {
        Self {
            schema: PROFILE_CONTRIBUTION_SCHEMA.into(),
            plugin_namespace: "com.example".into(),
            surface_ids: vec!["com.example.surface.map".into()],
            capability_ids: vec!["com.example.capability.pay".into()],
            provider_ids: vec!["com.example.provider.pay".into()],
        }
    }
}

/// Deterministic algebraic digest string for a Host+Delivery pair (contract shape freeze).
pub fn canonical_digest_value(host: &HostProfile, delivery_id: &str) -> String {
    format!(
        "sha256:{}:{}:{}:surfaces={}",
        host.host_id,
        host.host_version,
        delivery_id,
        host.surfaces.len()
    )
}

/// Structured profile check result: host + delivery (+ optional contribution) + diagnostics.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProfileCheckReport {
    /// Always [`PROFILE_CHECK_SCHEMA`].
    pub schema: String,
    /// Frozen protocol catalog echoed for consumers.
    pub catalog: ProfileProtocolCatalog,
    /// Host under check.
    #[serde(rename = "hostProfile")]
    pub host_profile: HostProfile,
    /// Delivery under check (must ref the host).
    #[serde(rename = "deliveryProfile")]
    pub delivery_profile: DeliveryProfile,
    /// Optional plugin contribution validated for namespace rules.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contribution: Option<ProfileContribution>,
    /// Findings from structural / digest / contribution validation.
    #[serde(default)]
    pub diagnostics: Vec<ProfileDiagnostic>,
    /// Aggregate status (`pass` / `fail`).
    pub status: String,
}

impl ProfileCheckReport {
    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Region surface requirements inferred from VPG (operations, kinds, events, co-location).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SurfaceRequirements {
    /// Always [`SURFACE_REQUIREMENTS_SCHEMA`].
    pub schema: String,
    /// Operations the assigned surface driver must support.
    #[serde(rename = "requiredOperations", default)]
    pub required_operations: Vec<String>,
    /// Element kinds the surface must host.
    #[serde(rename = "requiredElementKinds", default)]
    pub required_element_kinds: Vec<String>,
    /// Event kinds the surface must emit.
    #[serde(rename = "requiredEvents", default)]
    pub required_events: Vec<String>,
    /// Style feature tokens required of the surface.
    #[serde(rename = "requiredStyleFeatures", default)]
    pub required_style_features: Vec<String>,
    /// Accessibility feature tokens required of the surface.
    #[serde(rename = "requiredAccessibility", default)]
    pub required_accessibility: Vec<String>,
    /// CapabilityIds that must resolve alongside this surface assignment.
    #[serde(rename = "requiredCapabilities", default)]
    pub required_capabilities: Vec<String>,
    /// Co-location constraint tokens (same-surface / split-forbidden, ...).
    #[serde(rename = "coLocationConstraints", default)]
    pub co_location_constraints: Vec<String>,
}

impl SurfaceRequirements {
    /// Browser form-region requirements fixture (DOM ops + css + aria).
    pub fn browser_form_example() -> Self {
        Self {
            schema: SURFACE_REQUIREMENTS_SCHEMA.into(),
            required_operations: vec![
                "CreateNode".into(),
                "PatchProperty".into(),
                "PatchText".into(),
            ],
            required_element_kinds: vec!["element".into(), "text".into()],
            required_events: vec!["click".into()],
            required_style_features: vec!["css".into()],
            required_accessibility: vec!["aria".into()],
            required_capabilities: vec![],
            co_location_constraints: vec![],
        }
    }
}

/// One capability demand the solver must resolve to a Host CapabilityBinding.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CapabilityRequirement {
    /// Always [`CAPABILITY_REQUIREMENT_SCHEMA`].
    pub schema: String,
    /// CapabilityId that must match a host binding.
    #[serde(rename = "capabilityId")]
    pub capability_id: String,
    /// Required semver range (empty means any).
    #[serde(rename = "versionRange", default)]
    pub version_range: String,
    /// Permissions that must be declared on the resolved binding.
    #[serde(default)]
    pub permissions: Vec<String>,
    /// Optional owning RegionId for placement / co-location.
    #[serde(rename = "regionId", default, skip_serializing_if = "Option::is_none")]
    pub region_id: Option<String>,
}

/// One region solve unit: requirements plus optional requires/prefers surface edges.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RegionSolveRequest {
    /// RegionId whose surface assignment is requested.
    #[serde(rename = "regionId")]
    pub region_id: String,
    /// Optional RouteId this region belongs to.
    #[serde(rename = "routeId", default, skip_serializing_if = "Option::is_none")]
    pub route_id: Option<String>,
    /// Hard surface capability requirements for this region.
    pub requirements: SurfaceRequirements,
    /// Graph edge `requiresSurface` - hard constraint SurfaceId.
    #[serde(rename = "requiresSurface", default, skip_serializing_if = "Option::is_none")]
    pub requires_surface: Option<String>,
    /// Graph edge `prefersSurface` - soft ranking SurfaceId.
    #[serde(rename = "prefersSurface", default, skip_serializing_if = "Option::is_none")]
    pub prefers_surface: Option<String>,
}

/// One route the solver must realize under the host navigation binding.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RouteSolveRequest {
    /// RouteId to realize.
    #[serde(rename = "routeId")]
    pub route_id: String,
    /// True when this route is a Delivery entry route.
    #[serde(rename = "isEntry", default)]
    pub is_entry: bool,
}

/// Algebraic solver input - stable ids only (no expressions / component trees).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProfileSolverInput {
    /// Always [`SOLVER_INPUT_SCHEMA`].
    pub schema: String,
    /// Regions that need surface assignment.
    pub regions: Vec<RegionSolveRequest>,
    /// Capabilities that need provider resolution.
    #[serde(default)]
    pub capabilities: Vec<CapabilityRequirement>,
    /// Routes that need navigation realization.
    pub routes: Vec<RouteSolveRequest>,
}

impl ProfileSolverInput {
    /// Browser counter page: one form region + server.rpc + entry route.
    pub fn browser_counter_example() -> Self {
        Self {
            schema: SOLVER_INPUT_SCHEMA.into(),
            regions: vec![RegionSolveRequest {
                region_id: "region:pages/index:root".into(),
                route_id: Some("pages/index".into()),
                requirements: SurfaceRequirements::browser_form_example(),
                requires_surface: None,
                prefers_surface: None,
            }],
            capabilities: vec![CapabilityRequirement {
                schema: CAPABILITY_REQUIREMENT_SCHEMA.into(),
                capability_id: "vmz.capability.server.rpc".into(),
                version_range: "^0".into(),
                permissions: vec![],
                region_id: Some("region:pages/index:root".into()),
            }],
            routes: vec![RouteSolveRequest { route_id: "pages/index".into(), is_entry: true }],
        }
    }
}

/// One surface rejected while assigning a region (with unsatisfied requirement tokens).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SurfaceReject {
    /// SurfaceId that failed the filter.
    #[serde(rename = "surfaceId")]
    pub surface_id: String,
    /// Short reject reason token.
    pub reason: String,
    /// Requirement tokens that remained unsatisfied.
    #[serde(rename = "unsatisfied", default)]
    pub unsatisfied: Vec<String>,
}

/// Final surface assignment for one region, including reject audit trail.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SurfaceAssignment {
    /// RegionId that received the assignment.
    #[serde(rename = "regionId")]
    pub region_id: String,
    /// Chosen SurfaceId.
    #[serde(rename = "surfaceId")]
    pub surface_id: String,
    /// DriverId from the chosen SurfaceBinding.
    #[serde(rename = "driverId")]
    pub driver_id: String,
    /// `unique` | `deterministic_tiebreak` | `requires_surface` | `prefers_surface` | `default_surface`
    pub reason: String,
    /// Surfaces considered and rejected for this region.
    #[serde(default)]
    pub rejected: Vec<SurfaceReject>,
}

/// Table of SurfaceAssignment rows for a Host+Delivery solve.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SurfaceAssignmentTable {
    /// Always [`SURFACE_ASSIGNMENT_TABLE_SCHEMA`].
    pub schema: String,
    /// Per-region assignments.
    pub assignments: Vec<SurfaceAssignment>,
}

/// Resolved capability placement: provider, domain, optional transport and region.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CapabilityResolution {
    /// CapabilityId that was resolved.
    #[serde(rename = "capabilityId")]
    pub capability_id: String,
    /// ProviderId chosen from HostProfile bindings.
    #[serde(rename = "providerId")]
    pub provider_id: String,
    /// Execution domain of the chosen provider.
    #[serde(rename = "executionDomain")]
    pub execution_domain: String,
    /// Optional TransportId used by the provider.
    #[serde(rename = "transportId", default, skip_serializing_if = "Option::is_none")]
    pub transport_id: Option<String>,
    /// Optional RegionId this resolution is scoped to.
    #[serde(rename = "regionId", default, skip_serializing_if = "Option::is_none")]
    pub region_id: Option<String>,
}

/// Table of CapabilityResolution rows for a Host+Delivery solve.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CapabilityResolutionTable {
    /// Always [`CAPABILITY_RESOLUTION_TABLE_SCHEMA`].
    pub schema: String,
    /// Per-capability resolutions.
    pub resolutions: Vec<CapabilityResolution>,
}

/// How one RouteId is realized under the host navigation binding.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RouteRealization {
    /// RouteId realized.
    #[serde(rename = "routeId")]
    pub route_id: String,
    /// Route realizer id from NavigationBinding.
    #[serde(rename = "routeRealizerId")]
    pub route_realizer_id: String,
    /// Stack model copied from NavigationBinding.
    #[serde(rename = "stackModel")]
    pub stack_model: String,
    /// Optional RegionId that owns the route lifetime.
    #[serde(rename = "owningLifetimeRegion", default, skip_serializing_if = "Option::is_none")]
    pub owning_lifetime_region: Option<String>,
    /// SurfaceIds attached while the route is active.
    #[serde(rename = "surfaceIds", default)]
    pub surface_ids: Vec<String>,
}

/// Table of RouteRealization rows for a Host+Delivery solve.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RouteRealizationTable {
    /// Always [`ROUTE_REALIZATION_TABLE_SCHEMA`].
    pub schema: String,
    /// Per-route realizations.
    pub realizations: Vec<RouteRealization>,
}

/// Resolution / assembly result - refs stable ids only (not a second IR).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HostResolutionManifest {
    /// Always [`HOST_RESOLUTION_MANIFEST_SCHEMA`].
    pub schema: String,
    /// HostId that was solved against.
    #[serde(rename = "hostProfileId")]
    pub host_profile_id: String,
    /// DeliveryId that was solved against.
    #[serde(rename = "deliveryId")]
    pub delivery_id: String,
    /// Region to surface assignments.
    #[serde(rename = "surfaceAssignments")]
    pub surface_assignments: SurfaceAssignmentTable,
    /// Capability to provider resolutions.
    #[serde(rename = "capabilityResolutions")]
    pub capability_resolutions: CapabilityResolutionTable,
    /// Route realizations under host navigation.
    #[serde(rename = "routeRealizations")]
    pub route_realizations: RouteRealizationTable,
}

/// Solver check result: host + delivery + input + manifest + diagnostics.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProfileSolverCheckReport {
    /// Always [`SOLVER_CHECK_SCHEMA`].
    pub schema: String,
    /// Frozen protocol catalog echoed for consumers.
    pub catalog: ProfileProtocolCatalog,
    /// Host used for the solve.
    #[serde(rename = "hostProfile")]
    pub host_profile: HostProfile,
    /// Delivery used for the solve.
    #[serde(rename = "deliveryProfile")]
    pub delivery_profile: DeliveryProfile,
    /// Algebraic solver input (stable ids only).
    #[serde(rename = "solverInput")]
    pub solver_input: ProfileSolverInput,
    /// Assembled resolution manifest.
    pub manifest: HostResolutionManifest,
    /// Solver findings (no-match, ambiguous, unrealizable, ...).
    #[serde(default)]
    pub diagnostics: Vec<ProfileDiagnostic>,
    /// Aggregate status (`pass` / `fail`).
    pub status: String,
}

impl ProfileSolverCheckReport {
    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Envelope header shared by Event / Patch / Capability / lifecycle envelopes.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExecutorEnvelopeHeader {
    /// Always [`EXECUTOR_ENVELOPE_HEADER_SCHEMA`].
    pub schema: String,
    /// ApplicationId owning this envelope.
    #[serde(rename = "applicationId")]
    pub application_id: String,
    /// Plan version the executor must match.
    #[serde(rename = "planVersion")]
    pub plan_version: String,
    /// Monotonic generation; stale envelopes must be discarded.
    pub generation: u64,
    /// TransactionId tying event / patches / dispose together.
    #[serde(rename = "transactionId")]
    pub transaction_id: String,
    /// RegionId this envelope applies to.
    #[serde(rename = "regionId")]
    pub region_id: String,
}

impl ExecutorEnvelopeHeader {
    /// True when applicationId, planVersion, transactionId, and regionId are all non-empty.
    pub fn is_complete(&self) -> bool {
        !self.application_id.trim().is_empty()
            && !self.plan_version.trim().is_empty()
            && !self.transaction_id.trim().is_empty()
            && !self.region_id.trim().is_empty()
    }
}

/// Surface-sourced event entering the unified executor.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EventEnvelope {
    /// Always [`EVENT_ENVELOPE_SCHEMA`].
    pub schema: String,
    /// Shared identity / generation header.
    pub header: ExecutorEnvelopeHeader,
    /// Stable EventId for causal replay.
    #[serde(rename = "eventId")]
    pub event_id: String,
    /// Event kind token (`click`, `camera`, ...).
    #[serde(rename = "eventKind", default)]
    pub event_kind: String,
    /// SurfaceId that emitted the event.
    #[serde(rename = "sourceSurfaceId", default)]
    pub source_surface_id: String,
}

/// One logical write transaction spanning bindings across surfaces.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExecutorTransaction {
    /// Always [`EXECUTOR_TRANSACTION_SCHEMA`].
    pub schema: String,
    /// TransactionId shared with envelopes / patches.
    #[serde(rename = "transactionId")]
    pub transaction_id: String,
    /// Generation at which this transaction was opened.
    pub generation: u64,
    /// BindingIds affected by this write.
    #[serde(rename = "affectedBindings", default)]
    pub affected_bindings: Vec<String>,
    /// Foul when true: one logical write split into per-surface transactions.
    #[serde(rename = "splitPerSurface", default)]
    pub split_per_surface: bool,
}

/// Per-surface patch batch under one transaction / generation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PatchBatch {
    /// Always [`PATCH_BATCH_SCHEMA`].
    pub schema: String,
    /// Shared identity / generation header.
    pub header: ExecutorEnvelopeHeader,
    /// Target SurfaceId for these patches.
    #[serde(rename = "surfaceId")]
    pub surface_id: String,
    /// BindingIds patched in this batch.
    #[serde(rename = "bindingIds", default)]
    pub binding_ids: Vec<String>,
    /// Foul when true: private runtime objects crossed the surface boundary.
    #[serde(rename = "carriesPrivateRuntimeObject", default)]
    pub carries_private_runtime_object: bool,
}

/// Algebraic fact about who owns a state slot (surface drivers must not own business state).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StateSlotFact {
    /// SlotId under check.
    #[serde(rename = "slotId")]
    pub slot_id: String,
    /// RegionId that owns the business state.
    #[serde(rename = "ownerRegionId")]
    pub owner_region_id: String,
    /// Foul when true: surface driver claims business-state ownership (cache only).
    #[serde(rename = "surfaceDriverOwnsBusinessState", default)]
    pub surface_driver_owns_business_state: bool,
}

/// Authoritative region terminate; only DisposeRegion may cancel foreign-surface tasks.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DisposeRegion {
    /// Always [`DISPOSE_REGION_SCHEMA`].
    pub schema: String,
    /// Shared identity / generation header.
    pub header: ExecutorEnvelopeHeader,
    /// When true, dispose cancels in-flight capabilities for the owner.
    #[serde(rename = "cancelsCapabilities", default)]
    pub cancels_capabilities: bool,
    /// Must be true for terminate to be authoritative across surfaces.
    #[serde(rename = "isAuthoritativeTerminate", default)]
    pub is_authoritative_terminate: bool,
}

/// Cancel request that must propagate to listed capability providers.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CancelRequest {
    /// Always [`CANCEL_REQUEST_SCHEMA`].
    pub schema: String,
    /// Shared identity / generation header.
    pub header: ExecutorEnvelopeHeader,
    /// CapabilityIds that must receive cancel.
    #[serde(rename = "capabilityIds", default)]
    pub capability_ids: Vec<String>,
    /// True when cancel was observed at each listed provider.
    #[serde(rename = "propagated", default)]
    pub propagated: bool,
}

/// Algebraic Unified Executor scenario fixture (no real Surface adapters).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExecutorScenario {
    /// Always [`EXECUTOR_SCENARIO_SCHEMA`].
    pub schema: String,
    /// Executor currentGeneration used for stale checks.
    #[serde(rename = "currentGeneration")]
    pub current_generation: u64,
    /// Ownership facts for slots under the scenario.
    #[serde(rename = "stateSlots", default)]
    pub state_slots: Vec<StateSlotFact>,
    /// Optional incoming event that opens the transaction.
    #[serde(rename = "incomingEvent", default, skip_serializing_if = "Option::is_none")]
    pub incoming_event: Option<EventEnvelope>,
    /// Optional transaction opened for the event.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transaction: Option<ExecutorTransaction>,
    /// Patch batches emitted under the transaction.
    #[serde(rename = "patchBatches", default)]
    pub patch_batches: Vec<PatchBatch>,
    /// Optional authoritative dispose for the owner region.
    #[serde(rename = "disposeRegion", default, skip_serializing_if = "Option::is_none")]
    pub dispose_region: Option<DisposeRegion>,
    /// Cancel requests that must propagate.
    #[serde(rename = "cancelRequests", default)]
    pub cancel_requests: Vec<CancelRequest>,
    /// Foul: driver unload cancels tasks owned by other surfaces without DisposeRegion.
    #[serde(rename = "driverUnloadCancelsForeignTasks", default)]
    pub driver_unload_cancels_foreign_tasks: bool,
    /// When envelope generation < currentGeneration, patches must not be produced.
    #[serde(rename = "mustDiscardStale", default)]
    pub must_discard_stale: bool,
    /// Foul: scenario claims patches were emitted from a stale envelope.
    #[serde(rename = "producedPatchesFromStale", default)]
    pub produced_patches_from_stale: bool,
}

impl ExecutorScenario {
    /// Mixed page: camera event opens T42, then web + native + headless patch batches.
    pub fn mixed_camera_t42_example() -> Self {
        let generation = 7u64;
        let app = "app:mixed-camera";
        let plan = "plan:v1";
        let region = "region:pages/camera:page";
        let tx = "T42";
        let header = |tid: &str| ExecutorEnvelopeHeader {
            schema: EXECUTOR_ENVELOPE_HEADER_SCHEMA.into(),
            application_id: app.into(),
            plan_version: plan.into(),
            generation,
            transaction_id: tid.into(),
            region_id: region.into(),
        };
        Self {
            schema: EXECUTOR_SCENARIO_SCHEMA.into(),
            current_generation: generation,
            state_slots: vec![
                StateSlotFact {
                    slot_id: "slot:previewUrl".into(),
                    owner_region_id: region.into(),
                    surface_driver_owns_business_state: false,
                },
                StateSlotFact {
                    slot_id: "slot:captureState".into(),
                    owner_region_id: region.into(),
                    surface_driver_owns_business_state: false,
                },
                StateSlotFact {
                    slot_id: "slot:upload".into(),
                    owner_region_id: region.into(),
                    surface_driver_owns_business_state: false,
                },
            ],
            incoming_event: Some(EventEnvelope {
                schema: EVENT_ENVELOPE_SCHEMA.into(),
                header: header(tx),
                event_id: "evt:camera.capture".into(),
                event_kind: "camera".into(),
                source_surface_id: "vmz.surface.native.camera".into(),
            }),
            transaction: Some(ExecutorTransaction {
                schema: EXECUTOR_TRANSACTION_SCHEMA.into(),
                transaction_id: tx.into(),
                generation,
                affected_bindings: vec![
                    "web.previewUrl".into(),
                    "native.captureState".into(),
                    "headless.upload".into(),
                ],
                split_per_surface: false,
            }),
            patch_batches: vec![
                PatchBatch {
                    schema: PATCH_BATCH_SCHEMA.into(),
                    header: header(tx),
                    surface_id: "vmz.surface.web.main".into(),
                    binding_ids: vec!["web.previewUrl".into()],
                    carries_private_runtime_object: false,
                },
                PatchBatch {
                    schema: PATCH_BATCH_SCHEMA.into(),
                    header: header(tx),
                    surface_id: "vmz.surface.native.camera".into(),
                    binding_ids: vec!["native.captureState".into()],
                    carries_private_runtime_object: false,
                },
                PatchBatch {
                    schema: PATCH_BATCH_SCHEMA.into(),
                    header: header(tx),
                    surface_id: "vmz.surface.headless.upload".into(),
                    binding_ids: vec!["headless.upload".into()],
                    carries_private_runtime_object: false,
                },
            ],
            dispose_region: None,
            cancel_requests: vec![],
            driver_unload_cancels_foreign_tasks: false,
            must_discard_stale: true,
            produced_patches_from_stale: false,
        }
    }
}

/// Executor invariant check result for one scenario.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExecutorCheckReport {
    /// Always [`EXECUTOR_CHECK_SCHEMA`].
    pub schema: String,
    /// Frozen protocol catalog echoed for consumers.
    pub catalog: ProfileProtocolCatalog,
    /// Scenario under check.
    pub scenario: ExecutorScenario,
    /// Executor findings (stale, split tx, private object, ...).
    #[serde(default)]
    pub diagnostics: Vec<ProfileDiagnostic>,
    /// Aggregate status (`pass` / `fail`).
    pub status: String,
}

impl ExecutorCheckReport {
    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// One host's lifecycle slice in a cross-host scenario.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HostLifecycleSlice {
    /// HostId for this slice.
    #[serde(rename = "hostId")]
    pub host_id: String,
    /// `browser` | `mini` | `native` (see [`LIFECYCLE_HOST_KINDS`]).
    #[serde(rename = "hostKind")]
    pub host_kind: String,
    /// LifecycleBinding rows for this host.
    #[serde(default)]
    pub lifecycle: Vec<LifecycleBinding>,
}

/// LifecycleMappingTable entry - refs host + unified event only.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LifecycleMappingEntry {
    /// Always [`LIFECYCLE_MAPPING_ENTRY_SCHEMA`].
    pub schema: String,
    /// HostId that owns this mapping row.
    #[serde(rename = "hostId")]
    pub host_id: String,
    /// Host-native event name.
    #[serde(rename = "hostEvent")]
    pub host_event: String,
    /// Unified lifecycle token from [`UNIFIED_LIFECYCLE_EVENTS`].
    #[serde(rename = "vmzLifecycle")]
    pub vmz_lifecycle: String,
    /// True when the host may emit this mapping more than once.
    #[serde(rename = "mayRepeat", default)]
    pub may_repeat: bool,
    /// True when the host guarantees delivery under normal operation.
    #[serde(rename = "guaranteed", default)]
    pub guaranteed: bool,
    /// True when crash recovery may skip this event.
    #[serde(rename = "mayBeMissingAfterCrash", default)]
    pub may_be_missing_after_crash: bool,
    /// Persistence window token from [`PERSISTENCE_WINDOWS`].
    #[serde(rename = "persistenceWindow", default)]
    pub persistence_window: String,
    /// When true, this edge cancels in-flight capabilities.
    #[serde(rename = "cancelsCapabilities", default)]
    pub cancels_capabilities: bool,
}

/// Cross-host table of LifecycleMappingEntry rows.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LifecycleMappingTable {
    /// Always [`LIFECYCLE_MAPPING_TABLE_SCHEMA`].
    pub schema: String,
    /// Flattened mapping rows across hosts.
    pub entries: Vec<LifecycleMappingEntry>,
}

impl LifecycleMappingTable {
    /// Flatten HostLifecycleSlice bindings into a mapping table.
    pub fn from_hosts(hosts: &[HostLifecycleSlice]) -> Self {
        let mut entries = Vec::new();
        for host in hosts {
            for b in &host.lifecycle {
                entries.push(LifecycleMappingEntry {
                    schema: LIFECYCLE_MAPPING_ENTRY_SCHEMA.into(),
                    host_id: host.host_id.clone(),
                    host_event: b.host_event.clone(),
                    vmz_lifecycle: b.vmz_lifecycle.clone(),
                    may_repeat: b.may_repeat,
                    guaranteed: b.guaranteed,
                    may_be_missing_after_crash: b.may_be_missing_after_crash,
                    persistence_window: b.persistence_window.clone(),
                    cancels_capabilities: b.cancels_capabilities,
                });
            }
        }
        Self { schema: LIFECYCLE_MAPPING_TABLE_SCHEMA.into(), entries }
    }
}

/// Crash recovery must reattach surfaces to the same owner - never duplicate.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RecoveryPolicy {
    /// Always [`RECOVERY_POLICY_SCHEMA`].
    pub schema: String,
    /// Stable policy id for explain / catalog.
    #[serde(rename = "policyId")]
    pub policy_id: String,
    /// RegionId that remains the sole owner across recover.
    #[serde(rename = "ownerRegionId")]
    pub owner_region_id: String,
    /// Rematerialize UI / plan from a durable snapshot.
    #[serde(rename = "rematerializeFromSnapshot", default)]
    pub rematerialize_from_snapshot: bool,
    /// Rematerialize using the recorded plan generation.
    #[serde(rename = "rematerializePlanGeneration", default)]
    pub rematerialize_plan_generation: bool,
    /// Foul: crash restore must not assume JS heap survived.
    #[serde(rename = "assumesJsHeapSurvived", default)]
    pub assumes_js_heap_survived: bool,
    /// Foul: recover must not create a second owner for the same region.
    #[serde(rename = "createsNewOwnerOnRecover", default)]
    pub creates_new_owner_on_recover: bool,
    /// SurfaceIds that must reattach to the same owner after recover.
    #[serde(rename = "surfaceIdsToReattach", default)]
    pub surface_ids_to_reattach: Vec<String>,
    /// Capabilities cancel only on owner DisposeRegion, not on surface unload.
    #[serde(rename = "cancelsCapabilitiesOnlyOnOwnerDispose", default)]
    pub cancels_capabilities_only_on_owner_dispose: bool,
}

/// Algebraic fixture: Browser + Mini + Native map to unified lifecycle + recovery.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LifecycleScenario {
    /// Always [`LIFECYCLE_SCENARIO_SCHEMA`].
    pub schema: String,
    /// Per-host lifecycle slices.
    #[serde(default)]
    pub hosts: Vec<HostLifecycleSlice>,
    /// Flattened cross-host mapping table.
    #[serde(rename = "mappingTable")]
    pub mapping_table: LifecycleMappingTable,
    /// Crash recovery policy under check.
    pub recovery: RecoveryPolicy,
}

impl LifecycleScenario {
    /// Cross-host recovery: WebView crash reattaches surfaces; owner RegionId unchanged.
    pub fn cross_host_recovery_example() -> Self {
        let browser = HostProfile::browser_example();
        let mini = HostProfile::wechat_mini_example();
        let native = HostProfile::native_app_example();
        let hosts = vec![
            HostLifecycleSlice {
                host_id: browser.host_id.clone(),
                host_kind: "browser".into(),
                lifecycle: browser.lifecycle.clone(),
            },
            HostLifecycleSlice {
                host_id: mini.host_id.clone(),
                host_kind: "mini".into(),
                lifecycle: mini.lifecycle.clone(),
            },
            HostLifecycleSlice {
                host_id: native.host_id.clone(),
                host_kind: "native".into(),
                lifecycle: native.lifecycle.clone(),
            },
        ];
        let mapping_table = LifecycleMappingTable::from_hosts(&hosts);
        Self {
            schema: LIFECYCLE_SCENARIO_SCHEMA.into(),
            hosts,
            mapping_table,
            recovery: RecoveryPolicy {
                schema: RECOVERY_POLICY_SCHEMA.into(),
                policy_id: "vmz.recovery.reattach-from-snapshot".into(),
                owner_region_id: "region:pages/camera:page".into(),
                rematerialize_from_snapshot: true,
                rematerialize_plan_generation: true,
                assumes_js_heap_survived: false,
                creates_new_owner_on_recover: false,
                surface_ids_to_reattach: vec![
                    "vmz.surface.web.form".into(),
                    "vmz.surface.native.camera".into(),
                    "vmz.surface.headless.upload".into(),
                ],
                cancels_capabilities_only_on_owner_dispose: true,
            },
        }
    }
}

/// Lifecycle + recovery check result for one scenario.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LifecycleRecoveryCheckReport {
    /// Always [`LIFECYCLE_RECOVERY_CHECK_SCHEMA`].
    pub schema: String,
    /// Frozen protocol catalog echoed for consumers.
    pub catalog: ProfileProtocolCatalog,
    /// Scenario under check.
    pub scenario: LifecycleScenario,
    /// Lifecycle / recovery findings.
    #[serde(default)]
    pub diagnostics: Vec<ProfileDiagnostic>,
    /// Aggregate status (`pass` / `fail`).
    pub status: String,
}

impl LifecycleRecoveryCheckReport {
    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Structured package constraints proved at Delivery assembly time.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeliveryPackageConstraints {
    /// Always [`DELIVERY_PACKAGE_CONSTRAINTS_SCHEMA`].
    pub schema: String,
    /// Optional max surfaces allowed in the package.
    #[serde(rename = "maxSurfaces", default, skip_serializing_if = "Option::is_none")]
    pub max_surfaces: Option<u32>,
    /// Optional max packaged byte budget.
    #[serde(rename = "maxPackageBytes", default, skip_serializing_if = "Option::is_none")]
    pub max_package_bytes: Option<u64>,
    /// Allow-list of SurfaceIds that may be included.
    #[serde(rename = "allowedSurfaceIds", default)]
    pub allowed_surface_ids: Vec<String>,
    /// When true, artifact must carry a ResolutionDigest.
    #[serde(rename = "requiresResolutionDigest", default)]
    pub requires_resolution_digest: bool,
}

/// Security policy for a Delivery (not a free-form string).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeliverySecurityPolicy {
    /// Always [`DELIVERY_SECURITY_POLICY_SCHEMA`].
    pub schema: String,
    /// Stable policy id (`vmz.security.origin+csp`, ...).
    #[serde(rename = "policyId")]
    pub policy_id: String,
    /// Require origin isolation between deliveries / frames.
    #[serde(rename = "requiresOriginIsolation", default)]
    pub requires_origin_isolation: bool,
    /// Require integrity checks for remote assets.
    #[serde(rename = "requiresIntegrityForRemote", default)]
    pub requires_integrity_for_remote: bool,
    /// Foul when true without requiresIntegrityForRemote.
    #[serde(rename = "allowsArbitraryRemote", default)]
    pub allows_arbitrary_remote: bool,
    /// CSP / sandbox profile token (`strict`, `mini`, `app`, ...).
    #[serde(rename = "cspProfile", default)]
    pub csp_profile: String,
}

/// Update / rollback policy - semantic changes must invalidate and re-prove.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeliveryUpdatePolicy {
    /// Always [`DELIVERY_UPDATE_POLICY_SCHEMA`].
    pub schema: String,
    /// Stable policy id.
    #[serde(rename = "policyId")]
    pub policy_id: String,
    /// `rebuild` | `store` | `hot` | `hybrid` (see [`DELIVERY_UPDATE_CHANNELS`]).
    pub channel: String,
    /// When true, semantic change requires a fresh DeliveryProofManifest.
    #[serde(rename = "requiresReproofOnSemanticChange", default)]
    pub requires_reproof_on_semantic_change: bool,
    /// Rollback strategy token (`previous_bundle`, ...).
    #[serde(default)]
    pub rollback: String,
}

/// DeliveryArtifactManifest - refs stable ids only (no VPG / Plan IR copy).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeliveryArtifactManifest {
    /// Always [`DELIVERY_ARTIFACT_MANIFEST_SCHEMA`].
    pub schema: String,
    /// DeliveryId this artifact belongs to.
    #[serde(rename = "deliveryId")]
    pub delivery_id: String,
    /// HostId this artifact was assembled for.
    #[serde(rename = "hostProfileId")]
    pub host_profile_id: String,
    /// Plan version sealed into the artifact.
    #[serde(rename = "planVersion")]
    pub plan_version: String,
    /// SurfaceIds included in the package.
    #[serde(rename = "includedSurfaceIds", default)]
    pub included_surface_ids: Vec<String>,
    /// CapabilityIds included in the package.
    #[serde(rename = "includedCapabilityIds", default)]
    pub included_capability_ids: Vec<String>,
    /// Entry RouteIds included in the package.
    #[serde(rename = "entryRouteIds", default)]
    pub entry_route_ids: Vec<String>,
    /// Host+Delivery resolution digest.
    #[serde(rename = "resolutionDigest")]
    pub resolution_digest: ResolutionDigest,
    /// Estimated packaged size in bytes.
    #[serde(rename = "estimatedPackageBytes", default)]
    pub estimated_package_bytes: u64,
    /// Foul: proof/artifact must not copy VPG/Plan semantic IR.
    #[serde(rename = "copiesSemanticIr", default)]
    pub copies_semantic_ir: bool,
}

/// Proof that package / security / update constraints hold for a Delivery.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeliveryProofManifest {
    /// Always [`DELIVERY_PROOF_MANIFEST_SCHEMA`].
    pub schema: String,
    /// DeliveryId under proof.
    #[serde(rename = "deliveryId")]
    pub delivery_id: String,
    /// HostId under proof.
    #[serde(rename = "hostProfileId")]
    pub host_profile_id: String,
    /// Plan version that must match host expectations.
    #[serde(rename = "planVersion")]
    pub plan_version: String,
    /// Package size / surface allow-list constraints.
    #[serde(rename = "packageConstraints")]
    pub package_constraints: DeliveryPackageConstraints,
    /// Origin / integrity / CSP policy.
    #[serde(rename = "securityPolicy")]
    pub security_policy: DeliverySecurityPolicy,
    /// Update channel + reproof requirements.
    #[serde(rename = "updatePolicy")]
    pub update_policy: DeliveryUpdatePolicy,
    /// Artifact manifest sealed by this proof.
    pub artifact: DeliveryArtifactManifest,
    /// Constraint proof tokens that held (`surfaces-within-budget`, ...).
    #[serde(rename = "constraintProofs", default)]
    pub constraint_proofs: Vec<String>,
    /// Explain-index refs for entry routes (`route:...`).
    #[serde(rename = "explainIndexRefs", default)]
    pub explain_index_refs: Vec<String>,
}

/// One host + delivery + proof unit inside a scenario.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeliveryProofUnit {
    /// Host kind token (`browser` / `mini` / `native`).
    #[serde(rename = "hostKind")]
    pub host_kind: String,
    /// HostProfile under proof.
    pub host: HostProfile,
    /// DeliveryProfile under proof.
    pub delivery: DeliveryProfile,
    /// Assembled proof manifest.
    pub proof: DeliveryProofManifest,
}

/// Algebraic fixture: Browser / Mini / Native delivery proofs.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeliveryProofScenario {
    /// Always [`DELIVERY_PROOF_SCENARIO_SCHEMA`].
    pub schema: String,
    /// Per-host proof units.
    #[serde(default)]
    pub units: Vec<DeliveryProofUnit>,
    /// Host-side expected plan version (must match each proof/artifact).
    #[serde(rename = "expectedPlanVersion")]
    pub expected_plan_version: String,
}

impl DeliveryProofScenario {
    fn unit_for(
        host_kind: &str,
        host: HostProfile,
        delivery: DeliveryProfile,
        max_bytes: u64,
        estimated_bytes: u64,
        security: DeliverySecurityPolicy,
        update_channel: &str,
    ) -> DeliveryProofUnit {
        let surface_ids: Vec<String> = host.surfaces.iter().map(|s| s.surface_id.clone()).collect();
        let capability_ids: Vec<String> =
            host.capabilities.iter().map(|c| c.capability_id.clone()).collect();
        let digest = delivery.resolution_digest.clone().unwrap_or_else(|| {
            ResolutionDigest::for_pair(
                &host,
                &delivery.delivery_id,
                canonical_digest_value(&host, &delivery.delivery_id),
            )
        });
        let plan_version: String = "plan.v0".into();
        let proof = DeliveryProofManifest {
            schema: DELIVERY_PROOF_MANIFEST_SCHEMA.into(),
            delivery_id: delivery.delivery_id.clone(),
            host_profile_id: host.host_id.clone(),
            plan_version: plan_version.clone(),
            package_constraints: DeliveryPackageConstraints {
                schema: DELIVERY_PACKAGE_CONSTRAINTS_SCHEMA.into(),
                max_surfaces: Some(surface_ids.len() as u32),
                max_package_bytes: Some(max_bytes),
                allowed_surface_ids: surface_ids.clone(),
                requires_resolution_digest: true,
            },
            security_policy: security,
            update_policy: DeliveryUpdatePolicy {
                schema: DELIVERY_UPDATE_POLICY_SCHEMA.into(),
                policy_id: format!("vmz.update.{}", delivery.delivery_id),
                channel: update_channel.into(),
                requires_reproof_on_semantic_change: true,
                rollback: "previous_bundle".into(),
            },
            artifact: DeliveryArtifactManifest {
                schema: DELIVERY_ARTIFACT_MANIFEST_SCHEMA.into(),
                delivery_id: delivery.delivery_id.clone(),
                host_profile_id: host.host_id.clone(),
                plan_version,
                included_surface_ids: surface_ids,
                included_capability_ids: capability_ids,
                entry_route_ids: delivery.entry_routes.clone(),
                resolution_digest: digest,
                estimated_package_bytes: estimated_bytes,
                copies_semantic_ir: false,
            },
            constraint_proofs: vec![
                "surfaces-within-budget".into(),
                "bytes-within-budget".into(),
                "digest-bound".into(),
                "security-policy-held".into(),
                "update-reproof-required".into(),
            ],
            explain_index_refs: delivery
                .entry_routes
                .iter()
                .map(|r| format!("route:{r}"))
                .collect(),
        };
        DeliveryProofUnit { host_kind: host_kind.into(), host, delivery, proof }
    }

    /// Cross-delivery proof: Browser bundled + Mini main + Native hybrid.
    pub fn cross_delivery_proof_example() -> Self {
        let browser_host = HostProfile::browser_example();
        let mini_host = HostProfile::wechat_mini_example();
        let native_host = HostProfile::native_app_example();
        let browser_delivery = DeliveryProfile::browser_bundled_example(&browser_host);
        let mini_delivery = DeliveryProfile::wechat_mini_example(&mini_host);
        let native_delivery = DeliveryProfile::native_app_hybrid_example(&native_host);
        let units = vec![
            Self::unit_for(
                "browser",
                browser_host,
                browser_delivery,
                2_000_000,
                512_000,
                DeliverySecurityPolicy {
                    schema: DELIVERY_SECURITY_POLICY_SCHEMA.into(),
                    policy_id: "vmz.security.origin+csp".into(),
                    requires_origin_isolation: true,
                    requires_integrity_for_remote: true,
                    allows_arbitrary_remote: false,
                    csp_profile: "strict".into(),
                },
                "rebuild",
            ),
            Self::unit_for(
                "mini",
                mini_host,
                mini_delivery,
                2_000_000,
                800_000,
                DeliverySecurityPolicy {
                    schema: DELIVERY_SECURITY_POLICY_SCHEMA.into(),
                    policy_id: "vmz.security.mini-sandbox".into(),
                    requires_origin_isolation: true,
                    requires_integrity_for_remote: true,
                    allows_arbitrary_remote: false,
                    csp_profile: "mini".into(),
                },
                "store",
            ),
            Self::unit_for(
                "native",
                native_host,
                native_delivery,
                8_000_000,
                3_000_000,
                DeliverySecurityPolicy {
                    schema: DELIVERY_SECURITY_POLICY_SCHEMA.into(),
                    policy_id: "vmz.security.app-sandbox+integrity".into(),
                    requires_origin_isolation: true,
                    requires_integrity_for_remote: true,
                    allows_arbitrary_remote: false,
                    csp_profile: "app".into(),
                },
                "store",
            ),
        ];
        Self {
            schema: DELIVERY_PROOF_SCENARIO_SCHEMA.into(),
            units,
            expected_plan_version: "plan.v0".into(),
        }
    }
}

/// Delivery proof check result for one multi-host scenario.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeliveryProofCheckReport {
    /// Always [`DELIVERY_PROOF_CHECK_SCHEMA`].
    pub schema: String,
    /// Frozen protocol catalog echoed for consumers.
    pub catalog: ProfileProtocolCatalog,
    /// Scenario under check.
    pub scenario: DeliveryProofScenario,
    /// Delivery proof findings (budget, integrity, reproof, ...).
    #[serde(default)]
    pub diagnostics: Vec<ProfileDiagnostic>,
    /// Aggregate status (`pass` / `fail`).
    pub status: String,
}

impl DeliveryProofCheckReport {
    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Shared conformance fixture - stable ids only (no host-private objects).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConformanceFixture {
    /// Always [`CONFORMANCE_FIXTURE_SCHEMA`].
    pub schema: String,
    /// Stable fixture id shared across host runs.
    #[serde(rename = "fixtureId")]
    pub fixture_id: String,
    /// ApplicationId exercised by the fixture.
    #[serde(rename = "applicationId")]
    pub application_id: String,
    /// Plan version the fixture assumes.
    #[serde(rename = "planVersion")]
    pub plan_version: String,
    /// RegionIds present in the fixture graph.
    #[serde(rename = "regionIds", default)]
    pub region_ids: Vec<String>,
    /// BindingIds present in the fixture graph.
    #[serde(rename = "bindingIds", default)]
    pub binding_ids: Vec<String>,
    /// RouteIds present in the fixture graph.
    #[serde(rename = "routeIds", default)]
    pub route_ids: Vec<String>,
    /// SlotIds present in the fixture graph.
    #[serde(rename = "slotIds", default)]
    pub slot_ids: Vec<String>,
}

impl ConformanceFixture {
    /// Sorted unique union of region / binding / route / slot ids.
    pub fn all_stable_ids(&self) -> Vec<String> {
        let mut ids = Vec::new();
        ids.extend(self.region_ids.iter().cloned());
        ids.extend(self.binding_ids.iter().cloned());
        ids.extend(self.route_ids.iter().cloned());
        ids.extend(self.slot_ids.iter().cloned());
        ids.sort();
        ids.dedup();
        ids
    }
}

/// One slot value observed after the shared fixture script.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConformanceSlotValue {
    /// SlotId whose value was observed.
    #[serde(rename = "slotId")]
    pub slot_id: String,
    /// Algebraic string value for cross-host comparison.
    pub value: String,
}

/// Algebraic state result after the shared fixture script.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConformanceStateSnapshot {
    /// Always [`CONFORMANCE_STATE_SNAPSHOT_SCHEMA`].
    pub schema: String,
    /// Slot values after the fixture script.
    #[serde(rename = "slotValues", default)]
    pub slot_values: Vec<ConformanceSlotValue>,
}

impl ConformanceStateSnapshot {
    /// Sorted (slotId, value) pairs for deterministic cross-host compare.
    pub fn normalized_pairs(&self) -> Vec<(String, String)> {
        let mut pairs: Vec<(String, String)> =
            self.slot_values.iter().map(|s| (s.slot_id.clone(), s.value.clone())).collect();
        pairs.sort();
        pairs
    }
}

/// One trace event carrying stable ids and transaction / generation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConformanceTraceEvent {
    /// EventId within the host run.
    #[serde(rename = "eventId")]
    pub event_id: String,
    /// Event kind (`lifecycle`, `write`, `patch`, ...).
    pub kind: String,
    /// Stable ids touched by this event.
    #[serde(rename = "stableIds", default)]
    pub stable_ids: Vec<String>,
    /// TransactionId when applicable.
    #[serde(rename = "transactionId", default)]
    pub transaction_id: String,
    /// Generation at which the event was recorded.
    pub generation: u64,
}

/// Trace with sorted invariant keys shared across hosts.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConformanceTrace {
    /// Always [`CONFORMANCE_TRACE_SCHEMA`].
    pub schema: String,
    /// Ordered trace events for the run.
    #[serde(default)]
    pub events: Vec<ConformanceTraceEvent>,
    /// Invariant key strings that must match expectedTraceInvariantKeys.
    #[serde(rename = "invariantKeys", default)]
    pub invariant_keys: Vec<String>,
}

/// One host's algebraic run of the shared fixture.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConformanceHostRun {
    /// Always [`CONFORMANCE_HOST_RUN_SCHEMA`].
    pub schema: String,
    /// Host kind token (`browser` / `mini` / `native`).
    #[serde(rename = "hostKind")]
    pub host_kind: String,
    /// `web` | `template` | `mixed` (see [`CONFORMANCE_SURFACE_ROLES`]).
    #[serde(rename = "surfaceRole")]
    pub surface_role: String,
    /// Surface kinds exercised in this run.
    #[serde(rename = "surfaceKinds", default)]
    pub surface_kinds: Vec<String>,
    /// SurfaceIds exercised in this run.
    #[serde(rename = "surfaceIds", default)]
    pub surface_ids: Vec<String>,
    /// Stable ids observed (must match fixture union across hosts).
    #[serde(rename = "observedStableIds", default)]
    pub observed_stable_ids: Vec<String>,
    /// Algebraic state after the script.
    pub state: ConformanceStateSnapshot,
    /// Trace + invariant keys for this run.
    pub trace: ConformanceTrace,
    /// Foul: host-private objects must not enter cross-host evidence.
    #[serde(rename = "usesPrivateRuntimeObjects", default)]
    pub uses_private_runtime_objects: bool,
}

/// Scenario: same fixture on WebSurface, TemplateSurface, and Web+Native mixed.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConformanceScenario {
    /// Always [`CONFORMANCE_SCENARIO_SCHEMA`].
    pub schema: String,
    /// Shared fixture (stable ids only).
    pub fixture: ConformanceFixture,
    /// Expected algebraic state after the script.
    #[serde(rename = "expectedState")]
    pub expected_state: ConformanceStateSnapshot,
    /// Expected trace invariant keys shared by all runs.
    #[serde(rename = "expectedTraceInvariantKeys", default)]
    pub expected_trace_invariant_keys: Vec<String>,
    /// Per-host runs (web / template / mixed).
    #[serde(default)]
    pub runs: Vec<ConformanceHostRun>,
}

impl ConformanceScenario {
    fn run_for(
        host_kind: &str,
        surface_role: &str,
        surface_kinds: &[&str],
        surface_ids: &[&str],
        fixture: &ConformanceFixture,
        state: &ConformanceStateSnapshot,
        invariant_keys: &[String],
        events: Vec<ConformanceTraceEvent>,
    ) -> ConformanceHostRun {
        ConformanceHostRun {
            schema: CONFORMANCE_HOST_RUN_SCHEMA.into(),
            host_kind: host_kind.into(),
            surface_role: surface_role.into(),
            surface_kinds: surface_kinds.iter().map(|s| (*s).into()).collect(),
            surface_ids: surface_ids.iter().map(|s| (*s).into()).collect(),
            observed_stable_ids: fixture.all_stable_ids(),
            state: state.clone(),
            trace: ConformanceTrace {
                schema: CONFORMANCE_TRACE_SCHEMA.into(),
                events,
                invariant_keys: invariant_keys.to_vec(),
            },
            uses_private_runtime_objects: false,
        }
    }

    /// Counter fixture shared across Browser Web, Mini Template, Native mixed.
    pub fn counter_cross_host_example() -> Self {
        let fixture = ConformanceFixture {
            schema: CONFORMANCE_FIXTURE_SCHEMA.into(),
            fixture_id: "vmz.conformance.counter".into(),
            application_id: "app.counter".into(),
            plan_version: "plan.v0".into(),
            region_ids: vec!["region:pages/index:page".into()],
            binding_ids: vec!["binding:pages/index:n".into()],
            route_ids: vec!["pages/index".into()],
            slot_ids: vec!["slot:pages/index:n".into()],
        };
        let expected_state = ConformanceStateSnapshot {
            schema: CONFORMANCE_STATE_SNAPSHOT_SCHEMA.into(),
            slot_values: vec![ConformanceSlotValue {
                slot_id: "slot:pages/index:n".into(),
                value: "1".into(),
            }],
        };
        let invariant_keys = vec![
            "T1:lifecycle:activate:region:pages/index:page".into(),
            "T1:write:binding:pages/index:n".into(),
            "T1:patch:binding:pages/index:n".into(),
        ];
        let events = vec![
            ConformanceTraceEvent {
                event_id: "e.activate".into(),
                kind: "lifecycle".into(),
                stable_ids: vec!["region:pages/index:page".into()],
                transaction_id: "T1".into(),
                generation: 1,
            },
            ConformanceTraceEvent {
                event_id: "e.write".into(),
                kind: "write".into(),
                stable_ids: vec!["binding:pages/index:n".into(), "slot:pages/index:n".into()],
                transaction_id: "T1".into(),
                generation: 1,
            },
            ConformanceTraceEvent {
                event_id: "e.patch".into(),
                kind: "patch".into(),
                stable_ids: vec!["binding:pages/index:n".into()],
                transaction_id: "T1".into(),
                generation: 1,
            },
        ];
        let runs = vec![
            Self::run_for(
                "browser",
                "web",
                &["web"],
                &["vmz.surface.web.main"],
                &fixture,
                &expected_state,
                &invariant_keys,
                events.clone(),
            ),
            Self::run_for(
                "mini",
                "template",
                &["template"],
                &["vmz.surface.template.page"],
                &fixture,
                &expected_state,
                &invariant_keys,
                events.clone(),
            ),
            Self::run_for(
                "native",
                "mixed",
                &["web", "native"],
                &["vmz.surface.web.form", "vmz.surface.native.camera"],
                &fixture,
                &expected_state,
                &invariant_keys,
                events,
            ),
        ];
        Self {
            schema: CONFORMANCE_SCENARIO_SCHEMA.into(),
            fixture,
            expected_state,
            expected_trace_invariant_keys: invariant_keys,
            runs,
        }
    }
}

/// Cross-host conformance check result for one scenario.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConformanceCheckReport {
    /// Always [`CONFORMANCE_CHECK_SCHEMA`].
    pub schema: String,
    /// Frozen protocol catalog echoed for consumers.
    pub catalog: ProfileProtocolCatalog,
    /// Scenario under check.
    pub scenario: ConformanceScenario,
    /// Conformance findings (stable-id / state / trace divergence, ...).
    #[serde(default)]
    pub diagnostics: Vec<ProfileDiagnostic>,
    /// Aggregate status (`pass` / `fail`).
    pub status: String,
}

impl ConformanceCheckReport {
    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}
