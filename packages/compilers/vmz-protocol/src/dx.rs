//! Unified DX query protocol.
//!
//! CLI / LSP / MCP / DevTools share these schema ids and StableId shapes for
//! Symbol, Reference, Explain, WorkspaceEdit, CodeAction, Affected, Rename,
//! TestSelection, HMR, budgets, causal replay, and related check documents.
//! RenameIntent plus Symbol/Reference-proven WorkspaceEdit describe apply plans;
//! hosts execute edits outside this crate.

use serde::{Deserialize, Serialize};

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
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DxCatalog {
    /// Always [`DX_PROTOCOL`].
    pub schema: String,
    /// Same as `schema` (parity with other domain catalogs).
    pub protocol: String,
    /// Document kinds this generation publishes.
    pub documents: Vec<DxDocumentKind>,
}

/// One document kind entry inside [`DxCatalog`].
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DxDocumentKind {
    /// Kind id (`symbol`, `explain`, `hmr_plan`, ...).
    pub kind: String,
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
                DxDocumentKind { kind: "symbol".into(), schema: SYMBOL_SCHEMA.into() },
                DxDocumentKind { kind: "reference".into(), schema: REFERENCE_SCHEMA.into() },
                DxDocumentKind { kind: "explain".into(), schema: EXPLAIN_SCHEMA.into() },
                DxDocumentKind {
                    kind: "workspace_edit".into(),
                    schema: WORKSPACE_EDIT_SCHEMA.into(),
                },
                DxDocumentKind { kind: "code_action".into(), schema: CODE_ACTION_SCHEMA.into() },
                DxDocumentKind { kind: "affected".into(), schema: AFFECTED_SCHEMA.into() },
                DxDocumentKind { kind: "rename".into(), schema: RENAME_SCHEMA.into() },
                DxDocumentKind {
                    kind: "test_selection".into(),
                    schema: TEST_SELECTION_SCHEMA.into(),
                },
                DxDocumentKind { kind: "source_map".into(), schema: SOURCE_MAP_SCHEMA.into() },
                DxDocumentKind { kind: "symbol_index".into(), schema: SYMBOL_INDEX_SCHEMA.into() },
                DxDocumentKind {
                    kind: "cross_sfc_check".into(),
                    schema: CROSS_SFC_CHECK_SCHEMA.into(),
                },
                DxDocumentKind {
                    kind: "semantic_transaction".into(),
                    schema: SEMANTIC_TRANSACTION_SCHEMA.into(),
                },
                DxDocumentKind { kind: "cancel".into(), schema: CANCEL_SCHEMA.into() },
                DxDocumentKind {
                    kind: "affected_preview".into(),
                    schema: AFFECTED_PREVIEW_SCHEMA.into(),
                },
                DxDocumentKind { kind: "hmr_plan".into(), schema: HMR_PLAN_SCHEMA.into() },
                DxDocumentKind { kind: "budget".into(), schema: BUDGET_SCHEMA.into() },
                DxDocumentKind {
                    kind: "transaction_check".into(),
                    schema: TRANSACTION_CHECK_SCHEMA.into(),
                },
                DxDocumentKind {
                    kind: "boundary_validator".into(),
                    schema: BOUNDARY_VALIDATOR_SCHEMA.into(),
                },
                DxDocumentKind { kind: "leakage".into(), schema: LEAKAGE_SCHEMA.into() },
                DxDocumentKind {
                    kind: "capability_target".into(),
                    schema: CAPABILITY_TARGET_SCHEMA.into(),
                },
                DxDocumentKind { kind: "dead_graph".into(), schema: DEAD_GRAPH_SCHEMA.into() },
                DxDocumentKind {
                    kind: "deployment_proof_check".into(),
                    schema: DEPLOYMENT_PROOF_CHECK_SCHEMA.into(),
                },
                DxDocumentKind { kind: "trace".into(), schema: TRACE_SCHEMA.into() },
                DxDocumentKind {
                    kind: "causal_replay".into(),
                    schema: CAUSAL_REPLAY_SCHEMA.into(),
                },
                DxDocumentKind {
                    kind: "causal_replay_check".into(),
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

/// Source location shared across DX documents (oxc Span as offsets; path is workspace-relative).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SourceSpan {
    /// Workspace-relative file path.
    pub path: String,
    /// Inclusive byte offset start (oxc Span).
    pub start: u32,
    /// Exclusive byte offset end (oxc Span).
    pub end: u32,
}

/// Stable program identity (BindingId / EffectId / RouteId / CapabilityId / ...).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StableId {
    /// Identity family (`binding`, `effect`, `route`, `capability`, ...).
    pub kind: String,
    /// Opaque id string within that family.
    pub id: String,
}

/// Cross-SFC symbol wire shape; hosts fill index fields when available.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Symbol {
    /// Always [`SYMBOL_SCHEMA`].
    pub schema: String,
    /// Canonical StableId for this symbol.
    pub stable_id: StableId,
    /// Author-facing display name.
    pub name: String,
    /// Symbol kind (`field`, `method`, `component`, `route_id`, ...).
    pub kind: String,
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
    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// One reference edge to / from a symbol.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Reference {
    /// Always [`REFERENCE_SCHEMA`].
    pub schema: String,
    /// Source StableId of the edge.
    pub from: StableId,
    /// Target StableId of the edge.
    pub to: StableId,
    /// Edge kind (`read`, `write`, `call`, `import`, ...).
    pub kind: String,
    /// Optional use-site span when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub span: Option<SourceSpan>,
}

impl Reference {
    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Causal explain document under the DX schema family.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ExplainDocument {
    /// [`EXPLAIN_SCHEMA`] (or [`EXPLAIN_SCHEMA_LEGACY`] when reading old emits).
    pub schema: String,
    /// Explain query target (StableId string or host-specific key).
    pub target: String,
    /// Explain flavor (`binding`, `effect`, `route`, `chunk`, ...).
    pub kind: String,
    /// Optional owning chunk when the target is chunk-scoped.
    #[serde(rename = "chunkId", skip_serializing_if = "Option::is_none")]
    pub chunk_id: Option<String>,
    /// Optional deployment-unit payload (host-shaped JSON).
    #[serde(rename = "deploymentUnit", skip_serializing_if = "Option::is_none")]
    pub deployment_unit: Option<serde_json::Value>,
    /// Optional program-graph slice (host-shaped JSON).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub program: Option<serde_json::Value>,
    /// Optional primary edge payload when not expanded into `chain`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub edge: Option<serde_json::Value>,
    /// Session generation that produced this explain (stale detection).
    #[serde(rename = "sessionGeneration")]
    pub session_generation: u64,
    /// Ordered contribution payloads (host-shaped JSON rows).
    #[serde(default)]
    pub contributions: Vec<serde_json::Value>,
    /// Typed causal chain edges when the host expanded them.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub chain: Vec<ExplainEdge>,
    /// Optional human notes for DevTools / CLI.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

/// One typed edge in an [`ExplainDocument`] causal chain.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
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
    #[serde(rename = "affectedProgramIds", default)]
    pub affected_program_ids: Vec<StableId>,
    /// Blocking or advisory diagnostics from planning.
    #[serde(default)]
    pub diagnostics: Vec<DxDiagnostic>,
    /// `preview` | `ready` | `rejected`
    pub status: String,
}

/// One UTF-8 byte-range replacement inside a workspace file.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TextEdit {
    /// Workspace-relative path to edit.
    pub path: String,
    /// Inclusive byte offset start.
    pub start: u32,
    /// Exclusive byte offset end.
    pub end: u32,
    /// Replacement text (`newText` on the wire).
    #[serde(rename = "newText")]
    pub new_text: String,
}

/// DX-facing diagnostic row carried on plans and check reports.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DxDiagnostic {
    /// Workspace-relative path (empty when workspace-global).
    pub path: String,
    /// `error` | `warning` | `info` (host maps to UI severity).
    pub severity: String,
    /// Human message for CLI / LSP.
    pub message: String,
    /// Optional stable diagnostic code.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    /// Optional supporting span.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub span: Option<SourceSpan>,
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
            status: "preview".into(),
        }
    }

    /// `rejected` plan carrying a single error diagnostic.
    pub fn rejected(message: impl Into<String>, code: impl Into<String>) -> Self {
        Self {
            schema: WORKSPACE_EDIT_SCHEMA.into(),
            preconditions: vec![],
            edits: vec![],
            affected_program_ids: vec![],
            diagnostics: vec![DxDiagnostic {
                path: String::new(),
                severity: "error".into(),
                message: message.into(),
                code: Some(code.into()),
                span: None,
            }],
            status: "rejected".into(),
        }
    }

    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Code action proposal; execution stays host-side after safe-fix.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CodeAction {
    /// Always [`CODE_ACTION_SCHEMA`].
    pub schema: String,
    /// Short title for lightbulb / CLI menus.
    pub title: String,
    /// `safe_fix` | `migration` | `design_choice`
    pub kind: String,
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
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AffectedDocument {
    /// Always [`AFFECTED_SCHEMA`].
    pub schema: String,
    /// When true, host must treat the rebuild as whole-program.
    pub full: bool,
    /// Runtime graph must be rebuilt.
    #[serde(rename = "rebuildRuntime")]
    pub rebuild_runtime: bool,
    /// Server tree must be rebuilt.
    #[serde(rename = "rebuildServerTree")]
    pub rebuild_server_tree: bool,
    /// Units that must participate in the rebuild.
    pub units: Vec<AffectedUnitDoc>,
    /// Seed chunk ids that rooted the fan-out.
    #[serde(rename = "seedChunks", default, skip_serializing_if = "Vec::is_empty")]
    pub seed_chunks: Vec<String>,
    /// When true, only island regions need refresh.
    #[serde(rename = "islandOnly", default, skip_serializing_if = "std::ops::Not::not")]
    pub island_only: bool,
}

/// One rebuild unit inside an [`AffectedDocument`].
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AffectedUnitDoc {
    /// Source path or module key that changed.
    pub source: String,
    /// Unit kind (`chunk`, `server`, `locale`, ...).
    pub kind: String,
    /// Chunk id to rebuild or invalidate.
    #[serde(rename = "chunkId")]
    pub chunk_id: String,
}

impl AffectedDocument {
    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Rename intent input to `plan_rename` (edit apply is a separate step).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RenameIntent {
    /// Always [`RENAME_SCHEMA`].
    pub schema: String,
    /// `route_id` | `field` | `method` | `component` | `capability`
    pub kind: String,
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
    pub fn new(kind: impl Into<String>, from: impl Into<String>, to: impl Into<String>) -> Self {
        Self {
            schema: RENAME_SCHEMA.into(),
            kind: kind.into(),
            from: from.into(),
            to: to.into(),
            scope: None,
        }
    }

    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Graph-selected tests for an affected rebuild (`vmz test --affected`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TestSelectionDocument {
    /// Always [`TEST_SELECTION_SCHEMA`].
    pub schema: String,
    /// Human-readable why these tests were selected.
    pub reason: String,
    /// Selected test ids (host runner keys).
    #[serde(rename = "testIds", default)]
    pub test_ids: Vec<String>,
    /// Chunk ids that drove selection.
    #[serde(rename = "affectedChunkIds", default)]
    pub affected_chunk_ids: Vec<String>,
    /// Optional manifest files consulted during selection.
    #[serde(rename = "manifestFiles", default, skip_serializing_if = "Vec::is_empty")]
    pub manifest_files: Vec<String>,
    /// `preview` | `ready` | `empty`
    pub status: String,
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
            status: "empty".into(),
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
            status: "preview".into(),
        }
    }

    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Normalize CLI / LSP rename kind aliases to catalog kinds.
pub fn normalize_rename_kind(kind: &str) -> Option<&'static str> {
    match kind.trim().to_ascii_lowercase().as_str() {
        "route" | "route_id" | "routeid" | "route-id" => Some("route_id"),
        "field" | "prop" | "state" => Some("field"),
        "method" => Some("method"),
        "component" | "class" => Some("component"),
        "capability" | "server" => Some("capability"),
        _ => None,
    }
}

/// Semantic transaction document (atomic TextEdit batch lifecycle).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SemanticTransactionDocument {
    /// Always [`SEMANTIC_TRANSACTION_SCHEMA`].
    pub schema: String,
    /// Host-assigned transaction id.
    pub id: u64,
    /// `open` | `committed` | `rolled_back` | `rejected`
    pub status: String,
    /// Edits staged in this transaction.
    #[serde(default)]
    pub edits: Vec<TextEdit>,
    /// Diagnostics produced while opening / committing.
    #[serde(default)]
    pub diagnostics: Vec<DxDiagnostic>,
    /// Paths marked dirty by the transaction.
    #[serde(rename = "dirtyPaths", default, skip_serializing_if = "Vec::is_empty")]
    pub dirty_paths: Vec<String>,
}

impl SemanticTransactionDocument {
    /// Open an empty transaction with the given id.
    pub fn open(id: u64) -> Self {
        Self {
            schema: SEMANTIC_TRANSACTION_SCHEMA.into(),
            id,
            status: "open".into(),
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
            status: "rejected".into(),
            edits: vec![],
            diagnostics: vec![DxDiagnostic {
                path: String::new(),
                severity: "error".into(),
                message: message.into(),
                code: Some(code.into()),
                span: None,
            }],
            dirty_paths: vec![],
        }
    }

    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Analysis/build cancel ticket shared by CLI and long-running hosts.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CancelDocument {
    /// Always [`CANCEL_SCHEMA`].
    pub schema: String,
    /// Ticket id the host polls / cancels.
    #[serde(rename = "ticketId")]
    pub ticket_id: u64,
    /// `running` | `cancelled` | `completed` | `superseded`
    pub status: String,
    /// Session generation tied to this ticket.
    #[serde(rename = "sessionGeneration", default)]
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

/// Affected preview composing chunk plan + tests + routes + regions.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AffectedPreviewDocument {
    /// Always [`AFFECTED_PREVIEW_SCHEMA`].
    pub schema: String,
    /// Core affected rebuild plan.
    pub affected: AffectedDocument,
    /// Tests selected for the same change set.
    #[serde(rename = "testSelection")]
    pub test_selection: TestSelectionDocument,
    /// Route ids impacted by the change.
    #[serde(rename = "routeIds", default)]
    pub route_ids: Vec<String>,
    /// Region ids impacted by the change.
    #[serde(rename = "regionIds", default)]
    pub region_ids: Vec<u32>,
    /// `preview` | `ready` | `stale`
    pub status: String,
}

impl AffectedPreviewDocument {
    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// HMR plan queried before soft-reload.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HmrPlanDocument {
    /// Always [`HMR_PLAN_SCHEMA`].
    pub schema: String,
    /// `island` | `partial` | `full`
    pub mode: String,
    /// When true, only island regions update.
    #[serde(rename = "islandOnly")]
    pub island_only: bool,
    /// Seed chunks that rooted the HMR fan-out.
    #[serde(rename = "seedChunks", default)]
    pub seed_chunks: Vec<String>,
    /// All chunks that must hot-replace.
    #[serde(rename = "affectedChunks", default)]
    pub affected_chunks: Vec<String>,
    /// Region ids that keep live state across reload.
    #[serde(rename = "preservedRegions", default)]
    pub preserved_regions: Vec<u32>,
    /// Region ids that must dispose and remount.
    #[serde(rename = "disposedRegions", default)]
    pub disposed_regions: Vec<u32>,
    /// Loader ids that must re-run after replace.
    #[serde(rename = "rerunLoaders", default)]
    pub rerun_loaders: Vec<String>,
    /// `preview` | `ready`
    pub status: String,
}

impl HmrPlanDocument {
    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Route/chunk budget (v0: algebraic unitCost, not byte enforcement).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BudgetDocument {
    /// Always [`BUDGET_SCHEMA`].
    pub schema: String,
    /// Per-route cost rows.
    pub routes: Vec<BudgetRouteEntry>,
    /// Per-chunk cost rows.
    pub chunks: Vec<BudgetChunkEntry>,
    /// `preview` | `ready` | `empty`
    pub status: String,
}

/// One route row in a [`BudgetDocument`].
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BudgetRouteEntry {
    /// Route id being costed.
    #[serde(rename = "routeId")]
    pub route_id: String,
    /// Chunk ids attributed to this route.
    #[serde(rename = "chunkIds", default)]
    pub chunk_ids: Vec<String>,
    /// Algebraic unit cost for the route closure.
    #[serde(rename = "unitCost", default)]
    pub unit_cost: u32,
}

/// One chunk row in a [`BudgetDocument`].
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BudgetChunkEntry {
    /// Chunk id being costed.
    #[serde(rename = "chunkId")]
    pub chunk_id: String,
    /// Chunk kind (`entry`, `async`, `shared`, ...).
    pub kind: String,
    /// Chunk ids this chunk depends on.
    #[serde(rename = "dependsOn", default)]
    pub depends_on: Vec<String>,
    /// Algebraic unit cost for this chunk alone.
    #[serde(rename = "unitCost", default)]
    pub unit_cost: u32,
}

impl BudgetDocument {
    /// Empty budget document with status `empty`.
    pub fn empty() -> Self {
        Self {
            schema: BUDGET_SCHEMA.into(),
            routes: vec![],
            chunks: vec![],
            status: "empty".into(),
        }
    }

    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Umbrella check report for affected preview + HMR + budget.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TransactionCheckReport {
    /// Always [`TRANSACTION_CHECK_SCHEMA`].
    pub schema: String,
    /// Optional affected preview sample.
    #[serde(rename = "affectedPreview", skip_serializing_if = "Option::is_none")]
    pub affected_preview: Option<AffectedPreviewDocument>,
    /// Optional HMR plan sample.
    #[serde(rename = "hmrPlan", skip_serializing_if = "Option::is_none")]
    pub hmr_plan: Option<HmrPlanDocument>,
    /// Optional budget sample.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub budget: Option<BudgetDocument>,
    /// Check diagnostics.
    #[serde(default)]
    pub diagnostics: Vec<DxDiagnostic>,
    /// `ready` | `preview` | `incomplete`
    pub status: String,
}

impl TransactionCheckReport {
    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Runtime trace event tagged with a StableId.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TraceEvent {
    /// `write` | `binding_eval` | `patch` | `effect` | `route` | `capability`
    pub kind: String,
    /// StableId this event is about.
    #[serde(rename = "stableId")]
    pub stable_id: StableId,
    /// Optional dependency key / edge label.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dep: Option<String>,
    /// Optional monotonic timestamp (host clock units).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub t: Option<u64>,
    /// Optional chunk id when the event is chunk-scoped.
    #[serde(rename = "chunkId", default, skip_serializing_if = "Option::is_none")]
    pub chunk_id: Option<String>,
}

/// Ordered runtime / synthetic trace document.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TraceDocument {
    /// Always [`TRACE_SCHEMA`].
    pub schema: String,
    /// Events in occurrence order.
    #[serde(default)]
    pub events: Vec<TraceEvent>,
    /// `ready` | `empty` | `invalid`
    pub status: String,
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
            status: "empty".into(),
            notes: Some(notes.into()),
        }
    }

    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// One joined event / explain result.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CausalReplayMatch {
    /// Index into the source [`TraceDocument::events`].
    #[serde(rename = "eventIndex")]
    pub event_index: u32,
    /// StableId taken from that event.
    #[serde(rename = "stableId")]
    pub stable_id: StableId,
    /// Event StableId appears in the explain chain.
    #[serde(rename = "inChain")]
    pub in_chain: bool,
    /// Optional explain document used for the join.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub explain: Option<ExplainDocument>,
}

/// Causal replay joining trace events to `vmz.dx.explain.v0` chains.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CausalReplayDocument {
    /// Always [`CAUSAL_REPLAY_SCHEMA`].
    pub schema: String,
    /// Trace that was replayed.
    pub trace: TraceDocument,
    /// Per-event join results.
    #[serde(default)]
    pub matches: Vec<CausalReplayMatch>,
    /// `ready` | `failed` | `empty`
    pub status: String,
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
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
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
    pub diagnostics: Vec<DxDiagnostic>,
    /// `ready` | `preview` | `failed`
    pub status: String,
}

impl CausalReplayCheckReport {
    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}
