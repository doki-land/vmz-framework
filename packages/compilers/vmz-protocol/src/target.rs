//! Target / multi-platform backend contracts.
//!
//! Freezes target-neutral View Operations, PlatformCapabilityProfile,
//! MiniProgramArtifact schema ids, and DOM-leak diagnostic codes.
//! No Mini Program semantic IR; no WeChat API in core schemas.

use serde::{Deserialize, Serialize};

/// Umbrella target protocol (catalog / handshake).
pub const TARGET_PROTOCOL: &str = "vmz.target.protocol.v0";

/// Catalog of target-neutral View Operations.
pub const VIEW_OPS_SCHEMA: &str = "vmz.target.view_ops.v0";

/// Platform capability profile document.
pub const PLATFORM_PROFILE_SCHEMA: &str = "vmz.target.platform_profile.v0";

/// Mini Program artifact envelope (lowering product, not IR).
pub const MINI_PROGRAM_ARTIFACT_SCHEMA: &str = "vmz.target.mini_program_artifact.v0";

/// Target-contract check report schema.
pub const TARGET_CHECK_SCHEMA: &str = "vmz.target.check.v0";

/// Hard: Execution Plan still names DOM / browser-only nodes after target lowering.
pub const DIAG_DOM_LEAK_IN_PLAN: &str = "vmz::target::dom_leak_in_plan";

/// Hard: Plan or emit referenced a View Operation kind outside the frozen catalog.
pub const DIAG_UNKNOWN_VIEW_OP: &str = "vmz::target::unknown_view_op";

/// Hard: requested platform cannot express a required capability (Unsupported verdict).
pub const DIAG_PLATFORM_UNSUPPORTED: &str = "vmz::target::platform_unsupported";

/// Hard: PlatformCapabilityProfile failed structural / schema validation.
pub const DIAG_PROFILE_INVALID: &str = "vmz::target::profile_invalid";

/// Hard: MiniProgramArtifact envelope is incomplete or schema-invalid.
pub const DIAG_ARTIFACT_INVALID: &str = "vmz::target::artifact_invalid";

/// One document kind entry inside [`TargetProtocolCatalog`].
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TargetDocumentKind {
    /// Kind id (`view_ops`, `platform_profile`, `mini_program_artifact`, `check`).
    pub kind: String,
    /// Schema id for that kind.
    pub schema: String,
}

/// Handshake catalog for the target protocol domain.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TargetProtocolCatalog {
    /// Always [`TARGET_PROTOCOL`].
    pub schema: String,
    /// Same as `schema` (parity with other domain catalogs).
    pub protocol: String,
    /// Document kinds this generation publishes.
    pub documents: Vec<TargetDocumentKind>,
    /// Stable diagnostic codes callers may see.
    pub diagnostics: Vec<String>,
    /// Frozen View Operation kind names advertised to hosts.
    #[serde(rename = "viewOperations")]
    pub view_operations: Vec<String>,
}

impl TargetProtocolCatalog {
    /// Frozen catalog for the current target protocol generation.
    pub fn v0() -> Self {
        Self {
            schema: TARGET_PROTOCOL.into(),
            protocol: TARGET_PROTOCOL.into(),
            documents: vec![
                TargetDocumentKind { kind: "view_ops".into(), schema: VIEW_OPS_SCHEMA.into() },
                TargetDocumentKind {
                    kind: "platform_profile".into(),
                    schema: PLATFORM_PROFILE_SCHEMA.into(),
                },
                TargetDocumentKind {
                    kind: "mini_program_artifact".into(),
                    schema: MINI_PROGRAM_ARTIFACT_SCHEMA.into(),
                },
                TargetDocumentKind { kind: "check".into(), schema: TARGET_CHECK_SCHEMA.into() },
            ],
            diagnostics: vec![
                DIAG_DOM_LEAK_IN_PLAN.into(),
                DIAG_UNKNOWN_VIEW_OP.into(),
                DIAG_PLATFORM_UNSUPPORTED.into(),
                DIAG_PROFILE_INVALID.into(),
                DIAG_ARTIFACT_INVALID.into(),
            ],
            view_operations: VIEW_OPERATION_KINDS.iter().map(|s| (*s).into()).collect(),
        }
    }

    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Canonical target-neutral View Operation kinds shared by Browser and Mini.
pub const VIEW_OPERATION_KINDS: &[&str] = &[
    "CreateNode",
    "SetStaticProperty",
    "PatchProperty",
    "PatchText",
    "SelectBranch",
    "ReconcileKeyed",
    "AttachEvent",
    "MountComponent",
    "ProjectSlot",
    "DisposeRegion",
];

/// One View Operation entry in the frozen catalog.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ViewOpEntry {
    /// Operation kind name (must appear in [`VIEW_OPERATION_KINDS`]).
    pub kind: String,
    /// Structural PlanNode kind(s) this op covers in the thin plan.
    #[serde(rename = "planKinds", default)]
    pub plan_kinds: Vec<String>,
    /// Human note for hosts / adapters (not a second IR).
    pub notes: String,
}

/// Document listing every frozen View Operation and its plan coverage.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ViewOpsDocument {
    /// Always [`VIEW_OPS_SCHEMA`].
    pub schema: String,
    /// Ordered operation table.
    pub operations: Vec<ViewOpEntry>,
}

impl ViewOpsDocument {
    /// Frozen View Operations table for the current generation.
    pub fn v0() -> Self {
        Self {
            schema: VIEW_OPS_SCHEMA.into(),
            operations: vec![
                ViewOpEntry {
                    kind: "CreateNode".into(),
                    plan_kinds: vec!["element".into(), "text".into()],
                    notes: "Logical view node; not DOM Node".into(),
                },
                ViewOpEntry {
                    kind: "SetStaticProperty".into(),
                    plan_kinds: vec!["element".into()],
                    notes: "Normalized view property; not HTML attribute".into(),
                },
                ViewOpEntry {
                    kind: "PatchProperty".into(),
                    plan_kinds: vec!["element".into()],
                    notes: "Binding-driven property patch".into(),
                },
                ViewOpEntry {
                    kind: "PatchText".into(),
                    plan_kinds: vec!["interp".into(), "text".into()],
                    notes: "Binding-driven text patch".into(),
                },
                ViewOpEntry {
                    kind: "SelectBranch".into(),
                    plan_kinds: vec!["if".into()],
                    notes: "Region branch selection".into(),
                },
                ViewOpEntry {
                    kind: "ReconcileKeyed".into(),
                    plan_kinds: vec!["each".into()],
                    notes: "Keyed list reconcile".into(),
                },
                ViewOpEntry {
                    kind: "AttachEvent".into(),
                    plan_kinds: vec![],
                    notes: "Normalized semantic event; Browser/Mini lowering diverge".into(),
                },
                ViewOpEntry {
                    kind: "MountComponent".into(),
                    plan_kinds: vec!["component".into()],
                    notes: "Component mount boundary".into(),
                },
                ViewOpEntry {
                    kind: "ProjectSlot".into(),
                    plan_kinds: vec!["slot".into()],
                    notes: "Slot projection".into(),
                },
                ViewOpEntry {
                    kind: "DisposeRegion".into(),
                    plan_kinds: vec!["dispose_region".into()],
                    notes: "LifetimeRegion dispose".into(),
                },
            ],
        }
    }

    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Capability verdict for one feature on a platform.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CapabilityVerdict {
    /// Feature id checked against the platform (`static_element`, `tap`, ...).
    pub feature: String,
    /// `Native` | `Adapted` | `Degraded` | `Unsupported`.
    pub verdict: String,
    /// Optional explanation when not `Native`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Versioned platform capability profile consumed by target check / adapters.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PlatformCapabilityProfile {
    /// Always [`PLATFORM_PROFILE_SCHEMA`].
    pub schema: String,
    /// Concrete platform id (`browser`, `mini-program`, adapter-specific ids).
    #[serde(rename = "platformId")]
    pub platform_id: String,
    /// Family bucket: `mini-program` | `browser` | ...
    #[serde(rename = "family")]
    pub family: String,
    /// Profile revision string for this platform id.
    pub version: String,
    /// Template / structure feature verdicts.
    #[serde(rename = "templateFeatures", default)]
    pub template_features: Vec<CapabilityVerdict>,
    /// Event feature verdicts.
    #[serde(rename = "eventFeatures", default)]
    pub event_features: Vec<CapabilityVerdict>,
    /// Style feature verdicts.
    #[serde(rename = "styleFeatures", default)]
    pub style_features: Vec<CapabilityVerdict>,
    /// Navigation / routing feature verdicts.
    #[serde(rename = "navigationFeatures", default)]
    pub navigation_features: Vec<CapabilityVerdict>,
    /// Network / RPC feature verdicts.
    #[serde(rename = "networkFeatures", default)]
    pub network_features: Vec<CapabilityVerdict>,
    /// Storage feature verdicts.
    #[serde(rename = "storageFeatures", default)]
    pub storage_features: Vec<CapabilityVerdict>,
    /// Lifecycle feature verdicts.
    #[serde(rename = "lifecycleFeatures", default)]
    pub lifecycle_features: Vec<CapabilityVerdict>,
    /// Named package size / count limits the adapter must respect.
    #[serde(rename = "packageLimits", default)]
    pub package_limits: Vec<String>,
    /// Named security constraints (`no_eval`, `domain_allowlist`, ...).
    #[serde(rename = "securityConstraints", default)]
    pub security_constraints: Vec<String>,
}

impl PlatformCapabilityProfile {
    /// Neutral mini-program family profile (not WeChat-specific).
    pub fn mini_program_neutral_v0() -> Self {
        Self {
            schema: PLATFORM_PROFILE_SCHEMA.into(),
            platform_id: "mini-program".into(),
            family: "mini-program".into(),
            version: "0".into(),
            template_features: vec![
                CapabilityVerdict {
                    feature: "static_element".into(),
                    verdict: "Native".into(),
                    reason: None,
                },
                CapabilityVerdict {
                    feature: "interpolation".into(),
                    verdict: "Native".into(),
                    reason: None,
                },
                CapabilityVerdict {
                    feature: "conditional".into(),
                    verdict: "Native".into(),
                    reason: None,
                },
                CapabilityVerdict {
                    feature: "keyed_list".into(),
                    verdict: "Native".into(),
                    reason: None,
                },
            ],
            event_features: vec![CapabilityVerdict {
                feature: "tap".into(),
                verdict: "Adapted".into(),
                reason: Some("normalized event -> platform event name via adapter".into()),
            }],
            style_features: vec![CapabilityVerdict {
                feature: "wxss_like".into(),
                verdict: "Adapted".into(),
                reason: Some("Canonical Style Module -> platform stylesheet".into()),
            }],
            navigation_features: vec![CapabilityVerdict {
                feature: "route_id".into(),
                verdict: "Adapted".into(),
                reason: Some("Route Graph -> pages/subpackages".into()),
            }],
            network_features: vec![CapabilityVerdict {
                feature: "server_capability".into(),
                verdict: "Adapted".into(),
                reason: Some("#server -> request transport; impl never in mini package".into()),
            }],
            storage_features: vec![],
            lifecycle_features: vec![CapabilityVerdict {
                feature: "page_show_hide".into(),
                verdict: "Adapted".into(),
                reason: Some("maps to LifetimeRegion activate/pause".into()),
            }],
            package_limits: vec!["main_package_size".into(), "subpackage_count".into()],
            security_constraints: vec!["no_eval".into(), "domain_allowlist".into()],
        }
    }

    /// Browser family profile (DOM / History / fetch as Native).
    pub fn browser_v0() -> Self {
        Self {
            schema: PLATFORM_PROFILE_SCHEMA.into(),
            platform_id: "browser".into(),
            family: "browser".into(),
            version: "0".into(),
            template_features: vec![CapabilityVerdict {
                feature: "dom_create_patch".into(),
                verdict: "Native".into(),
                reason: None,
            }],
            event_features: vec![CapabilityVerdict {
                feature: "dom_events".into(),
                verdict: "Native".into(),
                reason: None,
            }],
            style_features: vec![CapabilityVerdict {
                feature: "css".into(),
                verdict: "Native".into(),
                reason: None,
            }],
            navigation_features: vec![CapabilityVerdict {
                feature: "history_router".into(),
                verdict: "Native".into(),
                reason: None,
            }],
            network_features: vec![CapabilityVerdict {
                feature: "fetch_rpc".into(),
                verdict: "Native".into(),
                reason: None,
            }],
            storage_features: vec![],
            lifecycle_features: vec![CapabilityVerdict {
                feature: "ssr_resume".into(),
                verdict: "Native".into(),
                reason: None,
            }],
            package_limits: vec![],
            security_constraints: vec![],
        }
    }

    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Mini Program artifact envelope: lowering product only (not a semantic IR).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MiniProgramArtifact {
    /// Always [`MINI_PROGRAM_ARTIFACT_SCHEMA`].
    pub schema: String,
    /// Always `mini-program` family; concrete adapter id lives in `platform_id`.
    #[serde(rename = "platformId")]
    pub platform_id: String,
    /// Optional template fragment text for the adapter.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template: Option<String>,
    /// Optional style fragment text for the adapter.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<String>,
    /// Optional logic / script fragment text for the adapter.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub logic: Option<String>,
    /// Optional serialized event wiring table.
    #[serde(rename = "eventTable", default, skip_serializing_if = "Option::is_none")]
    pub event_table: Option<String>,
    /// Optional serialized data-patch table.
    #[serde(rename = "dataPatchTable", default, skip_serializing_if = "Option::is_none")]
    pub data_patch_table: Option<String>,
    /// Optional platform manifest fragment.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub manifest: Option<String>,
    /// Provenance: Execution Plan schema id this artifact was lowered from.
    #[serde(rename = "planSchema")]
    pub plan_schema: String,
}

impl MiniProgramArtifact {
    /// Empty envelope with schema + plan provenance filled; fragments left unset.
    pub fn empty_skeleton(platform_id: impl Into<String>) -> Self {
        Self {
            schema: MINI_PROGRAM_ARTIFACT_SCHEMA.into(),
            platform_id: platform_id.into(),
            template: None,
            style: None,
            logic: None,
            event_table: None,
            data_patch_table: None,
            manifest: None,
            plan_schema: crate::program::PLAN_SCHEMA.into(),
        }
    }

    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// One diagnostic row inside [`TargetCheckReport`].
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TargetDiagnostic {
    /// Source or artifact path the diagnostic attaches to.
    pub path: String,
    /// Severity label (`error`, `warning`, ...).
    pub severity: String,
    /// Human-readable message.
    pub message: String,
    /// Optional stable code (`vmz::target::...`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

/// Aggregated target-contract check report for gates and N-API.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TargetCheckReport {
    /// Always [`TARGET_CHECK_SCHEMA`].
    pub schema: String,
    /// Frozen View Operations document under check.
    #[serde(rename = "viewOps")]
    pub view_ops: ViewOpsDocument,
    /// Browser capability profile used for comparison.
    #[serde(rename = "browserProfile")]
    pub browser_profile: PlatformCapabilityProfile,
    /// Mini-program capability profile used for comparison.
    #[serde(rename = "miniProgramProfile")]
    pub mini_program_profile: PlatformCapabilityProfile,
    /// Sample / subject Mini Program artifact envelope.
    #[serde(rename = "miniProgramArtifact")]
    pub mini_program_artifact: MiniProgramArtifact,
    /// Allowed thin PlanNode kinds that map into View Operations.
    #[serde(rename = "allowedPlanKinds")]
    pub allowed_plan_kinds: Vec<String>,
    /// Diagnostics collected during the check.
    #[serde(default)]
    pub diagnostics: Vec<TargetDiagnostic>,
    /// Overall status: `ready` | `incomplete` | `failed`.
    pub status: String,
}

impl TargetCheckReport {
    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}
