//! Unified DX query protocol.
//!
//! CLI / LSP / MCP / DevTools must share these schema ids and stable ID shapes.
//! froze Symbol/Reference/Explain/WorkspaceEdit/CodeAction/Affected.
//! RenameIntent + TestSelection + Symbol/Reference-proven WorkspaceEdit apply.

use serde::{Deserialize, Serialize};

/// Umbrella DX protocol version (catalog / handshake).
pub const DX_PROTOCOL: &str = "vmz.dx.v0";

pub const SYMBOL_SCHEMA: &str = "vmz.dx.symbol.v0";
pub const REFERENCE_SCHEMA: &str = "vmz.dx.reference.v0";
pub const EXPLAIN_SCHEMA: &str = "vmz.dx.explain.v0";
/// Legacy explain id — still recognized; new emits use [`EXPLAIN_SCHEMA`].
pub const EXPLAIN_SCHEMA_LEGACY: &str = "vmz.explain.v0";
pub const WORKSPACE_EDIT_SCHEMA: &str = "vmz.dx.workspace_edit.v0";
pub const CODE_ACTION_SCHEMA: &str = "vmz.dx.code_action.v0";
pub const AFFECTED_SCHEMA: &str = "vmz.dx.affected.v0";
/// rename intent envelope (plans still emit [`WORKSPACE_EDIT_SCHEMA`]).
pub const RENAME_SCHEMA: &str = "vmz.dx.rename.v0";
/// graph-driven test selection (`vmz test --affected` / `--target changed`).
pub const TEST_SELECTION_SCHEMA: &str = "vmz.dx.test_selection.v0";
/// template↔script source map entries.
pub const SOURCE_MAP_SCHEMA: &str = "vmz.dx.source_map.v0";
/// workspace Symbol/Reference index document.
pub const SYMBOL_INDEX_SCHEMA: &str = "vmz.dx.symbol_index.v0";
/// conformance umbrella report.
pub const CROSS_SFC_CHECK_SCHEMA: &str = "vmz.dx.cross_sfc_check.v0";
/// semantic transaction (atomic TextEdit batch).
pub const SEMANTIC_TRANSACTION_SCHEMA: &str = "vmz.dx.semantic_transaction.v0";
/// analysis/build cancel ticket.
pub const CANCEL_SCHEMA: &str = "vmz.dx.cancel.v0";
/// affected preview (chunks + tests + routes + regions).
pub const AFFECTED_PREVIEW_SCHEMA: &str = "vmz.dx.affected_preview.v0";
/// HMR plan.
pub const HMR_PLAN_SCHEMA: &str = "vmz.dx.hmr_plan.v0";
/// route/chunk budget (algebraic unitCost).
pub const BUDGET_SCHEMA: &str = "vmz.dx.budget.v0";
/// conformance umbrella report.
pub const TRANSACTION_CHECK_SCHEMA: &str = "vmz.dx.transaction_check.v0";
/// deployment boundary validators (route / resume / rpc / action).
pub const BOUNDARY_VALIDATOR_SCHEMA: &str = "vmz.dx.boundary_validator.v0";
/// client/server leakage findings.
pub const LEAKAGE_SCHEMA: &str = "vmz.dx.leakage.v0";
/// capability → target mapping.
pub const CAPABILITY_TARGET_SCHEMA: &str = "vmz.dx.capability_target.v0";
/// dead chunk / unreferenced capability report.
pub const DEAD_GRAPH_SCHEMA: &str = "vmz.dx.dead_graph.v0";
/// conformance umbrella report.
pub const DEPLOYMENT_PROOF_CHECK_SCHEMA: &str = "vmz.dx.deployment_proof_check.v0";
/// runtime trace events tagged with StableIds.
pub const TRACE_SCHEMA: &str = "vmz.dx.trace.v0";
/// join of trace events ↔ explain causal chain.
pub const CAUSAL_REPLAY_SCHEMA: &str = "vmz.dx.causal_replay.v0";
/// conformance umbrella report.
pub const CAUSAL_REPLAY_CHECK_SCHEMA: &str = "vmz.dx.causal_replay_check.v0";

/// Catalog of frozen schema ids for host handshake.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DxCatalog {
    pub schema: String,
    pub protocol: String,
    pub documents: Vec<DxDocumentKind>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DxDocumentKind {
    pub kind: String,
    pub schema: String,
}

impl DxCatalog {
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

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Source location shared across DX documents (oxc Span as offsets; path is workspace-relative).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SourceSpan {
    pub path: String,
    pub start: u32,
    pub end: u32,
}

/// Stable program identity (BindingId / EffectId / RouteId / CapabilityId / …).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StableId {
    pub kind: String,
    pub id: String,
}

/// Cross-SFC symbol ( shape; index filled in /).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Symbol {
    pub schema: String,
    pub stable_id: StableId,
    pub name: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub span: Option<SourceSpan>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub owners: Vec<StableId>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
}

impl Symbol {
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// One reference edge to / from a symbol.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Reference {
    pub schema: String,
    pub from: StableId,
    pub to: StableId,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub span: Option<SourceSpan>,
}

impl Reference {
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Causal explain document ( explain upgraded to DX schema).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ExplainDocument {
    pub schema: String,
    pub target: String,
    pub kind: String,
    #[serde(rename = "chunkId", skip_serializing_if = "Option::is_none")]
    pub chunk_id: Option<String>,
    #[serde(rename = "deploymentUnit", skip_serializing_if = "Option::is_none")]
    pub deployment_unit: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub program: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub edge: Option<serde_json::Value>,
    #[serde(rename = "sessionGeneration")]
    pub session_generation: u64,
    #[serde(default)]
    pub contributions: Vec<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub chain: Vec<ExplainEdge>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ExplainEdge {
    pub from: StableId,
    pub to: StableId,
    pub reason: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub precision: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub span: Option<SourceSpan>,
}

impl ExplainDocument {
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Workspace edit plan (apply deferred to +).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspaceEditPlan {
    pub schema: String,
    #[serde(default)]
    pub preconditions: Vec<String>,
    #[serde(default)]
    pub edits: Vec<TextEdit>,
    #[serde(rename = "affectedProgramIds", default)]
    pub affected_program_ids: Vec<StableId>,
    #[serde(default)]
    pub diagnostics: Vec<DxDiagnostic>,
    /// `preview` | `ready` | `rejected`
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TextEdit {
    pub path: String,
    pub start: u32,
    pub end: u32,
    #[serde(rename = "newText")]
    pub new_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DxDiagnostic {
    pub path: String,
    pub severity: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub span: Option<SourceSpan>,
}

impl WorkspaceEditPlan {
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

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Code action proposal (execution deferred to safe-fix).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CodeAction {
    pub schema: String,
    pub title: String,
    /// `safe_fix` | `migration` | `design_choice`
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostic_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub edit: Option<WorkspaceEditPlan>,
}

impl CodeAction {
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Affected rebuild plan ( plan under DX schema).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AffectedDocument {
    pub schema: String,
    pub full: bool,
    #[serde(rename = "rebuildRuntime")]
    pub rebuild_runtime: bool,
    #[serde(rename = "rebuildServerTree")]
    pub rebuild_server_tree: bool,
    pub units: Vec<AffectedUnitDoc>,
    #[serde(rename = "seedChunks", default, skip_serializing_if = "Vec::is_empty")]
    pub seed_chunks: Vec<String>,
    #[serde(rename = "islandOnly", default, skip_serializing_if = "std::ops::Not::not")]
    pub island_only: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AffectedUnitDoc {
    pub source: String,
    pub kind: String,
    #[serde(rename = "chunkId")]
    pub chunk_id: String,
}

impl AffectedDocument {
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// rename intent — input to `plan_rename` (edit apply is separate).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RenameIntent {
    pub schema: String,
    /// `route_id` | `field` | `method` | `component` | `capability`
    pub kind: String,
    pub from: String,
    pub to: String,
    /// Optional chunk / application / file scope.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
}

impl RenameIntent {
    pub fn new(kind: impl Into<String>, from: impl Into<String>, to: impl Into<String>) -> Self {
        Self {
            schema: RENAME_SCHEMA.into(),
            kind: kind.into(),
            from: from.into(),
            to: to.into(),
            scope: None,
        }
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Graph-selected tests for affected rebuild (+ / .
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TestSelectionDocument {
    pub schema: String,
    /// Human-readable why these tests were selected.
    pub reason: String,
    #[serde(rename = "testIds", default)]
    pub test_ids: Vec<String>,
    #[serde(rename = "affectedChunkIds", default)]
    pub affected_chunk_ids: Vec<String>,
    #[serde(rename = "manifestFiles", default, skip_serializing_if = "Vec::is_empty")]
    pub manifest_files: Vec<String>,
    /// `preview` | `ready` | `empty`
    pub status: String,
}

impl TestSelectionDocument {
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

/// semantic transaction document.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SemanticTransactionDocument {
    pub schema: String,
    pub id: u64,
    /// `open` | `committed` | `rolled_back` | `rejected`
    pub status: String,
    #[serde(default)]
    pub edits: Vec<TextEdit>,
    #[serde(default)]
    pub diagnostics: Vec<DxDiagnostic>,
    #[serde(rename = "dirtyPaths", default, skip_serializing_if = "Vec::is_empty")]
    pub dirty_paths: Vec<String>,
}

impl SemanticTransactionDocument {
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

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// analysis/build cancel ticket.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CancelDocument {
    pub schema: String,
    #[serde(rename = "ticketId")]
    pub ticket_id: u64,
    /// `running` | `cancelled` | `completed` | `superseded`
    pub status: String,
    #[serde(rename = "sessionGeneration", default)]
    pub session_generation: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

impl CancelDocument {
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// affected preview composing chunk plan + tests + routes + regions.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AffectedPreviewDocument {
    pub schema: String,
    pub affected: AffectedDocument,
    #[serde(rename = "testSelection")]
    pub test_selection: TestSelectionDocument,
    #[serde(rename = "routeIds", default)]
    pub route_ids: Vec<String>,
    #[serde(rename = "regionIds", default)]
    pub region_ids: Vec<u32>,
    /// `preview` | `ready` | `stale`
    pub status: String,
}

impl AffectedPreviewDocument {
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// HMR plan (query before soft-reload).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HmrPlanDocument {
    pub schema: String,
    /// `island` | `partial` | `full`
    pub mode: String,
    #[serde(rename = "islandOnly")]
    pub island_only: bool,
    #[serde(rename = "seedChunks", default)]
    pub seed_chunks: Vec<String>,
    #[serde(rename = "affectedChunks", default)]
    pub affected_chunks: Vec<String>,
    #[serde(rename = "preservedRegions", default)]
    pub preserved_regions: Vec<u32>,
    #[serde(rename = "disposedRegions", default)]
    pub disposed_regions: Vec<u32>,
    #[serde(rename = "rerunLoaders", default)]
    pub rerun_loaders: Vec<String>,
    /// `preview` | `ready`
    pub status: String,
}

impl HmrPlanDocument {
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// route/chunk budget (v0: algebraic unitCost, not byte enforcement).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BudgetDocument {
    pub schema: String,
    pub routes: Vec<BudgetRouteEntry>,
    pub chunks: Vec<BudgetChunkEntry>,
    /// `preview` | `ready` | `empty`
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BudgetRouteEntry {
    #[serde(rename = "routeId")]
    pub route_id: String,
    #[serde(rename = "chunkIds", default)]
    pub chunk_ids: Vec<String>,
    #[serde(rename = "unitCost", default)]
    pub unit_cost: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BudgetChunkEntry {
    #[serde(rename = "chunkId")]
    pub chunk_id: String,
    pub kind: String,
    #[serde(rename = "dependsOn", default)]
    pub depends_on: Vec<String>,
    #[serde(rename = "unitCost", default)]
    pub unit_cost: u32,
}

impl BudgetDocument {
    pub fn empty() -> Self {
        Self {
            schema: BUDGET_SCHEMA.into(),
            routes: vec![],
            chunks: vec![],
            status: "empty".into(),
        }
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// umbrella check report.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TransactionCheckReport {
    pub schema: String,
    #[serde(rename = "affectedPreview", skip_serializing_if = "Option::is_none")]
    pub affected_preview: Option<AffectedPreviewDocument>,
    #[serde(rename = "hmrPlan", skip_serializing_if = "Option::is_none")]
    pub hmr_plan: Option<HmrPlanDocument>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub budget: Option<BudgetDocument>,
    #[serde(default)]
    pub diagnostics: Vec<DxDiagnostic>,
    /// `ready` | `preview` | `incomplete`
    pub status: String,
}

impl TransactionCheckReport {
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// runtime trace event (StableId-tagged).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TraceEvent {
    /// `write` | `binding_eval` | `patch` | `effect` | `route` | `capability`
    pub kind: String,
    #[serde(rename = "stableId")]
    pub stable_id: StableId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dep: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub t: Option<u64>,
    #[serde(rename = "chunkId", default, skip_serializing_if = "Option::is_none")]
    pub chunk_id: Option<String>,
}

/// ordered runtime / synthetic trace document.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TraceDocument {
    pub schema: String,
    #[serde(default)]
    pub events: Vec<TraceEvent>,
    /// `ready` | `empty` | `invalid`
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

impl TraceDocument {
    pub fn empty(notes: impl Into<String>) -> Self {
        Self {
            schema: TRACE_SCHEMA.into(),
            events: vec![],
            status: "empty".into(),
            notes: Some(notes.into()),
        }
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// One joined event ↔ explain result.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CausalReplayMatch {
    #[serde(rename = "eventIndex")]
    pub event_index: u32,
    #[serde(rename = "stableId")]
    pub stable_id: StableId,
    /// Event StableId appears in the explain chain.
    #[serde(rename = "inChain")]
    pub in_chain: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub explain: Option<ExplainDocument>,
}

/// causal replay joining trace ↔ `vmz.dx.explain.v0` chains.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CausalReplayDocument {
    pub schema: String,
    pub trace: TraceDocument,
    #[serde(default)]
    pub matches: Vec<CausalReplayMatch>,
    /// `ready` | `failed` | `empty`
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

impl CausalReplayDocument {
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Umbrella check.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CausalReplayCheckReport {
    pub schema: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sample_explain: Option<ExplainDocument>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sample_replay: Option<CausalReplayDocument>,
    #[serde(default)]
    pub diagnostics: Vec<DxDiagnostic>,
    /// `ready` | `preview` | `failed`
    pub status: String,
}

impl CausalReplayCheckReport {
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}
