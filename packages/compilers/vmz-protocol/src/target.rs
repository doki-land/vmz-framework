//! Target / multi-platform backend contracts (doc 24 · MP0).
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
/// MP0 target-contract check report.
pub const TARGET_CHECK_SCHEMA: &str = "vmz.target.check.v0";

pub const DIAG_DOM_LEAK_IN_PLAN: &str = "vmz::target::dom_leak_in_plan";
pub const DIAG_UNKNOWN_VIEW_OP: &str = "vmz::target::unknown_view_op";
pub const DIAG_PLATFORM_UNSUPPORTED: &str = "vmz::target::platform_unsupported";
pub const DIAG_PROFILE_INVALID: &str = "vmz::target::profile_invalid";
pub const DIAG_ARTIFACT_INVALID: &str = "vmz::target::artifact_invalid";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TargetDocumentKind {
    pub kind: String,
    pub schema: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TargetProtocolCatalog {
    pub schema: String,
    pub protocol: String,
    pub documents: Vec<TargetDocumentKind>,
    pub diagnostics: Vec<String>,
    /// Frozen View Operation kind names (doc 24 §3).
    #[serde(rename = "viewOperations")]
    pub view_operations: Vec<String>,
}

impl TargetProtocolCatalog {
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

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Canonical target-neutral View Operation kinds (doc 24 §3).
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
    pub kind: String,
    /// Structural PlanNode kind(s) this op covers in the current thin plan.
    #[serde(rename = "planKinds", default)]
    pub plan_kinds: Vec<String>,
    pub notes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ViewOpsDocument {
    pub schema: String,
    pub operations: Vec<ViewOpEntry>,
}

impl ViewOpsDocument {
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

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Capability verdict for one feature on a platform.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CapabilityVerdict {
    pub feature: String,
    /// `Native` | `Adapted` | `Degraded` | `Unsupported`
    pub verdict: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Versioned platform capability profile (doc 24 §4).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PlatformCapabilityProfile {
    pub schema: String,
    #[serde(rename = "platformId")]
    pub platform_id: String,
    /// `mini-program` | `browser` | …
    #[serde(rename = "family")]
    pub family: String,
    pub version: String,
    #[serde(rename = "templateFeatures", default)]
    pub template_features: Vec<CapabilityVerdict>,
    #[serde(rename = "eventFeatures", default)]
    pub event_features: Vec<CapabilityVerdict>,
    #[serde(rename = "styleFeatures", default)]
    pub style_features: Vec<CapabilityVerdict>,
    #[serde(rename = "navigationFeatures", default)]
    pub navigation_features: Vec<CapabilityVerdict>,
    #[serde(rename = "networkFeatures", default)]
    pub network_features: Vec<CapabilityVerdict>,
    #[serde(rename = "storageFeatures", default)]
    pub storage_features: Vec<CapabilityVerdict>,
    #[serde(rename = "lifecycleFeatures", default)]
    pub lifecycle_features: Vec<CapabilityVerdict>,
    #[serde(rename = "packageLimits", default)]
    pub package_limits: Vec<String>,
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
                reason: Some("normalized event → platform event name via adapter".into()),
            }],
            style_features: vec![CapabilityVerdict {
                feature: "wxss_like".into(),
                verdict: "Adapted".into(),
                reason: Some("Canonical Style Module → platform stylesheet".into()),
            }],
            navigation_features: vec![CapabilityVerdict {
                feature: "route_id".into(),
                verdict: "Adapted".into(),
                reason: Some("Route Graph → pages/subpackages".into()),
            }],
            network_features: vec![CapabilityVerdict {
                feature: "server_capability".into(),
                verdict: "Adapted".into(),
                reason: Some("#server → request transport; impl never in mini package".into()),
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

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Mini Program artifact envelope — lowering product only (doc 24 §2).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MiniProgramArtifact {
    pub schema: String,
    /// Always `mini-program` family; concrete adapter id lives in `platformId`.
    #[serde(rename = "platformId")]
    pub platform_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub logic: Option<String>,
    #[serde(rename = "eventTable", default, skip_serializing_if = "Option::is_none")]
    pub event_table: Option<String>,
    #[serde(rename = "dataPatchTable", default, skip_serializing_if = "Option::is_none")]
    pub data_patch_table: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub manifest: Option<String>,
    /// Provenance: Execution Plan schema id this artifact was lowered from.
    #[serde(rename = "planSchema")]
    pub plan_schema: String,
}

impl MiniProgramArtifact {
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

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TargetDiagnostic {
    pub path: String,
    pub severity: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

/// MP0 check report.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TargetCheckReport {
    pub schema: String,
    #[serde(rename = "viewOps")]
    pub view_ops: ViewOpsDocument,
    #[serde(rename = "browserProfile")]
    pub browser_profile: PlatformCapabilityProfile,
    #[serde(rename = "miniProgramProfile")]
    pub mini_program_profile: PlatformCapabilityProfile,
    #[serde(rename = "miniProgramArtifact")]
    pub mini_program_artifact: MiniProgramArtifact,
    /// Allowed thin PlanNode kinds that map into View Operations.
    #[serde(rename = "allowedPlanKinds")]
    pub allowed_plan_kinds: Vec<String>,
    #[serde(default)]
    pub diagnostics: Vec<TargetDiagnostic>,
    /// `ready` | `incomplete` | `failed`
    pub status: String,
}

impl TargetCheckReport {
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}
