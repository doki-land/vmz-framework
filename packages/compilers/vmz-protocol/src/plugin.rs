//! Plugin contribution protocol — closed stage / surface labels.
//!
//! Batch payloads and the contribution store live in the compiler crate; this
//! module owns the **wire labels** shared with DX explain rows and N-API hosts.
//! Analyzer severity is **not** redefined here — use oxc `Severity` at the
//! compiler / contribution boundary.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Locked plugin protocol id (must match Node `PLUGIN_PROTOCOL`).
pub const PLUGIN_PROTOCOL: &str = "0.1.0";

/// Pipeline stage that owns a contribution batch.
///
/// **Closed** unit enum. Host / N-API labels stay `snake_case`
/// (`workspace_resolve`, ...) so existing JS plugins keep working. IR wire
/// discriminators elsewhere use kebab-case.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum PluginStage {
    /// Virtual files / resolve maps map to source contributions.
    WorkspaceResolve,
    /// External format to VMZ source (still a source contribution).
    SourceAdapter,
    /// Read-only diagnostics / advice.
    Analyzer,
    /// Deployment target manifests (how to deploy, not what the program means).
    Target,
}

impl PluginStage {
    /// Host / N-API label (`snake_case`).
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::WorkspaceResolve => "workspace_resolve",
            Self::SourceAdapter => "source_adapter",
            Self::Analyzer => "analyzer",
            Self::Target => "target",
        }
    }

    /// Parse host stage labels (`snake_case`, kebab-case, or PascalCase).
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "workspace-resolve" | "workspace_resolve" | "WorkspaceResolve" => {
                Some(Self::WorkspaceResolve)
            }
            "source-adapter" | "source_adapter" | "SourceAdapter" => Some(Self::SourceAdapter),
            "analyzer" | "Analyzer" => Some(Self::Analyzer),
            "target" | "Target" => Some(Self::Target),
            _ => None,
        }
    }
}

/// Closed contribution surface label for explain / DX provenance rows.
///
/// Matches contribution payload variants (`source` | `analyzer` | `target` |
/// `graph-mutation`), not [`PluginStage`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum ExplainContributionSurface {
    /// Source / virtual-file contribution.
    Source,
    /// Analyzer diagnostic contribution.
    Analyzer,
    /// Deployment target contribution.
    Target,
    /// Graph-mutation attempt (rejected on apply; may still appear in history).
    GraphMutation,
}

impl ExplainContributionSurface {
    /// Wire / JSON label (`kebab-case`).
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Source => "source",
            Self::Analyzer => "analyzer",
            Self::Target => "target",
            Self::GraphMutation => "graph-mutation",
        }
    }

    /// Parse kebab-case labels.
    pub fn parse(s: &str) -> Option<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "source" => Some(Self::Source),
            "analyzer" => Some(Self::Analyzer),
            "target" => Some(Self::Target),
            "graph-mutation" | "graph_mutation" => Some(Self::GraphMutation),
            _ => None,
        }
    }
}

/// Closed `.vmz` module / deployment-unit kind on the wire.
///
/// Used by deployment documents, affected rebuild plans, and explain slices.
/// **Not** an open string — unknown labels belong only in scanners / negative tests.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum VmzModuleKind {
    /// Application root module (`Application.vmz`).
    Application,
    /// Routable page module.
    Page,
    /// Shared / local component module.
    Component,
    /// Unclassified `.vmz` module.
    #[default]
    Other,
}

impl VmzModuleKind {
    /// Wire / JSON label (`kebab-case`).
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Application => "application",
            Self::Page => "page",
            Self::Component => "component",
            Self::Other => "other",
        }
    }

    /// Parse kebab-case labels.
    pub fn parse(s: &str) -> Option<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "application" => Some(Self::Application),
            "page" => Some(Self::Page),
            "component" => Some(Self::Component),
            "other" => Some(Self::Other),
            _ => None,
        }
    }
}
