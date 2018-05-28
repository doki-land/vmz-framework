//! HostProfile / DeliveryProfile protocol (doc 13 §4.5 / §4.14 P0).
//!
//! Algebraic first version: freeze HostProfile + DeliveryProfile + binding
//! schemas, namespaced contribution rules, and resolution digest.
//! P0: HostProfile / DeliveryProfile freeze.
//! P1: Surface/capability/route solver artifacts + diagnostics.
//! P2: Unified Executor envelopes / transaction / dispose (doc 13 §4.7).
//! P3: Lifecycle mapping + crash recovery (doc 13 §4.8) — Browser/Mini/Native.
//! P4: Delivery Proof — package/security/update constraints + proof manifest (§4.4/§4.12/§4.14).
//! P5: Cross-Host Conformance — shared stable IDs / state / trace across Web/Template/Mixed (§4.14).
//! Does not replace MP0/NW* vertical evidence — those remain migration inputs.

use serde::{Deserialize, Serialize};

/// Umbrella profile protocol (horizontal Host/Delivery — Browser/Mini/Native).
pub const PROFILE_PROTOCOL: &str = "vmz.profile.protocol.v0";

pub const HOST_PROFILE_SCHEMA: &str = "vmz.profile.host.v0";
pub const DELIVERY_PROFILE_SCHEMA: &str = "vmz.profile.delivery.v0";
pub const SURFACE_BINDING_SCHEMA: &str = "vmz.profile.surface_binding.v0";
pub const CAPABILITY_BINDING_SCHEMA: &str = "vmz.profile.capability_binding.v0";
pub const LIFECYCLE_BINDING_SCHEMA: &str = "vmz.profile.lifecycle_binding.v0";
pub const NAVIGATION_BINDING_SCHEMA: &str = "vmz.profile.navigation_binding.v0";
pub const TRANSPORT_BINDING_SCHEMA: &str = "vmz.profile.transport_binding.v0";
pub const HOST_CONSTRAINTS_SCHEMA: &str = "vmz.profile.host_constraints.v0";
pub const RESOLUTION_DIGEST_SCHEMA: &str = "vmz.profile.resolution_digest.v0";
pub const PROFILE_CONTRIBUTION_SCHEMA: &str = "vmz.profile.contribution.v0";
pub const PROFILE_CHECK_SCHEMA: &str = "vmz.profile.check.v0";

/// P1 solver artifact schemas (doc 13 §4.6 / §4.12).
pub const SURFACE_REQUIREMENTS_SCHEMA: &str = "vmz.profile.surface_requirements.v0";
pub const CAPABILITY_REQUIREMENT_SCHEMA: &str = "vmz.profile.capability_requirement.v0";
pub const SURFACE_ASSIGNMENT_TABLE_SCHEMA: &str = "vmz.profile.surface_assignment_table.v0";
pub const CAPABILITY_RESOLUTION_TABLE_SCHEMA: &str = "vmz.profile.capability_resolution_table.v0";
pub const ROUTE_REALIZATION_TABLE_SCHEMA: &str = "vmz.profile.route_realization_table.v0";
pub const HOST_RESOLUTION_MANIFEST_SCHEMA: &str = "vmz.profile.host_resolution_manifest.v0";
pub const SOLVER_INPUT_SCHEMA: &str = "vmz.profile.solver_input.v0";
pub const SOLVER_CHECK_SCHEMA: &str = "vmz.profile.solver_check.v0";

/// P2: Unified Executor envelopes / transaction / dispose (doc 13 §4.7 / §4.14).
pub const EXECUTOR_ENVELOPE_HEADER_SCHEMA: &str = "vmz.profile.executor_envelope_header.v0";
pub const EVENT_ENVELOPE_SCHEMA: &str = "vmz.profile.event_envelope.v0";
pub const EXECUTOR_TRANSACTION_SCHEMA: &str = "vmz.profile.executor_transaction.v0";
pub const PATCH_BATCH_SCHEMA: &str = "vmz.profile.patch_batch.v0";
pub const DISPOSE_REGION_SCHEMA: &str = "vmz.profile.dispose_region.v0";
pub const CANCEL_REQUEST_SCHEMA: &str = "vmz.profile.cancel_request.v0";
pub const EXECUTOR_SCENARIO_SCHEMA: &str = "vmz.profile.executor_scenario.v0";
pub const EXECUTOR_CHECK_SCHEMA: &str = "vmz.profile.executor_check.v0";

/// P3: Lifecycle mapping + crash recovery (doc 13 §4.8 / §4.14).
pub const LIFECYCLE_MAPPING_ENTRY_SCHEMA: &str = "vmz.profile.lifecycle_mapping_entry.v0";
pub const LIFECYCLE_MAPPING_TABLE_SCHEMA: &str = "vmz.profile.lifecycle_mapping_table.v0";
pub const RECOVERY_POLICY_SCHEMA: &str = "vmz.profile.recovery_policy.v0";
pub const LIFECYCLE_SCENARIO_SCHEMA: &str = "vmz.profile.lifecycle_scenario.v0";
pub const LIFECYCLE_RECOVERY_CHECK_SCHEMA: &str = "vmz.profile.lifecycle_recovery_check.v0";

/// P4: Delivery Proof — package/security/update + proof manifest (doc 13 §4.4 / §4.12 / §4.14).
pub const DELIVERY_PACKAGE_CONSTRAINTS_SCHEMA: &str = "vmz.profile.delivery_package_constraints.v0";
pub const DELIVERY_SECURITY_POLICY_SCHEMA: &str = "vmz.profile.delivery_security_policy.v0";
pub const DELIVERY_UPDATE_POLICY_SCHEMA: &str = "vmz.profile.delivery_update_policy.v0";
pub const DELIVERY_ARTIFACT_MANIFEST_SCHEMA: &str = "vmz.profile.delivery_artifact_manifest.v0";
pub const DELIVERY_PROOF_MANIFEST_SCHEMA: &str = "vmz.profile.delivery_proof_manifest.v0";
pub const DELIVERY_PROOF_SCENARIO_SCHEMA: &str = "vmz.profile.delivery_proof_scenario.v0";
pub const DELIVERY_PROOF_CHECK_SCHEMA: &str = "vmz.profile.delivery_proof_check.v0";

/// P5: Cross-Host Conformance (doc 13 §4.14).
pub const CONFORMANCE_FIXTURE_SCHEMA: &str = "vmz.profile.conformance_fixture.v0";
pub const CONFORMANCE_STATE_SNAPSHOT_SCHEMA: &str = "vmz.profile.conformance_state_snapshot.v0";
pub const CONFORMANCE_TRACE_SCHEMA: &str = "vmz.profile.conformance_trace.v0";
pub const CONFORMANCE_HOST_RUN_SCHEMA: &str = "vmz.profile.conformance_host_run.v0";
pub const CONFORMANCE_SCENARIO_SCHEMA: &str = "vmz.profile.conformance_scenario.v0";
pub const CONFORMANCE_CHECK_SCHEMA: &str = "vmz.profile.conformance_check.v0";

/// Required surface roles for P5: WebSurface, TemplateSurface, Web+Native mixed.
pub const CONFORMANCE_SURFACE_ROLES: &[&str] = &["web", "template", "mixed"];

/// Allowed DeliveryUpdatePolicy.channel values.
pub const DELIVERY_UPDATE_CHANNELS: &[&str] = &["rebuild", "store", "hot", "hybrid"];

/// Allowed DeliveryProfile.assetStrategy values for P4 proof.
pub const DELIVERY_ASSET_STRATEGIES: &[&str] = &["bundled", "remote", "hybrid"];

/// Host kinds covered by P3 cross-host lifecycle proof.
pub const LIFECYCLE_HOST_KINDS: &[&str] = &["browser", "mini", "native"];

/// Allowed persistence windows on LifecycleBinding (doc 13 §4.8).
pub const PERSISTENCE_WINDOWS: &[&str] = &["none", "suspend", "crash", "owner"];

/// P0 diagnostic codes (doc 13 §4.13 — profile protocol subset).
pub const DIAG_HOST_PROFILE_INVALID: &str = "vmz::profile::host_profile_invalid";
pub const DIAG_DELIVERY_PROFILE_INVALID: &str = "vmz::profile::delivery_profile_invalid";
pub const DIAG_HOST_PROFILE_REF_UNRESOLVED: &str = "vmz::profile::host_profile_ref_unresolved";
pub const DIAG_RESOLUTION_DIGEST_MISSING: &str = "vmz::profile::resolution_digest_missing";
pub const DIAG_RESOLUTION_DIGEST_MISMATCH: &str = "vmz::profile::resolution_digest_mismatch";
pub const DIAG_CORE_ID_OVERRIDE: &str = "vmz::profile::core_id_override";
pub const DIAG_CONTRIBUTION_NOT_NAMESPACED: &str = "vmz::profile::contribution_not_namespaced";
pub const DIAG_PROFILE_VERSION_INVALID: &str = "vmz::profile::profile_version_invalid";

/// P1 solver diagnostics (doc 13 §4.13).
pub const DIAG_SURFACE_NO_MATCH: &str = "vmz::profile::surface_no_match";
pub const DIAG_SURFACE_AMBIGUOUS: &str = "vmz::profile::surface_ambiguous";
pub const DIAG_CAPABILITY_UNRESOLVED: &str = "vmz::profile::capability_unresolved";
pub const DIAG_CAPABILITY_PERMISSION_UNDECLARED: &str =
    "vmz::profile::capability_permission_undeclared";
pub const DIAG_ROUTE_UNREALIZABLE: &str = "vmz::profile::route_unrealizable";

/// P2 executor diagnostics (doc 13 §4.7).
pub const DIAG_STALE_GENERATION: &str = "vmz::profile::stale_generation";
pub const DIAG_MISSING_ENVELOPE_IDS: &str = "vmz::profile::missing_envelope_ids";
pub const DIAG_SURFACE_OWNS_STATE: &str = "vmz::profile::surface_owns_state";
pub const DIAG_PRIVATE_OBJECT_CROSSING: &str = "vmz::profile::private_object_crossing";
pub const DIAG_SPLIT_TRANSACTION: &str = "vmz::profile::split_transaction";
pub const DIAG_DISPOSE_NOT_AUTHORITATIVE: &str = "vmz::profile::dispose_not_authoritative";
pub const DIAG_CANCEL_NOT_PROPAGATED: &str = "vmz::profile::cancel_not_propagated";

/// P3 lifecycle / recovery diagnostics (doc 13 §4.8 / §4.13).
pub const DIAG_LIFECYCLE_UNPROVEN: &str = "vmz::profile::lifecycle_unproven";
pub const DIAG_LIFECYCLE_MAPPING_INCOMPLETE: &str = "vmz::profile::lifecycle_mapping_incomplete";
pub const DIAG_RECOVERY_DUPLICATES_OWNER: &str = "vmz::profile::recovery_duplicates_owner";
pub const DIAG_RECOVERY_ASSUMES_HEAP: &str = "vmz::profile::recovery_assumes_heap";
pub const DIAG_PERSISTENCE_WINDOW_INVALID: &str = "vmz::profile::persistence_window_invalid";

/// P4 delivery proof diagnostics (doc 13 §4.13).
pub const DIAG_DELIVERY_CONSTRAINT_EXCEEDED: &str = "vmz::profile::delivery_constraint_exceeded";
pub const DIAG_HOST_PLAN_VERSION_MISMATCH: &str = "vmz::profile::host_plan_version_mismatch";
pub const DIAG_PROOF_MANIFEST_INCOMPLETE: &str = "vmz::profile::proof_manifest_incomplete";
pub const DIAG_PROOF_COPIES_SEMANTIC_IR: &str = "vmz::profile::proof_copies_semantic_ir";
pub const DIAG_UPDATE_WITHOUT_REPROOF: &str = "vmz::profile::update_without_reproof";
pub const DIAG_SECURITY_POLICY_INSECURE: &str = "vmz::profile::security_policy_insecure";

/// P5 cross-host conformance diagnostics (doc 13 §4.14).
pub const DIAG_STABLE_ID_DIVERGENCE: &str = "vmz::profile::stable_id_divergence";
pub const DIAG_STATE_RESULT_DIVERGENCE: &str = "vmz::profile::state_result_divergence";
pub const DIAG_TRACE_INVARIANT_BROKEN: &str = "vmz::profile::trace_invariant_broken";
pub const DIAG_CONFORMANCE_HOST_INCOMPLETE: &str = "vmz::profile::conformance_host_incomplete";
pub const DIAG_CONFORMANCE_SURFACE_ROLE_MISMATCH: &str =
    "vmz::profile::conformance_surface_role_mismatch";

/// Reserved core ID prefix — contributions must not override these.
pub const CORE_ID_PREFIX: &str = "vmz.";

/// Surface kinds (doc 13 §4.5).
pub const SURFACE_KINDS: &[&str] = &["web", "template", "native", "headless"];

/// Unified lifecycle events Host must map (doc 13 §4.8).
pub const UNIFIED_LIFECYCLE_EVENTS: &[&str] =
    &["activate", "visible", "hidden", "suspend", "resume", "recover", "dispose"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProfileDocumentKind {
    pub kind: String,
    pub schema: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProfileProtocolCatalog {
    pub schema: String,
    pub protocol: String,
    pub documents: Vec<ProfileDocumentKind>,
    pub diagnostics: Vec<String>,
    #[serde(rename = "surfaceKinds")]
    pub surface_kinds: Vec<String>,
    #[serde(rename = "unifiedLifecycleEvents")]
    pub unified_lifecycle_events: Vec<String>,
    #[serde(rename = "coreIdPrefix")]
    pub core_id_prefix: String,
}

impl ProfileProtocolCatalog {
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

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProfileDiagnostic {
    pub path: String,
    pub severity: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SurfaceBinding {
    pub schema: String,
    #[serde(rename = "surfaceId")]
    pub surface_id: String,
    /// `web` | `template` | `native` | `headless`
    pub kind: String,
    #[serde(rename = "driverId")]
    pub driver_id: String,
    #[serde(rename = "supportedOperations", default)]
    pub supported_operations: Vec<String>,
    #[serde(rename = "supportedElementKinds", default)]
    pub supported_element_kinds: Vec<String>,
    #[serde(rename = "supportedEventKinds", default)]
    pub supported_event_kinds: Vec<String>,
    #[serde(rename = "supportedStyleFeatures", default)]
    pub supported_style_features: Vec<String>,
    #[serde(rename = "supportedAccessibility", default)]
    pub supported_accessibility: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CapabilityBinding {
    pub schema: String,
    #[serde(rename = "capabilityId")]
    pub capability_id: String,
    #[serde(rename = "versionRange")]
    pub version_range: String,
    #[serde(rename = "executionDomain")]
    pub execution_domain: String,
    #[serde(rename = "providerId")]
    pub provider_id: String,
    #[serde(rename = "transportId", default, skip_serializing_if = "Option::is_none")]
    pub transport_id: Option<String>,
    #[serde(default)]
    pub permissions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LifecycleBinding {
    pub schema: String,
    #[serde(rename = "hostEvent")]
    pub host_event: String,
    #[serde(rename = "vmzLifecycle")]
    pub vmz_lifecycle: String,
    #[serde(rename = "mayRepeat", default)]
    pub may_repeat: bool,
    #[serde(rename = "guaranteed", default)]
    pub guaranteed: bool,
    #[serde(rename = "mayBeMissingAfterCrash", default)]
    pub may_be_missing_after_crash: bool,
    /// `none` | `suspend` | `crash` | `owner` — persistence window for resources (doc 13 §4.8).
    #[serde(rename = "persistenceWindow", default)]
    pub persistence_window: String,
    /// Whether this lifecycle event cancels in-flight capabilities.
    #[serde(rename = "cancelsCapabilities", default)]
    pub cancels_capabilities: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NavigationBinding {
    pub schema: String,
    #[serde(rename = "routeRealizerId")]
    pub route_realizer_id: String,
    /// `history` | `page-stack` | `native-stack` | `none`
    #[serde(rename = "stackModel")]
    pub stack_model: String,
    #[serde(rename = "deepLinkPolicy", default)]
    pub deep_link_policy: String,
    #[serde(rename = "backPolicy", default)]
    pub back_policy: String,
    #[serde(rename = "stateRestorationPolicy", default)]
    pub state_restoration_policy: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TransportBinding {
    pub schema: String,
    #[serde(rename = "transportId")]
    pub transport_id: String,
    pub kind: String,
    #[serde(rename = "endpointScheme", default)]
    pub endpoint_scheme: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HostConstraints {
    pub schema: String,
    #[serde(rename = "maxSurfaces", default, skip_serializing_if = "Option::is_none")]
    pub max_surfaces: Option<u32>,
    #[serde(rename = "allowsRuntimeDriverSelect", default)]
    pub allows_runtime_driver_select: bool,
    #[serde(rename = "requiresResolutionDigest", default)]
    pub requires_resolution_digest: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HostProfile {
    pub schema: String,
    #[serde(rename = "schemaVersion")]
    pub schema_version: String,
    #[serde(rename = "hostId")]
    pub host_id: String,
    #[serde(rename = "hostVersion")]
    pub host_version: String,
    #[serde(default)]
    pub surfaces: Vec<SurfaceBinding>,
    #[serde(default)]
    pub capabilities: Vec<CapabilityBinding>,
    #[serde(default)]
    pub lifecycle: Vec<LifecycleBinding>,
    pub navigation: NavigationBinding,
    #[serde(default)]
    pub transports: Vec<TransportBinding>,
    pub constraints: HostConstraints,
}

impl HostProfile {
    /// Build LifecycleBinding rows from host-event → unified-lifecycle pairs (doc 13 §4.8).
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

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ResolutionDigest {
    pub schema: String,
    pub algorithm: String,
    pub value: String,
    #[serde(rename = "hostProfileId")]
    pub host_profile_id: String,
    #[serde(rename = "hostVersion")]
    pub host_version: String,
    #[serde(rename = "deliveryId")]
    pub delivery_id: String,
}

impl ResolutionDigest {
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeliveryProfile {
    pub schema: String,
    #[serde(rename = "schemaVersion")]
    pub schema_version: String,
    #[serde(rename = "deliveryId")]
    pub delivery_id: String,
    #[serde(rename = "hostProfileRef")]
    pub host_profile_ref: String,
    #[serde(rename = "entryRoutes", default)]
    pub entry_routes: Vec<String>,
    #[serde(rename = "defaultSurface")]
    pub default_surface: String,
    #[serde(rename = "surfacePolicies", default)]
    pub surface_policies: Vec<String>,
    #[serde(rename = "capabilityOverrides", default)]
    pub capability_overrides: Vec<String>,
    #[serde(rename = "assetStrategy", default)]
    pub asset_strategy: String,
    #[serde(rename = "updatePolicy", default)]
    pub update_policy: String,
    #[serde(rename = "securityPolicy", default)]
    pub security_policy: String,
    #[serde(rename = "packageConstraints", default)]
    pub package_constraints: Vec<String>,
    #[serde(rename = "resolutionDigest", default, skip_serializing_if = "Option::is_none")]
    pub resolution_digest: Option<ResolutionDigest>,
}

impl DeliveryProfile {
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

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Namespaced profile contribution (plugin may only add under its namespace).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProfileContribution {
    pub schema: String,
    #[serde(rename = "pluginNamespace")]
    pub plugin_namespace: String,
    #[serde(rename = "surfaceIds", default)]
    pub surface_ids: Vec<String>,
    #[serde(rename = "capabilityIds", default)]
    pub capability_ids: Vec<String>,
    #[serde(rename = "providerIds", default)]
    pub provider_ids: Vec<String>,
}

impl ProfileContribution {
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

/// Deterministic algebraic digest (not crypto-grade packaging — contract shape freeze).
pub fn canonical_digest_value(host: &HostProfile, delivery_id: &str) -> String {
    format!(
        "sha256:{}:{}:{}:surfaces={}",
        host.host_id,
        host.host_version,
        delivery_id,
        host.surfaces.len()
    )
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProfileCheckReport {
    pub schema: String,
    pub catalog: ProfileProtocolCatalog,
    #[serde(rename = "hostProfile")]
    pub host_profile: HostProfile,
    #[serde(rename = "deliveryProfile")]
    pub delivery_profile: DeliveryProfile,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contribution: Option<ProfileContribution>,
    #[serde(default)]
    pub diagnostics: Vec<ProfileDiagnostic>,
    pub status: String,
}

impl ProfileCheckReport {
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Region surface requirements inferred from VPG (algebraic fixture for P1).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SurfaceRequirements {
    pub schema: String,
    #[serde(rename = "requiredOperations", default)]
    pub required_operations: Vec<String>,
    #[serde(rename = "requiredElementKinds", default)]
    pub required_element_kinds: Vec<String>,
    #[serde(rename = "requiredEvents", default)]
    pub required_events: Vec<String>,
    #[serde(rename = "requiredStyleFeatures", default)]
    pub required_style_features: Vec<String>,
    #[serde(rename = "requiredAccessibility", default)]
    pub required_accessibility: Vec<String>,
    #[serde(rename = "requiredCapabilities", default)]
    pub required_capabilities: Vec<String>,
    #[serde(rename = "coLocationConstraints", default)]
    pub co_location_constraints: Vec<String>,
}

impl SurfaceRequirements {
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CapabilityRequirement {
    pub schema: String,
    #[serde(rename = "capabilityId")]
    pub capability_id: String,
    #[serde(rename = "versionRange", default)]
    pub version_range: String,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(rename = "regionId", default, skip_serializing_if = "Option::is_none")]
    pub region_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RegionSolveRequest {
    #[serde(rename = "regionId")]
    pub region_id: String,
    #[serde(rename = "routeId", default, skip_serializing_if = "Option::is_none")]
    pub route_id: Option<String>,
    pub requirements: SurfaceRequirements,
    /// Graph edge `requiresSurface` — hard constraint.
    #[serde(rename = "requiresSurface", default, skip_serializing_if = "Option::is_none")]
    pub requires_surface: Option<String>,
    /// Graph edge `prefersSurface` — soft ranking.
    #[serde(rename = "prefersSurface", default, skip_serializing_if = "Option::is_none")]
    pub prefers_surface: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RouteSolveRequest {
    #[serde(rename = "routeId")]
    pub route_id: String,
    #[serde(rename = "isEntry", default)]
    pub is_entry: bool,
}

/// Algebraic solver input — stable IDs only (no expressions / component trees).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProfileSolverInput {
    pub schema: String,
    pub regions: Vec<RegionSolveRequest>,
    #[serde(default)]
    pub capabilities: Vec<CapabilityRequirement>,
    pub routes: Vec<RouteSolveRequest>,
}

impl ProfileSolverInput {
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SurfaceReject {
    #[serde(rename = "surfaceId")]
    pub surface_id: String,
    pub reason: String,
    #[serde(rename = "unsatisfied", default)]
    pub unsatisfied: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SurfaceAssignment {
    #[serde(rename = "regionId")]
    pub region_id: String,
    #[serde(rename = "surfaceId")]
    pub surface_id: String,
    #[serde(rename = "driverId")]
    pub driver_id: String,
    /// `unique` | `deterministic_tiebreak` | `requires_surface` | `prefers_surface` | `default_surface`
    pub reason: String,
    #[serde(default)]
    pub rejected: Vec<SurfaceReject>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SurfaceAssignmentTable {
    pub schema: String,
    pub assignments: Vec<SurfaceAssignment>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CapabilityResolution {
    #[serde(rename = "capabilityId")]
    pub capability_id: String,
    #[serde(rename = "providerId")]
    pub provider_id: String,
    #[serde(rename = "executionDomain")]
    pub execution_domain: String,
    #[serde(rename = "transportId", default, skip_serializing_if = "Option::is_none")]
    pub transport_id: Option<String>,
    #[serde(rename = "regionId", default, skip_serializing_if = "Option::is_none")]
    pub region_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CapabilityResolutionTable {
    pub schema: String,
    pub resolutions: Vec<CapabilityResolution>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RouteRealization {
    #[serde(rename = "routeId")]
    pub route_id: String,
    #[serde(rename = "routeRealizerId")]
    pub route_realizer_id: String,
    #[serde(rename = "stackModel")]
    pub stack_model: String,
    #[serde(rename = "owningLifetimeRegion", default, skip_serializing_if = "Option::is_none")]
    pub owning_lifetime_region: Option<String>,
    #[serde(rename = "surfaceIds", default)]
    pub surface_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RouteRealizationTable {
    pub schema: String,
    pub realizations: Vec<RouteRealization>,
}

/// Resolution / assembly result — refs stable IDs only (not a second IR).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HostResolutionManifest {
    pub schema: String,
    #[serde(rename = "hostProfileId")]
    pub host_profile_id: String,
    #[serde(rename = "deliveryId")]
    pub delivery_id: String,
    #[serde(rename = "surfaceAssignments")]
    pub surface_assignments: SurfaceAssignmentTable,
    #[serde(rename = "capabilityResolutions")]
    pub capability_resolutions: CapabilityResolutionTable,
    #[serde(rename = "routeRealizations")]
    pub route_realizations: RouteRealizationTable,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProfileSolverCheckReport {
    pub schema: String,
    pub catalog: ProfileProtocolCatalog,
    #[serde(rename = "hostProfile")]
    pub host_profile: HostProfile,
    #[serde(rename = "deliveryProfile")]
    pub delivery_profile: DeliveryProfile,
    #[serde(rename = "solverInput")]
    pub solver_input: ProfileSolverInput,
    pub manifest: HostResolutionManifest,
    #[serde(default)]
    pub diagnostics: Vec<ProfileDiagnostic>,
    pub status: String,
}

impl ProfileSolverCheckReport {
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Envelope header shared by Event / Patch / Capability / lifecycle envelopes (doc 13 §4.7).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExecutorEnvelopeHeader {
    pub schema: String,
    #[serde(rename = "applicationId")]
    pub application_id: String,
    #[serde(rename = "planVersion")]
    pub plan_version: String,
    pub generation: u64,
    #[serde(rename = "transactionId")]
    pub transaction_id: String,
    #[serde(rename = "regionId")]
    pub region_id: String,
}

impl ExecutorEnvelopeHeader {
    pub fn is_complete(&self) -> bool {
        !self.application_id.trim().is_empty()
            && !self.plan_version.trim().is_empty()
            && !self.transaction_id.trim().is_empty()
            && !self.region_id.trim().is_empty()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EventEnvelope {
    pub schema: String,
    pub header: ExecutorEnvelopeHeader,
    #[serde(rename = "eventId")]
    pub event_id: String,
    #[serde(rename = "eventKind", default)]
    pub event_kind: String,
    #[serde(rename = "sourceSurfaceId", default)]
    pub source_surface_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExecutorTransaction {
    pub schema: String,
    #[serde(rename = "transactionId")]
    pub transaction_id: String,
    pub generation: u64,
    #[serde(rename = "affectedBindings", default)]
    pub affected_bindings: Vec<String>,
    /// Forbidden: one logical write split into per-surface transactions.
    #[serde(rename = "splitPerSurface", default)]
    pub split_per_surface: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PatchBatch {
    pub schema: String,
    pub header: ExecutorEnvelopeHeader,
    #[serde(rename = "surfaceId")]
    pub surface_id: String,
    #[serde(rename = "bindingIds", default)]
    pub binding_ids: Vec<String>,
    #[serde(rename = "carriesPrivateRuntimeObject", default)]
    pub carries_private_runtime_object: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StateSlotFact {
    #[serde(rename = "slotId")]
    pub slot_id: String,
    #[serde(rename = "ownerRegionId")]
    pub owner_region_id: String,
    /// Surface driver must not own business state (projection cache only).
    #[serde(rename = "surfaceDriverOwnsBusinessState", default)]
    pub surface_driver_owns_business_state: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DisposeRegion {
    pub schema: String,
    pub header: ExecutorEnvelopeHeader,
    #[serde(rename = "cancelsCapabilities", default)]
    pub cancels_capabilities: bool,
    /// Authoritative terminate — only DisposeRegion may cancel foreign-surface tasks.
    #[serde(rename = "isAuthoritativeTerminate", default)]
    pub is_authoritative_terminate: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CancelRequest {
    pub schema: String,
    pub header: ExecutorEnvelopeHeader,
    #[serde(rename = "capabilityIds", default)]
    pub capability_ids: Vec<String>,
    #[serde(rename = "propagated", default)]
    pub propagated: bool,
}

/// Algebraic Unified Executor scenario fixture (no real Surface adapters).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExecutorScenario {
    pub schema: String,
    #[serde(rename = "currentGeneration")]
    pub current_generation: u64,
    #[serde(rename = "stateSlots", default)]
    pub state_slots: Vec<StateSlotFact>,
    #[serde(rename = "incomingEvent", default, skip_serializing_if = "Option::is_none")]
    pub incoming_event: Option<EventEnvelope>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transaction: Option<ExecutorTransaction>,
    #[serde(rename = "patchBatches", default)]
    pub patch_batches: Vec<PatchBatch>,
    #[serde(rename = "disposeRegion", default, skip_serializing_if = "Option::is_none")]
    pub dispose_region: Option<DisposeRegion>,
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
    /// Mixed page: camera event → T42 → web + native + headless patch batches.
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExecutorCheckReport {
    pub schema: String,
    pub catalog: ProfileProtocolCatalog,
    pub scenario: ExecutorScenario,
    #[serde(default)]
    pub diagnostics: Vec<ProfileDiagnostic>,
    pub status: String,
}

impl ExecutorCheckReport {
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// One host's lifecycle slice in a P3 cross-host scenario.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HostLifecycleSlice {
    #[serde(rename = "hostId")]
    pub host_id: String,
    /// `browser` | `mini` | `native`
    #[serde(rename = "hostKind")]
    pub host_kind: String,
    #[serde(default)]
    pub lifecycle: Vec<LifecycleBinding>,
}

/// LifecycleMappingTable entry — refs host + unified event only (doc 13 §4.12).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LifecycleMappingEntry {
    pub schema: String,
    #[serde(rename = "hostId")]
    pub host_id: String,
    #[serde(rename = "hostEvent")]
    pub host_event: String,
    #[serde(rename = "vmzLifecycle")]
    pub vmz_lifecycle: String,
    #[serde(rename = "mayRepeat", default)]
    pub may_repeat: bool,
    #[serde(rename = "guaranteed", default)]
    pub guaranteed: bool,
    #[serde(rename = "mayBeMissingAfterCrash", default)]
    pub may_be_missing_after_crash: bool,
    #[serde(rename = "persistenceWindow", default)]
    pub persistence_window: String,
    #[serde(rename = "cancelsCapabilities", default)]
    pub cancels_capabilities: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LifecycleMappingTable {
    pub schema: String,
    pub entries: Vec<LifecycleMappingEntry>,
}

impl LifecycleMappingTable {
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

/// Crash recovery must reattach surfaces to the same owner — never duplicate (doc 13 §4.7/§4.8).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RecoveryPolicy {
    pub schema: String,
    #[serde(rename = "policyId")]
    pub policy_id: String,
    #[serde(rename = "ownerRegionId")]
    pub owner_region_id: String,
    #[serde(rename = "rematerializeFromSnapshot", default)]
    pub rematerialize_from_snapshot: bool,
    #[serde(rename = "rematerializePlanGeneration", default)]
    pub rematerialize_plan_generation: bool,
    /// Foul: crash restore must not assume JS heap survived.
    #[serde(rename = "assumesJsHeapSurvived", default)]
    pub assumes_js_heap_survived: bool,
    /// Foul: recover must not create a second owner for the same region.
    #[serde(rename = "createsNewOwnerOnRecover", default)]
    pub creates_new_owner_on_recover: bool,
    #[serde(rename = "surfaceIdsToReattach", default)]
    pub surface_ids_to_reattach: Vec<String>,
    #[serde(rename = "cancelsCapabilitiesOnlyOnOwnerDispose", default)]
    pub cancels_capabilities_only_on_owner_dispose: bool,
}

/// Algebraic P3 fixture: Browser + Mini + Native map to unified lifecycle + recovery.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LifecycleScenario {
    pub schema: String,
    #[serde(default)]
    pub hosts: Vec<HostLifecycleSlice>,
    #[serde(rename = "mappingTable")]
    pub mapping_table: LifecycleMappingTable,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LifecycleRecoveryCheckReport {
    pub schema: String,
    pub catalog: ProfileProtocolCatalog,
    pub scenario: LifecycleScenario,
    #[serde(default)]
    pub diagnostics: Vec<ProfileDiagnostic>,
    pub status: String,
}

impl LifecycleRecoveryCheckReport {
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Structured package constraints proved at Delivery assembly time (doc 13 §4.4).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeliveryPackageConstraints {
    pub schema: String,
    #[serde(rename = "maxSurfaces", default, skip_serializing_if = "Option::is_none")]
    pub max_surfaces: Option<u32>,
    #[serde(rename = "maxPackageBytes", default, skip_serializing_if = "Option::is_none")]
    pub max_package_bytes: Option<u64>,
    #[serde(rename = "allowedSurfaceIds", default)]
    pub allowed_surface_ids: Vec<String>,
    #[serde(rename = "requiresResolutionDigest", default)]
    pub requires_resolution_digest: bool,
}

/// Security policy for a Delivery (not a free-form string).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeliverySecurityPolicy {
    pub schema: String,
    #[serde(rename = "policyId")]
    pub policy_id: String,
    #[serde(rename = "requiresOriginIsolation", default)]
    pub requires_origin_isolation: bool,
    #[serde(rename = "requiresIntegrityForRemote", default)]
    pub requires_integrity_for_remote: bool,
    /// Foul when true without requiresIntegrityForRemote.
    #[serde(rename = "allowsArbitraryRemote", default)]
    pub allows_arbitrary_remote: bool,
    #[serde(rename = "cspProfile", default)]
    pub csp_profile: String,
}

/// Update / rollback policy — semantic changes must invalidate and re-prove.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeliveryUpdatePolicy {
    pub schema: String,
    #[serde(rename = "policyId")]
    pub policy_id: String,
    /// `rebuild` | `store` | `hot` | `hybrid`
    pub channel: String,
    #[serde(rename = "requiresReproofOnSemanticChange", default)]
    pub requires_reproof_on_semantic_change: bool,
    #[serde(default)]
    pub rollback: String,
}

/// DeliveryArtifactManifest — refs stable IDs only (doc 13 §4.12).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeliveryArtifactManifest {
    pub schema: String,
    #[serde(rename = "deliveryId")]
    pub delivery_id: String,
    #[serde(rename = "hostProfileId")]
    pub host_profile_id: String,
    #[serde(rename = "planVersion")]
    pub plan_version: String,
    #[serde(rename = "includedSurfaceIds", default)]
    pub included_surface_ids: Vec<String>,
    #[serde(rename = "includedCapabilityIds", default)]
    pub included_capability_ids: Vec<String>,
    #[serde(rename = "entryRouteIds", default)]
    pub entry_route_ids: Vec<String>,
    #[serde(rename = "resolutionDigest")]
    pub resolution_digest: ResolutionDigest,
    #[serde(rename = "estimatedPackageBytes", default)]
    pub estimated_package_bytes: u64,
    /// Foul: proof/artifact must not copy VPG/Plan semantic IR.
    #[serde(rename = "copiesSemanticIr", default)]
    pub copies_semantic_ir: bool,
}

/// Proof that package/security/update constraints hold for a Delivery.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeliveryProofManifest {
    pub schema: String,
    #[serde(rename = "deliveryId")]
    pub delivery_id: String,
    #[serde(rename = "hostProfileId")]
    pub host_profile_id: String,
    #[serde(rename = "planVersion")]
    pub plan_version: String,
    #[serde(rename = "packageConstraints")]
    pub package_constraints: DeliveryPackageConstraints,
    #[serde(rename = "securityPolicy")]
    pub security_policy: DeliverySecurityPolicy,
    #[serde(rename = "updatePolicy")]
    pub update_policy: DeliveryUpdatePolicy,
    pub artifact: DeliveryArtifactManifest,
    #[serde(rename = "constraintProofs", default)]
    pub constraint_proofs: Vec<String>,
    #[serde(rename = "explainIndexRefs", default)]
    pub explain_index_refs: Vec<String>,
}

/// One host+delivery+proof unit inside a P4 scenario.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeliveryProofUnit {
    #[serde(rename = "hostKind")]
    pub host_kind: String,
    pub host: HostProfile,
    pub delivery: DeliveryProfile,
    pub proof: DeliveryProofManifest,
}

/// Algebraic P4 fixture: Browser / Mini / Native delivery proofs.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeliveryProofScenario {
    pub schema: String,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeliveryProofCheckReport {
    pub schema: String,
    pub catalog: ProfileProtocolCatalog,
    pub scenario: DeliveryProofScenario,
    #[serde(default)]
    pub diagnostics: Vec<ProfileDiagnostic>,
    pub status: String,
}

impl DeliveryProofCheckReport {
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Shared conformance fixture — stable IDs only (doc 13 §4.14 P5).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConformanceFixture {
    pub schema: String,
    #[serde(rename = "fixtureId")]
    pub fixture_id: String,
    #[serde(rename = "applicationId")]
    pub application_id: String,
    #[serde(rename = "planVersion")]
    pub plan_version: String,
    #[serde(rename = "regionIds", default)]
    pub region_ids: Vec<String>,
    #[serde(rename = "bindingIds", default)]
    pub binding_ids: Vec<String>,
    #[serde(rename = "routeIds", default)]
    pub route_ids: Vec<String>,
    #[serde(rename = "slotIds", default)]
    pub slot_ids: Vec<String>,
}

impl ConformanceFixture {
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConformanceSlotValue {
    #[serde(rename = "slotId")]
    pub slot_id: String,
    pub value: String,
}

/// Algebraic state result after the shared fixture script.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConformanceStateSnapshot {
    pub schema: String,
    #[serde(rename = "slotValues", default)]
    pub slot_values: Vec<ConformanceSlotValue>,
}

impl ConformanceStateSnapshot {
    pub fn normalized_pairs(&self) -> Vec<(String, String)> {
        let mut pairs: Vec<(String, String)> =
            self.slot_values.iter().map(|s| (s.slot_id.clone(), s.value.clone())).collect();
        pairs.sort();
        pairs
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConformanceTraceEvent {
    #[serde(rename = "eventId")]
    pub event_id: String,
    pub kind: String,
    #[serde(rename = "stableIds", default)]
    pub stable_ids: Vec<String>,
    #[serde(rename = "transactionId", default)]
    pub transaction_id: String,
    pub generation: u64,
}

/// Trace with sorted invariant keys shared across hosts.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConformanceTrace {
    pub schema: String,
    #[serde(default)]
    pub events: Vec<ConformanceTraceEvent>,
    #[serde(rename = "invariantKeys", default)]
    pub invariant_keys: Vec<String>,
}

/// One host's algebraic run of the shared fixture.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConformanceHostRun {
    pub schema: String,
    #[serde(rename = "hostKind")]
    pub host_kind: String,
    /// `web` | `template` | `mixed`
    #[serde(rename = "surfaceRole")]
    pub surface_role: String,
    #[serde(rename = "surfaceKinds", default)]
    pub surface_kinds: Vec<String>,
    #[serde(rename = "surfaceIds", default)]
    pub surface_ids: Vec<String>,
    #[serde(rename = "observedStableIds", default)]
    pub observed_stable_ids: Vec<String>,
    pub state: ConformanceStateSnapshot,
    pub trace: ConformanceTrace,
    /// Foul: host-private objects must not enter cross-host evidence.
    #[serde(rename = "usesPrivateRuntimeObjects", default)]
    pub uses_private_runtime_objects: bool,
}

/// P5 scenario: same fixture on WebSurface, TemplateSurface, Web+Native mixed.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConformanceScenario {
    pub schema: String,
    pub fixture: ConformanceFixture,
    #[serde(rename = "expectedState")]
    pub expected_state: ConformanceStateSnapshot,
    #[serde(rename = "expectedTraceInvariantKeys", default)]
    pub expected_trace_invariant_keys: Vec<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConformanceCheckReport {
    pub schema: String,
    pub catalog: ProfileProtocolCatalog,
    pub scenario: ConformanceScenario,
    #[serde(default)]
    pub diagnostics: Vec<ProfileDiagnostic>,
    pub status: String,
}

impl ConformanceCheckReport {
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}
