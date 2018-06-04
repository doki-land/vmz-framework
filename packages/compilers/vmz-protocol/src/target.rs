//! Target / multi-platform backend contracts.
//!
//! Freezes target-neutral View Operations, PlatformCapabilityProfile,
//! MiniProgramArtifact schema ids, and DOM-leak diagnostic codes.
//! No Mini Program semantic IR; no WeChat API in core schemas.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::check_status::CheckReportStatus;
use crate::reported_diagnostic::ReportedDiagnostic;

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
#[serde(rename_all = "camelCase")]
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
            view_operations: ViewOperationKind::ALL.iter().map(|k| (*k).as_str().into()).collect(),
        }
    }

    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Canonical target-neutral View Operation kinds shared by Browser and Mini.
///
/// **Closed** unit enum. Wire labels stay **PascalCase** (frozen catalog exception;
/// not kebab-case).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "PascalCase")]
pub enum ViewOperationKind {
    /// Logical view node create (not DOM `Node`).
    CreateNode,
    /// Normalized static view property (not HTML attribute).
    SetStaticProperty,
    /// Binding-driven property patch.
    PatchProperty,
    /// Binding-driven text patch.
    PatchText,
    /// Region branch selection.
    SelectBranch,
    /// Keyed list reconcile.
    ReconcileKeyed,
    /// Normalized semantic event attach.
    AttachEvent,
    /// Component mount boundary.
    MountComponent,
    /// Slot projection.
    ProjectSlot,
    /// LifetimeRegion dispose.
    DisposeRegion,
}

impl ViewOperationKind {
    /// All closed variants in catalog order.
    pub const ALL: &[Self] = &[
        Self::CreateNode,
        Self::SetStaticProperty,
        Self::PatchProperty,
        Self::PatchText,
        Self::SelectBranch,
        Self::ReconcileKeyed,
        Self::AttachEvent,
        Self::MountComponent,
        Self::ProjectSlot,
        Self::DisposeRegion,
    ];

    /// Frozen wire / JSON label (`PascalCase`).
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::CreateNode => "CreateNode",
            Self::SetStaticProperty => "SetStaticProperty",
            Self::PatchProperty => "PatchProperty",
            Self::PatchText => "PatchText",
            Self::SelectBranch => "SelectBranch",
            Self::ReconcileKeyed => "ReconcileKeyed",
            Self::AttachEvent => "AttachEvent",
            Self::MountComponent => "MountComponent",
            Self::ProjectSlot => "ProjectSlot",
            Self::DisposeRegion => "DisposeRegion",
        }
    }
}

impl std::fmt::Display for ViewOperationKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Catalog labels mirroring [`ViewOperationKind::ALL`] (PascalCase).
pub const VIEW_OPERATION_KINDS: &[&str] = &[
    ViewOperationKind::CreateNode.as_str(),
    ViewOperationKind::SetStaticProperty.as_str(),
    ViewOperationKind::PatchProperty.as_str(),
    ViewOperationKind::PatchText.as_str(),
    ViewOperationKind::SelectBranch.as_str(),
    ViewOperationKind::ReconcileKeyed.as_str(),
    ViewOperationKind::AttachEvent.as_str(),
    ViewOperationKind::MountComponent.as_str(),
    ViewOperationKind::ProjectSlot.as_str(),
    ViewOperationKind::DisposeRegion.as_str(),
];

/// One View Operation entry in the frozen catalog.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ViewOpEntry {
    /// Operation kind (closed [`ViewOperationKind`]).
    pub kind: ViewOperationKind,
    /// Structural PlanNode kind(s) this op covers in the thin plan.
    #[serde(default)]
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
                    kind: ViewOperationKind::CreateNode,
                    plan_kinds: vec!["element".into(), "text".into()],
                    notes: "Logical view node; not DOM Node".into(),
                },
                ViewOpEntry {
                    kind: ViewOperationKind::SetStaticProperty,
                    plan_kinds: vec!["element".into()],
                    notes: "Normalized view property; not HTML attribute".into(),
                },
                ViewOpEntry {
                    kind: ViewOperationKind::PatchProperty,
                    plan_kinds: vec!["element".into()],
                    notes: "Binding-driven property patch".into(),
                },
                ViewOpEntry {
                    kind: ViewOperationKind::PatchText,
                    plan_kinds: vec!["interp".into(), "text".into()],
                    notes: "Binding-driven text patch".into(),
                },
                ViewOpEntry {
                    kind: ViewOperationKind::SelectBranch,
                    plan_kinds: vec!["if".into()],
                    notes: "Region branch selection".into(),
                },
                ViewOpEntry {
                    kind: ViewOperationKind::ReconcileKeyed,
                    plan_kinds: vec!["each".into()],
                    notes: "Keyed list reconcile".into(),
                },
                ViewOpEntry {
                    kind: ViewOperationKind::AttachEvent,
                    plan_kinds: vec![],
                    notes: "Normalized semantic event; Browser/Mini lowering diverge".into(),
                },
                ViewOpEntry {
                    kind: ViewOperationKind::MountComponent,
                    plan_kinds: vec!["component".into()],
                    notes: "Component mount boundary".into(),
                },
                ViewOpEntry {
                    kind: ViewOperationKind::ProjectSlot,
                    plan_kinds: vec!["slot".into()],
                    notes: "Slot projection".into(),
                },
                ViewOpEntry {
                    kind: ViewOperationKind::DisposeRegion,
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

/// Closed platform feature verdict for [`CapabilityVerdict`].
///
/// **Closed** unit enum. Wire labels stay **PascalCase** (frozen catalog
/// exception): `Native` | `Adapted` | `Degraded` | `Unsupported`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "PascalCase")]
pub enum PlatformFeatureVerdict {
    /// Feature is native on this platform.
    Native,
    /// Feature works via adapter lowering.
    Adapted,
    /// Feature works with degraded semantics.
    Degraded,
    /// Feature cannot be expressed.
    Unsupported,
}

impl PlatformFeatureVerdict {
    /// Wire / JSON label (`PascalCase`).
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Native => "Native",
            Self::Adapted => "Adapted",
            Self::Degraded => "Degraded",
            Self::Unsupported => "Unsupported",
        }
    }
}

impl std::fmt::Display for PlatformFeatureVerdict {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Closed platform family bucket for capability profiles.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum PlatformFamily {
    /// Mini-program family (neutral; not WeChat-specific).
    MiniProgram,
    /// Browser / WebSurface family.
    Browser,
}

impl PlatformFamily {
    /// Wire / JSON label (`kebab-case`).
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::MiniProgram => "mini-program",
            Self::Browser => "browser",
        }
    }
}

impl std::fmt::Display for PlatformFamily {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Capability verdict for one feature on a platform.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CapabilityVerdict {
    /// Feature id checked against the platform (`static_element`, `tap`, ...).
    pub feature: String,
    /// Verdict (closed [`PlatformFeatureVerdict`]).
    pub verdict: PlatformFeatureVerdict,
    /// Optional explanation when not `Native`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Versioned platform capability profile consumed by target check / adapters.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlatformCapabilityProfile {
    /// Always [`PLATFORM_PROFILE_SCHEMA`].
    pub schema: String,
    /// Concrete platform id (`browser`, `mini-program`, adapter-specific ids).
    pub platform_id: String,
    /// Family bucket (closed [`PlatformFamily`]).
    pub family: PlatformFamily,
    /// Profile revision string for this platform id.
    pub version: String,
    /// Template / structure feature verdicts.
    #[serde(default)]
    pub template_features: Vec<CapabilityVerdict>,
    /// Event feature verdicts.
    #[serde(default)]
    pub event_features: Vec<CapabilityVerdict>,
    /// Style feature verdicts.
    #[serde(default)]
    pub style_features: Vec<CapabilityVerdict>,
    /// Navigation / routing feature verdicts.
    #[serde(default)]
    pub navigation_features: Vec<CapabilityVerdict>,
    /// Network / RPC feature verdicts.
    #[serde(default)]
    pub network_features: Vec<CapabilityVerdict>,
    /// Storage feature verdicts.
    #[serde(default)]
    pub storage_features: Vec<CapabilityVerdict>,
    /// Lifecycle feature verdicts.
    #[serde(default)]
    pub lifecycle_features: Vec<CapabilityVerdict>,
    /// Named package size / count limits the adapter must respect.
    #[serde(default)]
    pub package_limits: Vec<String>,
    /// Named security constraints (`no_eval`, `domain_allowlist`, ...).
    #[serde(default)]
    pub security_constraints: Vec<String>,
}

impl PlatformCapabilityProfile {
    /// Neutral mini-program family profile (not WeChat-specific).
    pub fn mini_program_neutral_v0() -> Self {
        Self {
            schema: PLATFORM_PROFILE_SCHEMA.into(),
            platform_id: "mini-program".into(),
            family: PlatformFamily::MiniProgram,
            version: "0".into(),
            template_features: vec![
                CapabilityVerdict {
                    feature: "static_element".into(),
                    verdict: PlatformFeatureVerdict::Native,
                    reason: None,
                },
                CapabilityVerdict {
                    feature: "interpolation".into(),
                    verdict: PlatformFeatureVerdict::Native,
                    reason: None,
                },
                CapabilityVerdict {
                    feature: "conditional".into(),
                    verdict: PlatformFeatureVerdict::Native,
                    reason: None,
                },
                CapabilityVerdict {
                    feature: "keyed_list".into(),
                    verdict: PlatformFeatureVerdict::Native,
                    reason: None,
                },
            ],
            event_features: vec![CapabilityVerdict {
                feature: "tap".into(),
                verdict: PlatformFeatureVerdict::Adapted,
                reason: Some("normalized event -> platform event name via adapter".into()),
            }],
            style_features: vec![CapabilityVerdict {
                feature: "wxss_like".into(),
                verdict: PlatformFeatureVerdict::Adapted,
                reason: Some("Canonical Style Module -> platform stylesheet".into()),
            }],
            navigation_features: vec![CapabilityVerdict {
                feature: "route_id".into(),
                verdict: PlatformFeatureVerdict::Adapted,
                reason: Some("Route Graph -> pages/subpackages".into()),
            }],
            network_features: vec![CapabilityVerdict {
                feature: "server_capability".into(),
                verdict: PlatformFeatureVerdict::Adapted,
                reason: Some("#server -> request transport; impl never in mini package".into()),
            }],
            storage_features: vec![],
            lifecycle_features: vec![CapabilityVerdict {
                feature: "page_show_hide".into(),
                verdict: PlatformFeatureVerdict::Adapted,
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
            family: PlatformFamily::Browser,
            version: "0".into(),
            template_features: vec![CapabilityVerdict {
                feature: "dom_create_patch".into(),
                verdict: PlatformFeatureVerdict::Native,
                reason: None,
            }],
            event_features: vec![CapabilityVerdict {
                feature: "dom_events".into(),
                verdict: PlatformFeatureVerdict::Native,
                reason: None,
            }],
            style_features: vec![CapabilityVerdict {
                feature: "css".into(),
                verdict: PlatformFeatureVerdict::Native,
                reason: None,
            }],
            navigation_features: vec![CapabilityVerdict {
                feature: "history_router".into(),
                verdict: PlatformFeatureVerdict::Native,
                reason: None,
            }],
            network_features: vec![CapabilityVerdict {
                feature: "fetch_rpc".into(),
                verdict: PlatformFeatureVerdict::Native,
                reason: None,
            }],
            storage_features: vec![],
            lifecycle_features: vec![CapabilityVerdict {
                feature: "ssr_resume".into(),
                verdict: PlatformFeatureVerdict::Native,
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
#[serde(rename_all = "camelCase")]
pub struct MiniProgramArtifact {
    /// Always [`MINI_PROGRAM_ARTIFACT_SCHEMA`].
    pub schema: String,
    /// Always `mini-program` family; concrete adapter id lives in `platform_id`.
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event_table: Option<String>,
    /// Optional serialized data-patch table.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_patch_table: Option<String>,
    /// Optional platform manifest fragment.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub manifest: Option<String>,
    /// Provenance: Execution Plan schema id this artifact was lowered from.
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

/// Target-contract diagnostic — alias of [`ReportedDiagnostic`].
pub type TargetDiagnostic = ReportedDiagnostic;

/// Aggregated target-contract check report for gates and N-API.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TargetCheckReport {
    /// Always [`TARGET_CHECK_SCHEMA`].
    pub schema: String,
    /// Frozen View Operations document under check.
    pub view_ops: ViewOpsDocument,
    /// Browser capability profile used for comparison.
    pub browser_profile: PlatformCapabilityProfile,
    /// Mini-program capability profile used for comparison.
    pub mini_program_profile: PlatformCapabilityProfile,
    /// Sample / subject Mini Program artifact envelope.
    pub mini_program_artifact: MiniProgramArtifact,
    /// Allowed thin PlanNode kinds that map into View Operations.
    pub allowed_plan_kinds: Vec<String>,
    /// Diagnostics collected during the check.
    #[serde(default)]
    pub diagnostics: Vec<TargetDiagnostic>,
    /// Aggregate status ([`CheckReportStatus`]).
    pub status: CheckReportStatus,
}

impl TargetCheckReport {
    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}
