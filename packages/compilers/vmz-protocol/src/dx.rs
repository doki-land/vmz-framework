//! Unified DX query protocol.
//!
//! CLI / LSP / MCP / DevTools share these schema ids and StableId shapes for
//! Symbol, Reference, Explain, WorkspaceEdit, CodeAction, Affected, Rename,
//! TestSelection, HMR, budgets, causal replay, and related check documents.
//! RenameIntent plus Symbol/Reference-proven WorkspaceEdit describe apply plans;
//! hosts execute edits outside this crate.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::reported_diagnostic::ReportedDiagnostic;

/// Umbrella DX protocol version (catalog / handshake).
pub const DX_PROTOCOL: &str = "vmz.dx.v0";

/// Schema id for a cross-SFC Symbol document.
pub const SYMBOL_SCHEMA: &str = "vmz.dx.symbol.v0";

/// Schema id for a Symbol reference edge document.
pub const REFERENCE_SCHEMA: &str = "vmz.dx.reference.v0";

/// Schema id for a causal Explain document.
pub const EXPLAIN_SCHEMA: &str = "vmz.dx.explain.v0";

/// Legacy explain id - still recognized; new emits use [`EXPLAIN_SCHEMA`].
pub const EXPLAIN_SCHEMA_LEGACY: &str = "vmz.explain.v0";

/// Schema id for a WorkspaceEdit plan (preview / ready / rejected).
pub const WORKSPACE_EDIT_SCHEMA: &str = "vmz.dx.workspace_edit.v0";

/// Schema id for a CodeAction proposal.
pub const CODE_ACTION_SCHEMA: &str = "vmz.dx.code_action.v0";

/// Schema id for an Affected rebuild plan.
pub const AFFECTED_SCHEMA: &str = "vmz.dx.affected.v0";

/// Schema id for a RenameIntent envelope (plans still emit [`WORKSPACE_EDIT_SCHEMA`]).
pub const RENAME_SCHEMA: &str = "vmz.dx.rename.v0";

/// Schema id for graph-driven test selection (`vmz test --affected` / `--target changed`).
pub const TEST_SELECTION_SCHEMA: &str = "vmz.dx.test_selection.v0";

/// Schema id for template/script source-map entry documents.
pub const SOURCE_MAP_SCHEMA: &str = "vmz.dx.source_map.v0";

/// Schema id for the workspace Symbol/Reference index document.
pub const SYMBOL_INDEX_SCHEMA: &str = "vmz.dx.symbol_index.v0";

/// Schema id for the cross-SFC conformance check report.
pub const CROSS_SFC_CHECK_SCHEMA: &str = "vmz.dx.cross_sfc_check.v0";

/// Schema id for a semantic transaction (atomic TextEdit batch).
pub const SEMANTIC_TRANSACTION_SCHEMA: &str = "vmz.dx.semantic_transaction.v0";

/// Schema id for an analysis/build cancel ticket.
pub const CANCEL_SCHEMA: &str = "vmz.dx.cancel.v0";

/// Schema id for affected preview (chunks + tests + routes + regions).
pub const AFFECTED_PREVIEW_SCHEMA: &str = "vmz.dx.affected_preview.v0";

/// Schema id for an HMR plan.
pub const HMR_PLAN_SCHEMA: &str = "vmz.dx.hmr_plan.v0";

/// Schema id for route/chunk budget (algebraic unitCost).
pub const BUDGET_SCHEMA: &str = "vmz.dx.budget.v0";

/// Schema id for the transaction/HMR/budget umbrella check report.
pub const TRANSACTION_CHECK_SCHEMA: &str = "vmz.dx.transaction_check.v0";

/// Schema id for deployment boundary validators (route / resume / rpc / action).
pub const BOUNDARY_VALIDATOR_SCHEMA: &str = "vmz.dx.boundary_validator.v0";

/// Schema id for client/server leakage findings.
pub const LEAKAGE_SCHEMA: &str = "vmz.dx.leakage.v0";

/// Schema id for capability -> target mapping documents.
pub const CAPABILITY_TARGET_SCHEMA: &str = "vmz.dx.capability_target.v0";

/// Schema id for dead chunk / unreferenced capability reports.
pub const DEAD_GRAPH_SCHEMA: &str = "vmz.dx.dead_graph.v0";

/// Schema id for the deployment-proof conformance check report.
pub const DEPLOYMENT_PROOF_CHECK_SCHEMA: &str = "vmz.dx.deployment_proof_check.v0";

/// Schema id for runtime trace events tagged with StableIds.
pub const TRACE_SCHEMA: &str = "vmz.dx.trace.v0";

/// Schema id for join of trace events / explain causal chains.
pub const CAUSAL_REPLAY_SCHEMA: &str = "vmz.dx.causal_replay.v0";

/// Schema id for the causal-replay conformance check report.
pub const CAUSAL_REPLAY_CHECK_SCHEMA: &str = "vmz.dx.causal_replay_check.v0";

/// Catalog of frozen schema ids for host handshake.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct DxCatalog {
    /// Always [`DX_PROTOCOL`].
    pub schema: String,
    /// Same as `schema` (parity with other domain catalogs).
    pub protocol: String,
    /// Document kinds this generation publishes.
    pub documents: Vec<DxDocumentKind>,
}

/// Closed DX catalog document kind ids (snake_case on the wire).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum DxCatalogKind {
    /// Symbol document.
    Symbol,
    /// Reference edge document.
    Reference,
    /// Causal explain document.
    Explain,
    /// Workspace edit plan.
    WorkspaceEdit,
    /// Code action proposal.
    CodeAction,
    /// Affected rebuild plan.
    Affected,
    /// Rename intent.
    Rename,
    /// Graph-driven test selection.
    TestSelection,
    /// Template/script source map entry.
    SourceMap,
    /// Workspace symbol index.
    SymbolIndex,
    /// Cross-SFC conformance check.
    CrossSfcCheck,
    /// Semantic transaction.
    SemanticTransaction,
    /// Cancel ticket.
    Cancel,
    /// Affected preview.
    AffectedPreview,
    /// HMR plan.
    HmrPlan,
    /// Route/chunk budget.
    Budget,
    /// Transaction/HMR/budget umbrella check.
    TransactionCheck,
    /// Boundary validators.
    BoundaryValidator,
    /// Client/server leakage.
    Leakage,
    /// Capability → target map.
    CapabilityTarget,
    /// Dead graph report.
    DeadGraph,
    /// Deployment proof umbrella check.
    DeploymentProofCheck,
    /// Runtime trace.
    Trace,
    /// Causal replay document.
    CausalReplay,
    /// Causal replay umbrella check.
    CausalReplayCheck,
}

impl DxCatalogKind {
    /// Wire / JSON label (`snake_case`).
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Symbol => "symbol",
            Self::Reference => "reference",
            Self::Explain => "explain",
            Self::WorkspaceEdit => "workspace_edit",
            Self::CodeAction => "code_action",
            Self::Affected => "affected",
            Self::Rename => "rename",
            Self::TestSelection => "test_selection",
            Self::SourceMap => "source_map",
            Self::SymbolIndex => "symbol_index",
            Self::CrossSfcCheck => "cross_sfc_check",
            Self::SemanticTransaction => "semantic_transaction",
            Self::Cancel => "cancel",
            Self::AffectedPreview => "affected_preview",
            Self::HmrPlan => "hmr_plan",
            Self::Budget => "budget",
            Self::TransactionCheck => "transaction_check",
            Self::BoundaryValidator => "boundary_validator",
            Self::Leakage => "leakage",
            Self::CapabilityTarget => "capability_target",
            Self::DeadGraph => "dead_graph",
            Self::DeploymentProofCheck => "deployment_proof_check",
            Self::Trace => "trace",
            Self::CausalReplay => "causal_replay",
            Self::CausalReplayCheck => "causal_replay_check",
        }
    }
}

/// One document kind entry inside [`DxCatalog`].
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct DxDocumentKind {
    /// Closed kind id.
    pub kind: DxCatalogKind,
    /// Schema id for that kind.
    pub schema: String,
}

impl DxCatalog {
    /// Frozen catalog for the current DX protocol generation.
    pub fn v0() -> Self {
        Self {
            schema: DX_PROTOCOL.into(),
            protocol: DX_PROTOCOL.into(),
            documents: vec![
                DxDocumentKind { kind: DxCatalogKind::Symbol, schema: SYMBOL_SCHEMA.into() },
                DxDocumentKind { kind: DxCatalogKind::Reference, schema: REFERENCE_SCHEMA.into() },
                DxDocumentKind { kind: DxCatalogKind::Explain, schema: EXPLAIN_SCHEMA.into() },
                DxDocumentKind {
                    kind: DxCatalogKind::WorkspaceEdit,
                    schema: WORKSPACE_EDIT_SCHEMA.into(),
                },
                DxDocumentKind {
                    kind: DxCatalogKind::CodeAction,
                    schema: CODE_ACTION_SCHEMA.into(),
                },
                DxDocumentKind { kind: DxCatalogKind::Affected, schema: AFFECTED_SCHEMA.into() },
                DxDocumentKind { kind: DxCatalogKind::Rename, schema: RENAME_SCHEMA.into() },
                DxDocumentKind {
                    kind: DxCatalogKind::TestSelection,
                    schema: TEST_SELECTION_SCHEMA.into(),
                },
                DxDocumentKind { kind: DxCatalogKind::SourceMap, schema: SOURCE_MAP_SCHEMA.into() },
                DxDocumentKind {
                    kind: DxCatalogKind::SymbolIndex,
                    schema: SYMBOL_INDEX_SCHEMA.into(),
                },
                DxDocumentKind {
                    kind: DxCatalogKind::CrossSfcCheck,
                    schema: CROSS_SFC_CHECK_SCHEMA.into(),
                },
                DxDocumentKind {
                    kind: DxCatalogKind::SemanticTransaction,
                    schema: SEMANTIC_TRANSACTION_SCHEMA.into(),
                },
                DxDocumentKind { kind: DxCatalogKind::Cancel, schema: CANCEL_SCHEMA.into() },
                DxDocumentKind {
                    kind: DxCatalogKind::AffectedPreview,
                    schema: AFFECTED_PREVIEW_SCHEMA.into(),
                },
                DxDocumentKind { kind: DxCatalogKind::HmrPlan, schema: HMR_PLAN_SCHEMA.into() },
                DxDocumentKind { kind: DxCatalogKind::Budget, schema: BUDGET_SCHEMA.into() },
                DxDocumentKind {
                    kind: DxCatalogKind::TransactionCheck,
                    schema: TRANSACTION_CHECK_SCHEMA.into(),
                },
                DxDocumentKind {
                    kind: DxCatalogKind::BoundaryValidator,
                    schema: BOUNDARY_VALIDATOR_SCHEMA.into(),
                },
                DxDocumentKind { kind: DxCatalogKind::Leakage, schema: LEAKAGE_SCHEMA.into() },
                DxDocumentKind {
                    kind: DxCatalogKind::CapabilityTarget,
                    schema: CAPABILITY_TARGET_SCHEMA.into(),
                },
                DxDocumentKind { kind: DxCatalogKind::DeadGraph, schema: DEAD_GRAPH_SCHEMA.into() },
                DxDocumentKind {
                    kind: DxCatalogKind::DeploymentProofCheck,
                    schema: DEPLOYMENT_PROOF_CHECK_SCHEMA.into(),
                },
                DxDocumentKind { kind: DxCatalogKind::Trace, schema: TRACE_SCHEMA.into() },
                DxDocumentKind {
                    kind: DxCatalogKind::CausalReplay,
                    schema: CAUSAL_REPLAY_SCHEMA.into(),
                },
                DxDocumentKind {
                    kind: DxCatalogKind::CausalReplayCheck,
                    schema: CAUSAL_REPLAY_CHECK_SCHEMA.into(),
                },
            ],
        }
    }

    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Workspace edit plan lifecycle status (closed).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum WorkspaceEditStatus {
    /// Dry-run / not yet proven ready to apply.
    Preview,
    /// Host may apply the edit batch.
    Ready,
    /// Planning failed; do not apply.
    Rejected,
    /// Host has applied the edit batch atomically.
    Applied,
}

impl WorkspaceEditStatus {
    /// Wire / JSON label (`kebab-case`).
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Preview => "preview",
            Self::Ready => "ready",
            Self::Rejected => "rejected",
            Self::Applied => "applied",
        }
    }
}

/// Shared preview / ready / empty status for budget and test-selection docs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum DxPreviewStatus {
    /// Partial / advisory result.
    Preview,
    /// Complete useful result.
    Ready,
    /// No rows / nothing to report.
    Empty,
}

impl DxPreviewStatus {
    /// Wire / JSON label (`kebab-case`).
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Preview => "preview",
            Self::Ready => "ready",
            Self::Empty => "empty",
        }
    }
}

/// Trace document status (closed).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum TraceStatus {
    /// Trace ingested successfully.
    Ready,
    /// No events.
    Empty,
    /// Malformed / rejected input.
    Invalid,
}

impl TraceStatus {
    /// Wire / JSON label (`kebab-case`).
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Ready => "ready",
            Self::Empty => "empty",
            Self::Invalid => "invalid",
        }
    }
}

/// Causal replay document status (closed).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum CausalReplayStatus {
    /// Join completed with matches.
    Ready,
    /// Join failed (bad stable ids / missing graph).
    Failed,
    /// Nothing to replay.
    Empty,
}

impl CausalReplayStatus {
    /// Wire / JSON label (`kebab-case`).
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Ready => "ready",
            Self::Failed => "failed",
            Self::Empty => "empty",
        }
    }
}

/// Transaction / HMR / budget umbrella check status (closed).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum TransactionCheckStatus {
    /// All samples ready.
    Ready,
    /// Partial samples (e.g. budget empty).
    Preview,
    /// Missing required inputs.
    Incomplete,
}

impl TransactionCheckStatus {
    /// Wire / JSON label (`kebab-case`).
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Ready => "ready",
            Self::Preview => "preview",
            Self::Incomplete => "incomplete",
        }
    }
}

/// Causal-replay umbrella check status (closed).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum CausalReplayCheckStatus {
    /// Samples ready.
    Ready,
    /// Advisory / partial samples.
    Preview,
    /// Blocking failure in samples.
    Failed,
}

impl CausalReplayCheckStatus {
    /// Wire / JSON label (`kebab-case`).
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Ready => "ready",
            Self::Preview => "preview",
            Self::Failed => "failed",
        }
    }
}

/// Source location shared across DX documents (oxc Span as offsets; path is workspace-relative).
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct SourceSpan {
    /// Workspace-relative file path.
    pub path: String,
    /// Inclusive byte offset start (oxc Span).
    pub start: u32,
    /// Exclusive byte offset end (oxc Span).
    pub end: u32,
}

/// Closed identity family discriminant for [`StableId`] filters / rename targets.
///
/// Prefer matching on the [`StableId`] tagged union itself when the id payload
/// matters. Use this Copy tag only for allow-lists and rename kind parsing.
///
/// Serialize / deserialize as **kebab-case** only (`route-id`, `text-edit`, …).
/// No snake_case aliases — wire follows Rust; fixtures and hosts must match.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum StableIdKind {
    /// Reactive binding id.
    Binding,
    /// Effect / method id.
    Effect,
    /// Field / state path.
    Field,
    /// Route id.
    RouteId,
    /// Server capability.
    Capability,
    /// Deployment chunk.
    Chunk,
    /// Patch / HMR unit.
    Patch,
    /// Component / class.
    Component,
    /// Method symbol.
    Method,
    /// Workspace file path identity.
    File,
    /// Template region of an SFC.
    Template,
    /// Client script facet.
    Client,
    /// Server script facet.
    Server,
    /// Rename operation identity.
    Rename,
    /// Test chunk / case.
    Test,
    /// Text edit span identity.
    TextEdit,
    /// Style explain facet.
    Style,
    /// Style source file.
    StyleFile,
    /// Style entry path.
    StyleEntry,
    /// Emitted CSS asset.
    CssAsset,
    /// Tailwind utility identity.
    StyleTw,
    /// Design token leaf.
    DesignToken,
    /// CSS custom property.
    CssVar,
}

impl StableIdKind {
    /// Wire / JSON label (`kebab-case`), matching serde export.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Binding => "binding",
            Self::Effect => "effect",
            Self::Field => "field",
            Self::RouteId => "route-id",
            Self::Capability => "capability",
            Self::Chunk => "chunk",
            Self::Patch => "patch",
            Self::Component => "component",
            Self::Method => "method",
            Self::File => "file",
            Self::Template => "template",
            Self::Client => "client",
            Self::Server => "server",
            Self::Rename => "rename",
            Self::Test => "test",
            Self::TextEdit => "text-edit",
            Self::Style => "style",
            Self::StyleFile => "style-file",
            Self::StyleEntry => "style-entry",
            Self::CssAsset => "css-asset",
            Self::StyleTw => "style-tw",
            Self::DesignToken => "design-token",
            Self::CssVar => "css-var",
        }
    }

    /// Parse a bare label from non-JSON surfaces (`kind:id`, `rename:…`).
    ///
    /// Wire vocabulary is owned by serde (`kebab-case`). Short CLI synonyms
    /// (`route` → `route-id`, `prop`/`state` → `field`, `class` → `component`)
    /// are rewritten first; snake_case is rejected.
    pub fn parse(s: &str) -> Option<Self> {
        let lower = s.trim().to_ascii_lowercase();
        if lower.is_empty() {
            return None;
        }
        let wire = match lower.as_str() {
            "route" => "route-id",
            "prop" | "state" => "field",
            "class" => "component",
            other => other,
        };
        serde_json::from_str(&format!("\"{wire}\"")).ok()
    }
}

impl std::fmt::Display for StableIdKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Stable program identity — **tagged union** (`kind` + `id` content), not
/// `struct { kind, id }` with `.kind ==` branching.
///
/// Wire shape stays `{ "kind": "field", "id": "user.name" }` via serde
/// `tag = "kind", content = "id"`.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(tag = "kind", content = "id", rename_all = "kebab-case")]
pub enum StableId {
    /// Reactive binding id.
    Binding(String),
    /// Effect / method id.
    Effect(String),
    /// Field / state path.
    Field(String),
    /// Route id.
    RouteId(String),
    /// Server capability.
    Capability(String),
    /// Deployment chunk.
    Chunk(String),
    /// Patch / HMR unit.
    Patch(String),
    /// Component / class.
    Component(String),
    /// Method symbol.
    Method(String),
    /// Workspace file path identity.
    File(String),
    /// Template region of an SFC.
    Template(String),
    /// Client script facet.
    Client(String),
    /// Server script facet.
    Server(String),
    /// Rename operation identity.
    Rename(String),
    /// Test chunk / case.
    Test(String),
    /// Text edit span identity.
    TextEdit(String),
    /// Style explain facet.
    Style(String),
    /// Style source file.
    StyleFile(String),
    /// Style entry path.
    StyleEntry(String),
    /// Emitted CSS asset.
    CssAsset(String),
    /// Tailwind utility identity.
    StyleTw(String),
    /// Design token leaf.
    DesignToken(String),
    /// CSS custom property.
    CssVar(String),
}

impl StableId {
    /// Build from a closed discriminant + opaque id (host / rename helpers).
    pub fn new(kind: StableIdKind, id: impl Into<String>) -> Self {
        let id = id.into();
        match kind {
            StableIdKind::Binding => Self::Binding(id),
            StableIdKind::Effect => Self::Effect(id),
            StableIdKind::Field => Self::Field(id),
            StableIdKind::RouteId => Self::RouteId(id),
            StableIdKind::Capability => Self::Capability(id),
            StableIdKind::Chunk => Self::Chunk(id),
            StableIdKind::Patch => Self::Patch(id),
            StableIdKind::Component => Self::Component(id),
            StableIdKind::Method => Self::Method(id),
            StableIdKind::File => Self::File(id),
            StableIdKind::Template => Self::Template(id),
            StableIdKind::Client => Self::Client(id),
            StableIdKind::Server => Self::Server(id),
            StableIdKind::Rename => Self::Rename(id),
            StableIdKind::Test => Self::Test(id),
            StableIdKind::TextEdit => Self::TextEdit(id),
            StableIdKind::Style => Self::Style(id),
            StableIdKind::StyleFile => Self::StyleFile(id),
            StableIdKind::StyleEntry => Self::StyleEntry(id),
            StableIdKind::CssAsset => Self::CssAsset(id),
            StableIdKind::StyleTw => Self::StyleTw(id),
            StableIdKind::DesignToken => Self::DesignToken(id),
            StableIdKind::CssVar => Self::CssVar(id),
        }
    }

    /// Closed discriminant (filter helper; prefer matching `self` when possible).
    pub fn kind(&self) -> StableIdKind {
        match self {
            Self::Binding(_) => StableIdKind::Binding,
            Self::Effect(_) => StableIdKind::Effect,
            Self::Field(_) => StableIdKind::Field,
            Self::RouteId(_) => StableIdKind::RouteId,
            Self::Capability(_) => StableIdKind::Capability,
            Self::Chunk(_) => StableIdKind::Chunk,
            Self::Patch(_) => StableIdKind::Patch,
            Self::Component(_) => StableIdKind::Component,
            Self::Method(_) => StableIdKind::Method,
            Self::File(_) => StableIdKind::File,
            Self::Template(_) => StableIdKind::Template,
            Self::Client(_) => StableIdKind::Client,
            Self::Server(_) => StableIdKind::Server,
            Self::Rename(_) => StableIdKind::Rename,
            Self::Test(_) => StableIdKind::Test,
            Self::TextEdit(_) => StableIdKind::TextEdit,
            Self::Style(_) => StableIdKind::Style,
            Self::StyleFile(_) => StableIdKind::StyleFile,
            Self::StyleEntry(_) => StableIdKind::StyleEntry,
            Self::CssAsset(_) => StableIdKind::CssAsset,
            Self::StyleTw(_) => StableIdKind::StyleTw,
            Self::DesignToken(_) => StableIdKind::DesignToken,
            Self::CssVar(_) => StableIdKind::CssVar,
        }
    }

    /// Opaque id string within this family.
    pub fn id(&self) -> &str {
        match self {
            Self::Binding(id)
            | Self::Effect(id)
            | Self::Field(id)
            | Self::RouteId(id)
            | Self::Capability(id)
            | Self::Chunk(id)
            | Self::Patch(id)
            | Self::Component(id)
            | Self::Method(id)
            | Self::File(id)
            | Self::Template(id)
            | Self::Client(id)
            | Self::Server(id)
            | Self::Rename(id)
            | Self::Test(id)
            | Self::TextEdit(id)
            | Self::Style(id)
            | Self::StyleFile(id)
            | Self::StyleEntry(id)
            | Self::CssAsset(id)
            | Self::StyleTw(id)
            | Self::DesignToken(id)
            | Self::CssVar(id) => id.as_str(),
        }
    }
}

/// Closed explain document flavor.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum ExplainKind {
    /// Chunk / deployment unit explain.
    Chunk,
    /// Field write causal explain.
    Write,
    /// Binding update causal explain.
    Update,
    /// Style / token explain.
    Style,
    /// Binding-centric explain.
    Binding,
    /// Effect-centric explain.
    Effect,
    /// Route-centric explain.
    Route,
    /// Rename plan explain.
    Rename,
    /// Plugin contribution explain.
    Contribution,
    /// Server capability explain.
    Capability,
    /// Client→server call edge explain.
    Call,
    /// Generic graph edge explain.
    Edge,
    /// Source-path resolved explain.
    Source,
}

impl ExplainKind {
    /// Wire / JSON label (`kebab-case`).
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Chunk => "chunk",
            Self::Write => "write",
            Self::Update => "update",
            Self::Style => "style",
            Self::Binding => "binding",
            Self::Effect => "effect",
            Self::Route => "route",
            Self::Rename => "rename",
            Self::Contribution => "contribution",
            Self::Capability => "capability",
            Self::Call => "call",
            Self::Edge => "edge",
            Self::Source => "source",
        }
    }

    /// Parse host / legacy labels.
    pub fn parse(s: &str) -> Option<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "chunk" => Some(Self::Chunk),
            "write" => Some(Self::Write),
            "update" => Some(Self::Update),
            "style" => Some(Self::Style),
            "binding" => Some(Self::Binding),
            "effect" => Some(Self::Effect),
            "route" => Some(Self::Route),
            "rename" => Some(Self::Rename),
            "contribution" => Some(Self::Contribution),
            "capability" => Some(Self::Capability),
            "call" => Some(Self::Call),
            "edge" => Some(Self::Edge),
            "source" => Some(Self::Source),
            _ => None,
        }
    }
}

/// Closed code-action kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum CodeActionKind {
    /// Compiler-proven safe fix.
    SafeFix,
    /// Guided migration (may need user choice).
    Migration,
    /// Design / policy choice (not auto-applied).
    DesignChoice,
}

impl CodeActionKind {
    /// Wire / JSON label (`kebab-case`).
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::SafeFix => "safe-fix",
            Self::Migration => "migration",
            Self::DesignChoice => "design-choice",
        }
    }
}

/// Closed runtime trace event kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum TraceEventKind {
    /// Field / path write.
    Write,
    /// Binding evaluation.
    BindingEval,
    /// Structural / DOM patch.
    Patch,
    /// Effect run.
    Effect,
    /// Route navigation.
    Route,
    /// Capability / RPC call.
    Capability,
    /// Generic / unclassified event.
    #[default]
    Event,
    /// Host-level update envelope.
    Update,
}

impl TraceEventKind {
    /// Wire / JSON label (`kebab-case`).
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Write => "write",
            Self::BindingEval => "binding-eval",
            Self::Patch => "patch",
            Self::Effect => "effect",
            Self::Route => "route",
            Self::Capability => "capability",
            Self::Event => "event",
            Self::Update => "update",
        }
    }

    /// Parse kebab-case or legacy snake_case labels.
    pub fn parse(s: &str) -> Option<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "write" => Some(Self::Write),
            "binding_eval" | "binding-eval" => Some(Self::BindingEval),
            "patch" => Some(Self::Patch),
            "effect" => Some(Self::Effect),
            "route" => Some(Self::Route),
            "capability" => Some(Self::Capability),
            "event" => Some(Self::Event),
            "update" => Some(Self::Update),
            _ => None,
        }
    }
}

/// Cross-SFC symbol wire shape; hosts fill index fields when available.
///
/// Surface kind is **not** duplicated: use [`Self::kind`] / [`StableId::kind`]
/// on [`Self::stable_id`] (tagged union), never a parallel `kind` field.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct Symbol {
    /// Always [`SYMBOL_SCHEMA`].
    pub schema: String,
    /// Canonical StableId for this symbol.
    pub stable_id: StableId,
    /// Author-facing display name.
    pub name: String,
    /// Optional defining span when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub span: Option<SourceSpan>,
    /// Owning StableIds (chunk / component / capability).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub owners: Vec<StableId>,
    /// Free-form tags for filters (not a second IR).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
}

impl Symbol {
    /// Closed surface kind from [`Self::stable_id`] (filter helper).
    pub fn kind(&self) -> StableIdKind {
        self.stable_id.kind()
    }

    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// One reference edge to / from a symbol.
///
/// Edge surface kind is derived from [`Self::to`] (prefer matching the target
/// StableId). No parallel `kind` string / enum field on the wire.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct Reference {
    /// Always [`REFERENCE_SCHEMA`].
    pub schema: String,
    /// Source StableId of the edge.
    pub from: StableId,
    /// Target StableId of the edge.
    pub to: StableId,
    /// Optional use-site span when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub span: Option<SourceSpan>,
}

impl Reference {
    /// Closed edge surface kind from [`Self::to`] (filter helper).
    pub fn kind(&self) -> StableIdKind {
        self.to.kind()
    }

    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Causal explain document under the DX schema family.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExplainDocument {
    /// [`EXPLAIN_SCHEMA`] (or [`EXPLAIN_SCHEMA_LEGACY`] when reading old emits).
    pub schema: String,
    /// Explain query target (StableId string or host-specific key).
    pub target: String,
    /// Explain flavor (closed unit enum).
    pub kind: ExplainKind,
    /// Optional owning chunk when the target is chunk-scoped.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chunk_id: Option<String>,
    /// Optional deployment-unit summary for the explained chunk.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deployment_unit: Option<ExplainDeploymentUnit>,
    /// Optional program-graph summary for the explained unit.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub program: Option<ExplainProgramRef>,
    /// Optional primary edge / selector payload.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub edge: Option<ExplainEdgeRef>,
    /// Session generation that produced this explain (stale detection).
    pub session_generation: u64,
    /// Ordered contribution rows from the plugin / session store.
    #[serde(default)]
    pub contributions: Vec<ExplainContribution>,
    /// Typed causal chain edges when the host expanded them.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub chain: Vec<ExplainEdge>,
    /// Optional human notes for DevTools / CLI.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

/// Deployment unit slice attached to an [`ExplainDocument`].
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExplainDeploymentUnit {
    /// Chunk id when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chunk_id: Option<String>,
    /// Closed module kind when known (`app` | `page` | `component` | `other`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<crate::VmzModuleKind>,
    /// Workspace-relative source path.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

/// Program-graph summary attached to an [`ExplainDocument`].
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExplainProgramRef {
    /// Program path or unit name (workspace-relative `/` separators when a path).
    pub path: String,
    /// Edge count when known (write explains).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edge_count: Option<u64>,
    /// Binding id when explaining an update binding.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub binding_id: Option<String>,
}

/// Primary edge / selector attached to an [`ExplainDocument`].
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExplainEdgeRef {
    /// Selector string (e.g. `binding:3`).
    pub selector: String,
}

/// One contribution row listed on an [`ExplainDocument`].
///
/// `stage` / `kind` are **closed** wire enums (not free-form strings).
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExplainContribution {
    /// Contribution store key (`plugin@version::item_id`) or host id.
    pub id: String,
    /// Plugin package / id.
    pub plugin: String,
    /// Plugin version string.
    pub version: String,
    /// Closed plugin stage that accepted the item.
    pub stage: crate::PluginStage,
    /// Closed contribution surface.
    pub kind: crate::ExplainContributionSurface,
    /// Item id within the plugin.
    pub item_id: String,
    /// Optional workspace-relative path (source / analyzer).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// Host-declared cache key for the batch.
    pub cache_key: String,
}

/// One typed edge in an [`ExplainDocument`] causal chain.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct ExplainEdge {
    /// Upstream StableId.
    pub from: StableId,
    /// Downstream StableId.
    pub to: StableId,
    /// Why this edge exists (compiler / runtime reason code).
    pub reason: String,
    /// Optional precision tag (`exact`, `approx`, ...).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub precision: Option<String>,
    /// Optional span supporting the reason.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub span: Option<SourceSpan>,
}

impl ExplainDocument {
    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Workspace edit plan; hosts apply edits only when status is `ready`.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEditPlan {
    /// Always [`WORKSPACE_EDIT_SCHEMA`].
    pub schema: String,
    /// Preconditions the host must verify before apply.
    #[serde(default)]
    pub preconditions: Vec<String>,
    /// Ordered text edits (atomic as a batch when applied).
    #[serde(default)]
    pub edits: Vec<TextEdit>,
    /// Program StableIds touched by this plan.
    #[serde(default)]
    pub affected_program_ids: Vec<StableId>,
    /// Blocking or advisory diagnostics from planning.
    #[serde(default)]
    pub diagnostics: Vec<ReportedDiagnostic>,
    /// Closed plan status.
    pub status: WorkspaceEditStatus,
}

/// One UTF-8 byte-range replacement inside a workspace file.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TextEdit {
    /// Workspace-relative path to edit.
    pub path: String,
    /// Inclusive byte offset start.
    pub start: u32,
    /// Exclusive byte offset end.
    pub end: u32,
    /// Replacement text (`newText` on the wire).
    pub new_text: String,
}

impl WorkspaceEditPlan {
    /// Empty `preview` plan with no edits (safe default for dry-run).
    pub fn empty_preview() -> Self {
        Self {
            schema: WORKSPACE_EDIT_SCHEMA.into(),
            preconditions: vec![],
            edits: vec![],
            affected_program_ids: vec![],
            diagnostics: vec![],
            status: WorkspaceEditStatus::Preview,
        }
    }

    /// `rejected` plan carrying a single error diagnostic.
    pub fn rejected(message: impl Into<String>, code: impl Into<String>) -> Self {
        Self {
            schema: WORKSPACE_EDIT_SCHEMA.into(),
            preconditions: vec![],
            edits: vec![],
            affected_program_ids: vec![],
            diagnostics: vec![ReportedDiagnostic::coded_error("", message, code.into())],
            status: WorkspaceEditStatus::Rejected,
        }
    }

    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Code action proposal; execution stays host-side after safe-fix.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct CodeAction {
    /// Always [`CODE_ACTION_SCHEMA`].
    pub schema: String,
    /// Short title for lightbulb / CLI menus.
    pub title: String,
    /// Action kind (closed unit enum).
    pub kind: CodeActionKind,
    /// Diagnostic code this action addresses, when applicable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostic_code: Option<String>,
    /// Optional edit plan to apply when the user accepts.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub edit: Option<WorkspaceEditPlan>,
}

impl CodeAction {
    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Affected rebuild plan under the DX schema family.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AffectedDocument {
    /// Always [`AFFECTED_SCHEMA`].
    pub schema: String,
    /// When true, host must treat the rebuild as whole-program.
    pub full: bool,
    /// Runtime graph must be rebuilt.
    pub rebuild_runtime: bool,
    /// Server tree must be rebuilt.
    pub rebuild_server_tree: bool,
    /// Units that must participate in the rebuild.
    pub units: Vec<AffectedUnitDoc>,
    /// Seed chunk ids that rooted the fan-out.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub seed_chunks: Vec<String>,
    /// When true, only island regions need refresh.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub island_only: bool,
}

/// One rebuild unit inside an [`AffectedDocument`].
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AffectedUnitDoc {
    /// Source path or module key that changed.
    pub source: String,
    /// Closed module kind (`app` | `page` | `component` | `other`).
    pub kind: crate::VmzModuleKind,
    /// Chunk id to rebuild or invalidate.
    pub chunk_id: String,
}

impl AffectedDocument {
    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Rename intent input to `plan_rename` (edit apply is a separate step).
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct RenameIntent {
    /// Always [`RENAME_SCHEMA`].
    pub schema: String,
    /// Closed rename target kind (`route-id` | `field` | `method` | `component` | `capability`).
    pub kind: StableIdKind,
    /// Current name / id to rename from.
    pub from: String,
    /// Desired name / id to rename to.
    pub to: String,
    /// Optional chunk / application / file scope.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
}

impl RenameIntent {
    /// Build a rename intent with catalog schema and no scope.
    pub fn new(kind: StableIdKind, from: impl Into<String>, to: impl Into<String>) -> Self {
        Self { schema: RENAME_SCHEMA.into(), kind, from: from.into(), to: to.into(), scope: None }
    }

    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Graph-selected tests for an affected rebuild (`vmz test --affected`).
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TestSelectionDocument {
    /// Always [`TEST_SELECTION_SCHEMA`].
    pub schema: String,
    /// Human-readable why these tests were selected.
    pub reason: String,
    /// Selected test ids (host runner keys).
    #[serde(default)]
    pub test_ids: Vec<String>,
    /// Chunk ids that drove selection.
    #[serde(default)]
    pub affected_chunk_ids: Vec<String>,
    /// Optional manifest files consulted during selection.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub manifest_files: Vec<String>,
    /// Closed selection status.
    pub status: DxPreviewStatus,
}

impl TestSelectionDocument {
    /// Empty selection with status `empty` and a reason string.
    pub fn empty(reason: impl Into<String>) -> Self {
        Self {
            schema: TEST_SELECTION_SCHEMA.into(),
            reason: reason.into(),
            test_ids: vec![],
            affected_chunk_ids: vec![],
            manifest_files: vec![],
            status: DxPreviewStatus::Empty,
        }
    }

    /// Preview selection for the given chunks and test ids.
    pub fn preview(
        reason: impl Into<String>,
        affected_chunk_ids: Vec<String>,
        test_ids: Vec<String>,
    ) -> Self {
        Self {
            schema: TEST_SELECTION_SCHEMA.into(),
            reason: reason.into(),
            test_ids,
            affected_chunk_ids,
            manifest_files: vec![],
            status: DxPreviewStatus::Preview,
        }
    }

    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Map a bare rename-kind label to a planning-supported [`StableIdKind`].
///
/// Delegates vocabulary to [`StableIdKind::parse`] (serde), then filters with
/// [`is_rename_kind`].
pub fn normalize_rename_kind(kind: &str) -> Option<StableIdKind> {
    is_rename_kind(StableIdKind::parse(kind)?)
}

/// Keep only StableId kinds that rename planning supports.
pub fn is_rename_kind(kind: StableIdKind) -> Option<StableIdKind> {
    match kind {
        k @ (StableIdKind::RouteId
        | StableIdKind::Field
        | StableIdKind::Method
        | StableIdKind::Component
        | StableIdKind::Capability) => Some(k),
        _ => None,
    }
}

/// Semantic transaction lifecycle status (closed).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum SemanticTransactionStatus {
    /// Transaction opened, edits not committed.
    Open,
    /// Edits applied atomically.
    Committed,
    /// Edits rolled back.
    RolledBack,
    /// Open/commit rejected.
    Rejected,
}

impl SemanticTransactionStatus {
    /// Wire / JSON label (`kebab-case`).
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Committed => "committed",
            Self::RolledBack => "rolled-back",
            Self::Rejected => "rejected",
        }
    }
}

/// Cancel ticket status (closed).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum CancelStatus {
    /// Work still running.
    Running,
    /// Host cancelled the ticket.
    Cancelled,
    /// Work finished normally.
    Completed,
    /// Replaced by a newer ticket.
    Superseded,
}

impl CancelStatus {
    /// Wire / JSON label (`kebab-case`).
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Cancelled => "cancelled",
            Self::Completed => "completed",
            Self::Superseded => "superseded",
        }
    }

    /// Parse kebab-case labels.
    pub fn parse(s: &str) -> Option<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "running" => Some(Self::Running),
            "cancelled" | "canceled" => Some(Self::Cancelled),
            "completed" => Some(Self::Completed),
            "superseded" => Some(Self::Superseded),
            _ => None,
        }
    }
}

/// Semantic transaction document (atomic TextEdit batch lifecycle).
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SemanticTransactionDocument {
    /// Always [`SEMANTIC_TRANSACTION_SCHEMA`].
    pub schema: String,
    /// Host-assigned transaction id.
    pub id: u64,
    /// Closed transaction status.
    pub status: SemanticTransactionStatus,
    /// Edits staged in this transaction.
    #[serde(default)]
    pub edits: Vec<TextEdit>,
    /// Diagnostics produced while opening / committing.
    #[serde(default)]
    pub diagnostics: Vec<ReportedDiagnostic>,
    /// Paths marked dirty by the transaction.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub dirty_paths: Vec<String>,
}

impl SemanticTransactionDocument {
    /// Open an empty transaction with the given id.
    pub fn open(id: u64) -> Self {
        Self {
            schema: SEMANTIC_TRANSACTION_SCHEMA.into(),
            id,
            status: SemanticTransactionStatus::Open,
            edits: vec![],
            diagnostics: vec![],
            dirty_paths: vec![],
        }
    }

    /// Rejected transaction carrying a single error diagnostic.
    pub fn rejected(id: u64, message: impl Into<String>, code: impl Into<String>) -> Self {
        Self {
            schema: SEMANTIC_TRANSACTION_SCHEMA.into(),
            id,
            status: SemanticTransactionStatus::Rejected,
            edits: vec![],
            diagnostics: vec![ReportedDiagnostic::coded_error("", message, code.into())],
            dirty_paths: vec![],
        }
    }

    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Analysis/build cancel ticket shared by CLI and long-running hosts.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CancelDocument {
    /// Always [`CANCEL_SCHEMA`].
    pub schema: String,
    /// Ticket id the host polls / cancels.
    pub ticket_id: u64,
    /// Closed ticket status.
    pub status: CancelStatus,
    /// Session generation tied to this ticket.
    #[serde(default)]
    pub session_generation: u64,
    /// Optional human notes (why cancelled / superseded).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

impl CancelDocument {
    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Affected preview document status (closed).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum AffectedPreviewStatus {
    /// Fresh preview for the current dirty set.
    Preview,
    /// Fully materialized preview.
    Ready,
    /// Session generation moved; preview is stale.
    Stale,
}

impl AffectedPreviewStatus {
    /// Wire / JSON label (`kebab-case`).
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Preview => "preview",
            Self::Ready => "ready",
            Self::Stale => "stale",
        }
    }
}

/// HMR replace mode (closed).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum HmrMode {
    /// Island-only hot replace.
    Island,
    /// Partial chunk replace.
    Partial,
    /// Full runtime rebuild.
    Full,
}

impl HmrMode {
    /// Wire / JSON label (`kebab-case`).
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Island => "island",
            Self::Partial => "partial",
            Self::Full => "full",
        }
    }
}

/// HMR plan status (closed).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum HmrPlanStatus {
    /// Advisory plan.
    Preview,
    /// Ready for host apply.
    Ready,
}

impl HmrPlanStatus {
    /// Wire / JSON label (`kebab-case`).
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Preview => "preview",
            Self::Ready => "ready",
        }
    }
}

/// Affected preview composing chunk plan + tests + routes + regions.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AffectedPreviewDocument {
    /// Always [`AFFECTED_PREVIEW_SCHEMA`].
    pub schema: String,
    /// Core affected rebuild plan.
    pub affected: AffectedDocument,
    /// Tests selected for the same change set.
    pub test_selection: TestSelectionDocument,
    /// Route ids impacted by the change.
    #[serde(default)]
    pub route_ids: Vec<String>,
    /// Region ids impacted by the change.
    #[serde(default)]
    pub region_ids: Vec<u32>,
    /// Closed preview status.
    pub status: AffectedPreviewStatus,
}

impl AffectedPreviewDocument {
    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// HMR plan queried before soft-reload.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HmrPlanDocument {
    /// Always [`HMR_PLAN_SCHEMA`].
    pub schema: String,
    /// Closed HMR mode.
    pub mode: HmrMode,
    /// When true, only island regions update.
    pub island_only: bool,
    /// Seed chunks that rooted the HMR fan-out.
    #[serde(default)]
    pub seed_chunks: Vec<String>,
    /// All chunks that must hot-replace.
    #[serde(default)]
    pub affected_chunks: Vec<String>,
    /// Region ids that keep live state across reload.
    #[serde(default)]
    pub preserved_regions: Vec<u32>,
    /// Region ids that must dispose and remount.
    #[serde(default)]
    pub disposed_regions: Vec<u32>,
    /// Loader ids that must re-run after replace.
    #[serde(default)]
    pub rerun_loaders: Vec<String>,
    /// Closed plan status.
    pub status: HmrPlanStatus,
}

impl HmrPlanDocument {
    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Route/chunk budget (v0: algebraic unitCost, not byte enforcement).
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct BudgetDocument {
    /// Always [`BUDGET_SCHEMA`].
    pub schema: String,
    /// Per-route cost rows.
    pub routes: Vec<BudgetRouteEntry>,
    /// Per-chunk cost rows.
    pub chunks: Vec<BudgetChunkEntry>,
    /// Closed budget status.
    pub status: DxPreviewStatus,
}

/// One route row in a [`BudgetDocument`].
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BudgetRouteEntry {
    /// Route id being costed.
    pub route_id: String,
    /// Chunk ids attributed to this route.
    #[serde(default)]
    pub chunk_ids: Vec<String>,
    /// Algebraic unit cost for the route closure.
    #[serde(default)]
    pub unit_cost: u32,
}

/// One chunk row in a [`BudgetDocument`].
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BudgetChunkEntry {
    /// Chunk id being costed.
    pub chunk_id: String,
    /// Closed module / unit kind (same family as deployment units).
    pub kind: crate::VmzModuleKind,
    /// Chunk ids this chunk depends on.
    #[serde(default)]
    pub depends_on: Vec<String>,
    /// Algebraic unit cost for this chunk alone.
    #[serde(default)]
    pub unit_cost: u32,
}

impl BudgetDocument {
    /// Empty budget document with status `empty`.
    pub fn empty() -> Self {
        Self {
            schema: BUDGET_SCHEMA.into(),
            routes: vec![],
            chunks: vec![],
            status: DxPreviewStatus::Empty,
        }
    }

    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Umbrella check report for affected preview + HMR + budget.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TransactionCheckReport {
    /// Always [`TRANSACTION_CHECK_SCHEMA`].
    pub schema: String,
    /// Optional affected preview sample.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub affected_preview: Option<AffectedPreviewDocument>,
    /// Optional HMR plan sample.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hmr_plan: Option<HmrPlanDocument>,
    /// Optional budget sample.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub budget: Option<BudgetDocument>,
    /// Check diagnostics.
    #[serde(default)]
    pub diagnostics: Vec<ReportedDiagnostic>,
    /// Closed umbrella status.
    pub status: TransactionCheckStatus,
}

impl TransactionCheckReport {
    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Runtime trace event tagged with a StableId.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TraceEvent {
    /// Event kind (closed unit enum; missing/empty wire → [`TraceEventKind::Event`]).
    #[serde(default)]
    pub kind: TraceEventKind,
    /// StableId this event is about.
    pub stable_id: StableId,
    /// Optional dependency key / edge label.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dep: Option<String>,
    /// Optional monotonic timestamp (host clock units).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub t: Option<u64>,
    /// Optional chunk id when the event is chunk-scoped.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chunk_id: Option<String>,
}

/// Ordered runtime / synthetic trace document.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq, Eq)]
pub struct TraceDocument {
    /// Always [`TRACE_SCHEMA`].
    pub schema: String,
    /// Events in occurrence order.
    #[serde(default)]
    pub events: Vec<TraceEvent>,
    /// Closed trace status.
    pub status: TraceStatus,
    /// Optional notes (why empty / invalid).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

impl TraceDocument {
    /// Empty trace with status `empty` and notes.
    pub fn empty(notes: impl Into<String>) -> Self {
        Self {
            schema: TRACE_SCHEMA.into(),
            events: vec![],
            status: TraceStatus::Empty,
            notes: Some(notes.into()),
        }
    }

    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// One joined event / explain result.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CausalReplayMatch {
    /// Index into the source [`TraceDocument::events`].
    pub event_index: u32,
    /// StableId taken from that event.
    pub stable_id: StableId,
    /// Event StableId appears in the explain chain.
    pub in_chain: bool,
    /// Optional explain document used for the join.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub explain: Option<ExplainDocument>,
}

/// Causal replay joining trace events to `vmz.dx.explain.v0` chains.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct CausalReplayDocument {
    /// Always [`CAUSAL_REPLAY_SCHEMA`].
    pub schema: String,
    /// Trace that was replayed.
    pub trace: TraceDocument,
    /// Per-event join results.
    #[serde(default)]
    pub matches: Vec<CausalReplayMatch>,
    /// Closed replay status.
    pub status: CausalReplayStatus,
    /// Optional notes (failure reason / empty cause).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

impl CausalReplayDocument {
    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Umbrella check for explain + causal replay samples.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema, PartialEq)]
pub struct CausalReplayCheckReport {
    /// Always [`CAUSAL_REPLAY_CHECK_SCHEMA`].
    pub schema: String,
    /// Optional sample explain document.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sample_explain: Option<ExplainDocument>,
    /// Optional sample replay document.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sample_replay: Option<CausalReplayDocument>,
    /// Check diagnostics.
    #[serde(default)]
    pub diagnostics: Vec<ReportedDiagnostic>,
    /// Closed check status.
    pub status: CausalReplayCheckStatus,
}

impl CausalReplayCheckReport {
    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}
