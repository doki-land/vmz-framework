//! Long-lived compile workspace session (–).
//!
//! N-API / CLI share this session API. Plugins submit contribution batches ;
//! Rust validates — no JS AST callbacks / no direct VPG mutation.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use crate::check::{CheckOptions, CheckReport, check_path, check_project};
use crate::compile::{CompileOptions, CompileReport, compile_path, compile_project};
use crate::format::{FormatOptions, FormatReport, format_path};
use crate::plugin::{
    ApplyContributionsReport, ContributionBatch, ContributionStore, PLUGIN_PROTOCOL_V1,
};
use crate::session_graph::SessionGraph;

/// Version handshake between JS host and native core.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProtocolVersions {
    pub host_protocol: &'static str,
    pub compiler_protocol: &'static str,
    pub program_ir_schema: &'static str,
    pub plugin_protocol: &'static str,
}

/// Locked protocols — bump only with deliberate migration.
/// `program_ir_schema` ≡ [`vmz_protocol::PROGRAM_SCHEMA`];
/// `plugin_protocol` ≡ [`vmz_protocol::PLUGIN_PROTOCOL`].
pub const PROTOCOL: ProtocolVersions = ProtocolVersions {
    host_protocol: vmz_protocol::HOST_PROTOCOL,
    compiler_protocol: vmz_protocol::COMPILER_PROTOCOL,
    program_ir_schema: vmz_protocol::PROGRAM_SCHEMA,
    plugin_protocol: PLUGIN_PROTOCOL_V1,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChangeKind {
    Update,
    Delete,
}

#[derive(Debug, Clone)]
pub struct FileChange {
    pub path: PathBuf,
    pub kind: ChangeKind,
}

#[derive(Clone)]
pub struct WorkspaceOptions {
    pub root: PathBuf,
    pub out_dir: PathBuf,
    /// TW style plugin. `None` skips TW stylesheet emit.
    pub tw: Option<crate::TwCompilerHandle>,
    /// SCSS style plugin. `None` skips `<style>` stylesheet emit.
    pub scss: Option<crate::ScssCompilerHandle>,
    /// `@vmz/core` dist directory (Node resolves via npm). `None` → monorepo fallback.
    pub runtime_dist: Option<PathBuf>,
}

impl std::fmt::Debug for WorkspaceOptions {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WorkspaceOptions")
            .field("root", &self.root)
            .field("out_dir", &self.out_dir)
            .field("tw", &self.tw.as_ref().map(|_| "Some(TwCompiler)"))
            .field("scss", &self.scss.as_ref().map(|_| "Some(ScssCompiler)"))
            .field("runtime_dist", &self.runtime_dist)
            .finish()
    }
}

#[derive(Debug, Clone, Default)]
pub struct BuildRequest {
    pub release: bool,
    /// optional analysis ticket; cancelled tickets are rejected at build entry.
    pub analysis_ticket: Option<u64>,
}

#[derive(Debug, thiserror::Error)]
pub enum HandshakeError {
    #[error("protocol mismatch: host={host:?}")]
    Mismatch { host: ProtocolVersionsOwned },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProtocolVersionsOwned {
    pub host_protocol: String,
    pub compiler_protocol: String,
    pub program_ir_schema: String,
    pub plugin_protocol: String,
}

impl From<&ProtocolVersions> for ProtocolVersionsOwned {
    fn from(p: &ProtocolVersions) -> Self {
        Self {
            host_protocol: p.host_protocol.into(),
            compiler_protocol: p.compiler_protocol.into(),
            program_ir_schema: p.program_ir_schema.into(),
            plugin_protocol: p.plugin_protocol.into(),
        }
    }
}

/// Verify JS host and native core speak the same protocol family (incl. plugins).
pub fn handshake(host: &ProtocolVersionsOwned) -> Result<(), HandshakeError> {
    let ok = host.host_protocol == PROTOCOL.host_protocol
        && host.compiler_protocol == PROTOCOL.compiler_protocol
        && host.program_ir_schema == PROTOCOL.program_ir_schema
        && host.plugin_protocol == PROTOCOL.plugin_protocol;
    if !ok {
        return Err(HandshakeError::Mismatch { host: host.clone() });
    }
    Ok(())
}

/// Long-lived workspace: Rust owns future VPG / caches / validated contributions.
#[derive(Debug)]
pub struct Workspace {
    options: WorkspaceOptions,
    dirty: HashSet<PathBuf>,
    contributions: ContributionStore,
    /// coarse session index refreshed after successful builds.
    session: SessionGraph,
    /// analysis/build cancel tickets (`running` | `cancelled` | `completed`).
    analysis_ticket_seq: u64,
    analysis_tickets: HashMap<u64, String>,
    /// semantic transaction id sequence.
    transaction_seq: u64,
}

impl Workspace {
    pub fn create(options: WorkspaceOptions) -> Self {
        Self {
            options,
            dirty: HashSet::new(),
            contributions: ContributionStore::default(),
            session: SessionGraph::default(),
            analysis_ticket_seq: 0,
            analysis_tickets: HashMap::new(),
            transaction_seq: 0,
        }
    }

    pub fn root(&self) -> &Path {
        &self.options.root
    }

    pub fn out_dir(&self) -> &Path {
        &self.options.out_dir
    }

    pub fn contribution_count(&self) -> usize {
        self.contributions.len()
    }

    pub fn dirty_paths(&self) -> impl Iterator<Item = &Path> {
        self.dirty.iter().map(|p| p.as_path())
    }

    pub fn update_files(&mut self, changes: impl IntoIterator<Item = FileChange>) {
        for c in changes {
            match c.kind {
                ChangeKind::Update | ChangeKind::Delete => {
                    self.dirty.insert(c.path);
                }
            }
        }
        // Session graph stays until rebuild; bump generation so hosts know it's stale.
        self.session.generation = self.session.generation.saturating_add(1);
    }

    /// validate + merge a plugin contribution batch (coarse-grained).
    pub fn apply_plugin_contributions(
        &mut self,
        batch: ContributionBatch,
    ) -> ApplyContributionsReport {
        let report = self.contributions.apply_batch(&batch, &self.options.root);
        if report.accepted > 0 {
            if let Ok(written) = self.contributions.materialize_sources(&self.options.root) {
                for p in written {
                    if p.extension().and_then(|e| e.to_str()) == Some("vmz") {
                        self.dirty.insert(p);
                    }
                }
            }
        }
        report
    }

    pub fn check(&mut self, options: &CheckOptions) -> crate::Result<CheckReport> {
        let written = self.contributions.materialize_sources(&self.options.root)?;
        for p in written {
            self.dirty.insert(p);
        }
        let root = &self.options.root;
        let mut report =
            if root.is_file() { check_path(root, options)? } else { check_project(root, options)? };
        report.diagnostics.extend(self.contributions.analyzer_diagnostics());
        Ok(report)
    }

    /// format `.vmz` under the workspace root (oxc codegen via `format_path`).
    pub fn format(&mut self, options: &FormatOptions) -> crate::Result<FormatReport> {
        format_path(&self.options.root, options)
    }

    pub fn build(&mut self) -> crate::Result<CompileReport> {
        self.build_with(&BuildRequest::default())
    }

    pub fn build_with(&mut self, request: &BuildRequest) -> crate::Result<CompileReport> {
        if let Some(ticket) = request.analysis_ticket {
            match self.analysis_tickets.get(&ticket).map(String::as_str) {
                Some("cancelled") => {
                    crate::bail!("analysis ticket {ticket} was cancelled (dx.x3.cancel)");
                }
                Some("completed") => {
                    crate::bail!("analysis ticket {ticket} already completed (dx.x3.cancel)");
                }
                None => {
                    crate::bail!("unknown analysis ticket {ticket} (dx.x3.cancel)");
                }
                Some("running") => {}
                Some(other) => {
                    crate::bail!("analysis ticket {ticket} status `{other}` rejects build");
                }
            }
        }

        let written = self.contributions.materialize_sources(&self.options.root)?;
        for p in written {
            if p.extension().and_then(|e| e.to_str()) == Some("vmz") {
                self.dirty.insert(p);
            }
        }
        let options = CompileOptions {
            out_dir: self.options.out_dir.clone(),
            release: request.release,
            tw: self.options.tw.clone(),
            scss: self.options.scss.clone(),
            runtime_dist: self.options.runtime_dist.clone(),
        };
        let root = &self.options.root;
        let dirty: Vec<PathBuf> = self.dirty.iter().cloned().collect();
        let force_full = !self.options.out_dir.join("vmz-deployment.json").is_file();
        let mut report = if root.is_file() {
            compile_path(root, &options)?
        } else if force_full || dirty.is_empty() {
            compile_project(root, &options)?
        } else {
            crate::compile::compile_project_with_dirty(root, &options, &dirty)?
        };
        if report.diagnostics.iter().all(|d| !d.is_error()) {
            let targets = self.contributions.emit_targets(&self.options.out_dir)?;
            report.emitted.extend(targets);
            self.session.refresh_from_deployment(&self.options.out_dir);
            if let Some(ticket) = request.analysis_ticket {
                self.analysis_tickets.insert(ticket, "completed".into());
            }
        }
        Ok(report)
    }

    /// session: preview which deployment units the current dirty set would rebuild.
    pub fn query_affected(&self) -> crate::affected::AffectedPlan {
        let dirty: Vec<PathBuf> = self.dirty.iter().cloned().collect();
        crate::affected::plan_affected(&self.options.root, &dirty)
    }

    /// query in-memory session graph (Deployment index owned by Workspace).
    pub fn query_session_graph(&self) -> String {
        if self.session.units.is_empty() {
            let mut tmp = SessionGraph::default();
            if tmp.refresh_from_deployment(&self.options.out_dir) {
                return tmp.to_json();
            }
        }
        self.session.to_json()
    }

    pub fn session_generation(&self) -> u64 {
        self.session.generation
    }

    pub fn program_ir_path(&self, source: impl AsRef<Path>) -> PathBuf {
        let source = source.as_ref();
        let root = &self.options.root;
        let abs = if source.is_absolute() { source.to_path_buf() } else { root.join(source) };
        let src_root = if root.join("src").is_dir() { root.join("src") } else { root.clone() };
        let stem = abs.file_stem().and_then(|s| s.to_str()).unwrap_or("component");
        let rel_dir = abs
            .parent()
            .and_then(|p| p.strip_prefix(&src_root).ok())
            .map(|p| p.to_path_buf())
            .unwrap_or_default();
        self.options.out_dir.join(rel_dir).join(format!("{stem}.program.json"))
    }

    pub fn query_program_graph(&self, source: impl AsRef<Path>) -> crate::Result<String> {
        let path = self.program_ir_path(source);
        fs::read_to_string(&path).map_err(|e| {
            crate::Error::msg(format!(
                "queryProgramGraph: missing {} ({e}); build the workspace first",
                path.display()
            ))
        })
    }

    /// Provenance explain (deployment/session): chunk / source / capability / contribution / edge selectors.
    ///
    /// Edge selectors: `components/Card#binding:0`, `…#effect:onMount`, `…#call:load`.
    /// `write:<field>` / `update:<chunk>#binding:<id>` fill `ExplainDocument.chain` from Program Graph.
    pub fn explain(&self, target: &str) -> String {
        let target = target.trim();
        if let Some(spec) = target.strip_prefix("write:") {
            return vmz_debugger::explain_write(
                &self.options.out_dir,
                spec,
                self.session.generation,
            )
            .to_json();
        }
        if let Some(spec) = target.strip_prefix("update:") {
            return vmz_debugger::explain_update(
                &self.options.out_dir,
                spec,
                self.session.generation,
            )
            .to_json();
        }
        if let Some(spec) = target.strip_prefix("style:") {
            return crate::style_explain::explain_style(
                &self.options.root,
                self.session.generation,
                spec,
            )
            .to_json();
        }
        // `style/<node>` accepted as sugar for `style:<node>`
        if let Some(spec) = target.strip_prefix("style/") {
            return crate::style_explain::explain_style(
                &self.options.root,
                self.session.generation,
                spec,
            )
            .to_json();
        }
        if let Some(spec) = target.strip_prefix("rename:") {
            // `rename:route_id:home->landing` or intent JSON after `rename:json:`
            if let Some(json) = spec.strip_prefix("json:") {
                return self.explain_rename_chain(json);
            }
            if let Some((kind_from, to)) = spec.rsplit_once("->") {
                let (kind, from) = if let Some((k, f)) = kind_from.split_once(':') {
                    (k, f)
                } else {
                    ("route_id", kind_from)
                };
                let intent = vmz_protocol::RenameIntent::new(kind, from, to);
                return self.explain_rename_chain(&intent.to_json());
            }
        }
        let deployment_path = self.options.out_dir.join("vmz-deployment.json");
        let deployment_text = fs::read_to_string(&deployment_path).ok();
        let (kind, chunk_id, matched_unit, edge_sel) =
            resolve_explain_target(target, deployment_text.as_deref(), &self.options.root);

        let program_text = chunk_id.as_ref().and_then(|cid| {
            let p = self.options.out_dir.join(format!("{cid}.program.json"));
            fs::read_to_string(p).ok()
        });
        let program_summary = program_text
            .as_ref()
            .map(|text| summarize_program_json(text))
            .unwrap_or_else(|| "null".into());
        let edge_json = match (&edge_sel, &program_text) {
            (Some(sel), Some(text)) => explain_edge(text, sel),
            _ => "null".into(),
        };

        let contribs = self.contributions.explain_rows();
        let contrib_query = target.strip_prefix("contribution:").unwrap_or(target);
        let matched_contribs: Vec<&crate::plugin::ExplainContribution> = contribs
            .iter()
            .filter(|c| {
                if kind == "contribution" {
                    return c.id.contains(contrib_query) || c.item_id == contrib_query;
                }
                let Some(path) = &c.path else {
                    return false;
                };
                let norm = path.replace('\\', "/");
                chunk_id.as_ref().is_some_and(|cid| norm.contains(cid.as_str()))
                    || matched_unit
                        .as_ref()
                        .and_then(|u| extract_json_str_line(u, "source"))
                        .is_some_and(|s| {
                            let s = s.replace('\\', "/");
                            norm.contains(&s) || s.contains(&norm)
                        })
                    || target.contains(&norm)
                    || norm.contains(target)
            })
            .collect();

        let unit_value = matched_unit.and_then(|u| serde_json::from_str(&u).ok());
        let program_value = program_summary
            .as_str()
            .ne("null")
            .then(|| serde_json::from_str(&program_summary).ok())
            .flatten();
        let edge_value =
            (edge_json.as_str() != "null").then(|| serde_json::from_str(&edge_json).ok()).flatten();
        let contrib_values: Vec<serde_json::Value> = matched_contribs
            .iter()
            .map(|c| {
                let path = c
                    .path
                    .as_ref()
                    .map(|p| serde_json::Value::String(p.clone()))
                    .unwrap_or(serde_json::Value::Null);
                serde_json::json!({
                    "id": c.id,
                    "plugin": c.plugin,
                    "version": c.version,
                    "stage": c.stage,
                    "kind": c.kind,
                    "itemId": c.item_id,
                    "path": path,
                    "cacheKey": c.cache_key,
                })
            })
            .collect();

        let doc = vmz_protocol::ExplainDocument {
            schema: vmz_protocol::EXPLAIN_SCHEMA.into(),
            target: target.to_string(),
            kind: kind.clone(),
            chunk_id: chunk_id.clone(),
            deployment_unit: unit_value,
            program: program_value,
            edge: edge_value,
            session_generation: self.session.generation,
            contributions: contrib_values,
            chain: vec![],
            notes: Some(
                "Deployment + Program IR + session index + plugin store; doc 13 F full causal graph remains later (protocol schema)."
                    .into(),
            ),
        };
        doc.to_json()
    }

    // DX protocol catalog (schema ids for CLI/LSP/MCP handshake).
    pub fn query_dx_catalog(&self) -> String {
        let _ = self;
        vmz_protocol::DxCatalog::v0().to_json()
    }

    /// Umbrella protocol catalog (`vmz.protocol.v0`).
    pub fn query_protocol_catalog(&self) -> String {
        let _ = self;
        vmz_protocol::ProtocolCatalog::v0().to_json()
    }

    // Affected document (`vmz.dx.affected.v0`).
    pub fn query_affected_dx(&self) -> String {
        self.query_affected().to_dx_document().to_json()
    }

    /// plan RouteId/field rename → WorkspaceEditPlan with proven TextEdits.
    pub fn plan_rename(&self, intent_json: &str) -> String {
        let intent: vmz_protocol::RenameIntent = match serde_json::from_str(intent_json) {
            Ok(v) => v,
            Err(e) => {
                return vmz_protocol::WorkspaceEditPlan::rejected(
                    format!("invalid rename intent JSON: {e}"),
                    "dx.rename.invalid_json",
                )
                .to_json();
            }
        };
        let Some(kind) = vmz_protocol::normalize_rename_kind(&intent.kind) else {
            return vmz_protocol::WorkspaceEditPlan::rejected(
                format!(
                    "unsupported rename kind `{}` (expected route_id|field|method|component|capability)",
                    intent.kind
                ),
                "dx.rename.kind",
            )
            .to_json();
        };
        if intent.from.trim().is_empty() || intent.to.trim().is_empty() {
            return vmz_protocol::WorkspaceEditPlan::rejected(
                "rename requires non-empty `from` and `to`",
                "dx.rename.empty",
            )
            .to_json();
        }
        if intent.from == intent.to {
            return vmz_protocol::WorkspaceEditPlan::rejected(
                "rename `from` and `to` are identical",
                "dx.rename.noop",
            )
            .to_json();
        }

        crate::rename::plan_rename_edits(&self.options.root, &intent, kind).to_json()
    }

    /// graph→test selection for current dirty/affected set.
    pub fn select_tests_affected(&self) -> String {
        let plan = self.query_affected();
        let chunks: Vec<String> = plan.units.iter().map(|u| u.chunk_id.clone()).collect();
        crate::rename::select_tests_for_chunks(&self.options.root, &chunks, plan.full).to_json()
    }

    /// explain rename causal chain (symbol → edits → chunks → tests).
    pub fn explain_rename_chain(&self, intent_json: &str) -> String {
        let plan_json = self.plan_rename(intent_json);
        let plan: vmz_protocol::WorkspaceEditPlan = serde_json::from_str(&plan_json)
            .unwrap_or_else(|_| {
                vmz_protocol::WorkspaceEditPlan::rejected("parse", "dx.rename.invalid_json")
            });
        let intent: vmz_protocol::RenameIntent = serde_json::from_str(intent_json)
            .unwrap_or_else(|_| vmz_protocol::RenameIntent::new("route_id", "?", "?"));
        let kind = vmz_protocol::normalize_rename_kind(&intent.kind).unwrap_or("route_id");
        let mut chunks = crate::rename::chunks_from_edits(&plan.edits);
        let affected = self.query_affected();
        for u in &affected.units {
            if !chunks.contains(&u.chunk_id) {
                chunks.push(u.chunk_id.clone());
            }
        }
        chunks.sort();
        chunks.dedup();
        let tests = crate::rename::select_tests_for_chunks(&self.options.root, &chunks, false);
        let chain = crate::rename::rename_explain_chain(
            kind,
            intent.from.trim(),
            intent.to.trim(),
            &plan.edits,
            &chunks,
            &tests.test_ids,
        );
        let causal = crate::rename::causal_chain_id(kind, intent.from.trim(), intent.to.trim());
        let doc = vmz_protocol::ExplainDocument {
            schema: vmz_protocol::EXPLAIN_SCHEMA.into(),
            target: causal.clone(),
            kind: "rename".into(),
            chunk_id: chunks.first().cloned(),
            deployment_unit: None,
            program: None,
            edge: None,
            session_generation: self.session.generation,
            contributions: vec![],
            chain,
            notes: Some(format!(
                "causal chain {causal}; edits={}; chunks={}; tests={}",
                plan.edits.len(),
                chunks.len(),
                tests.test_ids.len()
            )),
        };
        doc.to_json()
    }

    /// atomically apply a ready WorkspaceEditPlan and mark edited paths dirty.
    pub fn apply_workspace_edit(&mut self, plan_json: &str) -> String {
        let plan: vmz_protocol::WorkspaceEditPlan = match serde_json::from_str(plan_json) {
            Ok(v) => v,
            Err(e) => {
                return vmz_protocol::WorkspaceEditPlan::rejected(
                    format!("invalid WorkspaceEditPlan JSON: {e}"),
                    "dx.rename.apply_invalid_json",
                )
                .to_json();
            }
        };
        let applied = crate::rename::apply_workspace_edits(&self.options.root, &plan);
        if applied.status == "applied" {
            for e in &plan.edits {
                self.dirty.insert(self.options.root.join(&e.path));
            }
        }
        applied.to_json()
    }

    /// Symbol/Reference index + source map + safe_fix CodeActions.
    pub fn check_cross_sfc(&self) -> String {
        crate::cross_sfc::check_cross_sfc(&self.options.root).to_json()
    }

    /// query Symbol index JSON.
    pub fn query_symbols(&self) -> String {
        crate::cross_sfc::build_symbol_index(&self.options.root).to_json()
    }

    /// query references for a stable id (`kind:id`).
    pub fn query_references(&self, target: &str) -> String {
        let index = crate::cross_sfc::build_symbol_index(&self.options.root);
        let (kind, id) = target.split_once(':').unwrap_or(("component", target));
        let refs: Vec<_> =
            index.references.into_iter().filter(|r| r.to.kind == kind && r.to.id == id).collect();
        serde_json::to_string_pretty(&refs).unwrap_or_else(|_| "[]".into())
    }

    /// list CodeActions (safe_fix first).
    pub fn list_code_actions(&self) -> String {
        let report = crate::cross_sfc::check_cross_sfc(&self.options.root);
        serde_json::to_string_pretty(&report.code_actions).unwrap_or_else(|_| "[]".into())
    }

    /// apply atomic TextEdit batch (`vmz.dx.semantic_transaction.v0`).
    pub fn apply_semantic_transaction(&mut self, edits_json: &str) -> String {
        let edits: Vec<vmz_protocol::TextEdit> = match serde_json::from_str(edits_json) {
            Ok(v) => v,
            Err(e) => {
                return vmz_protocol::SemanticTransactionDocument::rejected(
                    0,
                    format!("invalid TextEdit[] JSON: {e}"),
                    "dx.x3.transaction.invalid_json",
                )
                .to_json();
            }
        };
        self.transaction_seq = self.transaction_seq.saturating_add(1);
        let id = self.transaction_seq;
        let doc = crate::transaction::apply_semantic_transaction(&self.options.root, id, &edits);
        if doc.status == "committed" {
            for rel in &doc.dirty_paths {
                self.dirty.insert(self.options.root.join(rel));
            }
            self.session.generation = self.session.generation.saturating_add(1);
        }
        doc.to_json()
    }

    /// open an analysis/build ticket (`vmz.dx.cancel.v0`, status `running`).
    pub fn begin_analysis(&mut self) -> String {
        self.analysis_ticket_seq = self.analysis_ticket_seq.saturating_add(1);
        let ticket = self.analysis_ticket_seq;
        self.analysis_tickets.insert(ticket, "running".into());
        crate::transaction::cancel_document(
            ticket,
            "running",
            self.session.generation,
            "analysis ticket opened",
        )
        .to_json()
    }

    /// cancel an open analysis ticket; subsequent build with that ticket fails.
    pub fn cancel_analysis(&mut self, ticket_id: u64) -> String {
        match self.analysis_tickets.get(&ticket_id).map(String::as_str) {
            Some("running") => {
                self.analysis_tickets.insert(ticket_id, "cancelled".into());
                crate::transaction::cancel_document(
                    ticket_id,
                    "cancelled",
                    self.session.generation,
                    "analysis ticket cancelled",
                )
                .to_json()
            }
            Some(status) => crate::transaction::cancel_document(
                ticket_id,
                status,
                self.session.generation,
                format!("ticket already `{status}`"),
            )
            .to_json(),
            None => crate::transaction::cancel_document(
                ticket_id,
                "cancelled",
                self.session.generation,
                "unknown ticket treated as cancelled",
            )
            .to_json(),
        }
    }

    /// affected preview (chunks + tests + routes + regions).
    pub fn query_affected_preview(&self) -> String {
        let dirty: Vec<PathBuf> = self.dirty.iter().cloned().collect();
        crate::transaction::plan_affected_preview(&self.options.root, &dirty, &self.session)
            .to_json()
    }

    /// HMR plan (island | partial | full).
    pub fn query_hmr_plan(&self) -> String {
        let dirty: Vec<PathBuf> = self.dirty.iter().cloned().collect();
        crate::transaction::plan_hmr(&self.options.root, &dirty, &self.session).to_json()
    }

    /// route/chunk budget from deployment (`unitCost`).
    pub fn query_budget(&self) -> String {
        crate::transaction::plan_budget(&self.options.out_dir).to_json()
    }

    /// umbrella incremental DX report.
    pub fn check_transaction(&self) -> String {
        let dirty: Vec<PathBuf> = self.dirty.iter().cloned().collect();
        crate::transaction::check_transaction(
            &self.options.root,
            &self.options.out_dir,
            &dirty,
            &self.session,
        )
        .to_json()
    }

    /// route/resume/rpc/action boundary validators from deployment.
    pub fn query_boundary_validators(&self) -> String {
        crate::deployment_proof::plan_boundary_validators(&self.options.out_dir).to_json()
    }

    /// client/server leakage findings from deployment.
    pub fn query_leakage(&self) -> String {
        crate::deployment_proof::plan_leakage(&self.options.out_dir).to_json()
    }

    /// capability → target (`node` | `unbound`) from deployment.
    pub fn query_capability_targets(&self) -> String {
        crate::deployment_proof::plan_capability_targets(&self.options.out_dir).to_json()
    }

    /// dead graph (BFS from page/app roots via dependsOn).
    pub fn query_dead_graph(&self) -> String {
        crate::deployment_proof::plan_dead_graph(&self.options.out_dir).to_json()
    }

    /// umbrella deployment proof report.
    pub fn check_deployment_proof(&self) -> String {
        crate::deployment_proof::check_deployment_proof(&self.options.out_dir).to_json()
    }

    /// ingest runtime / synthetic StableId trace (`vmz.dx.trace.v0`).
    pub fn ingest_runtime_trace(&self, trace_json: &str) -> String {
        vmz_debugger::ingest_runtime_trace(trace_json).to_json()
    }

    /// join trace events ↔ explain chains (`vmz.dx.causal_replay.v0`).
    pub fn replay_causal(&self, trace_json: &str) -> String {
        vmz_debugger::replay_causal(&self.options.out_dir, trace_json, self.session.generation)
            .to_json()
    }

    /// umbrella deep-explain report.
    pub fn check_causal_replay(&self) -> String {
        vmz_debugger::check_causal_replay(&self.options.out_dir, self.session.generation).to_json()
    }

    /// miniprogram: target-neutral View Ops / profile / artifact contract check.
    pub fn check_miniprogram_target_contract(&self) -> String {
        crate::miniprogram_target::check_miniprogram_target_contract(&self.options.root).to_json()
    }

    /// HostProfile / DeliveryProfile protocol check.
    pub fn check_host_profile_protocol(&self) -> String {
        crate::host_profile::check_host_profile_protocol(&self.options.root).to_json()
    }

    /// deterministic Surface/capability/route solver check.
    pub fn check_profile_solver(&self) -> String {
        crate::profile_solver::check_profile_solver(&self.options.root).to_json()
    }

    /// Unified Executor algebraic check.
    pub fn check_unified_executor(&self) -> String {
        crate::unified_executor::check_unified_executor(&self.options.root).to_json()
    }

    /// Lifecycle / Recovery algebraic check.
    pub fn check_lifecycle_recovery(&self) -> String {
        crate::lifecycle_recovery::check_lifecycle_recovery(&self.options.root).to_json()
    }

    /// Delivery Proof algebraic check.
    pub fn check_delivery_proof(&self) -> String {
        crate::delivery_proof::check_delivery_proof(&self.options.root).to_json()
    }

    /// Cross-Host Conformance algebraic check.
    pub fn check_cross_host_conformance(&self) -> String {
        crate::cross_host_conformance::check_cross_host_conformance(&self.options.root).to_json()
    }

    pub fn query_profile_catalog(&self) -> String {
        vmz_protocol::ProfileProtocolCatalog::v0().to_json()
    }

    /// miniprogram: target protocol catalog JSON.
    pub fn query_target_catalog(&self) -> String {
        vmz_protocol::TargetProtocolCatalog::v0().to_json()
    }

    /// native: NativeSurfaceId / ownership / lifetime contract check.
    pub fn check_native_surface_contract(&self) -> String {
        crate::native_surface::check_native_surface_contract(&self.options.root).to_json()
    }

    /// native: iOS/Android shared Host Profile multi-platform contract check.
    pub fn check_multi_platform_contract(&self) -> String {
        crate::multi_platform::check_multi_platform_contract(&self.options.root).to_json()
    }

    /// native: NativeAppHost full-stack (SSR/#server/auth/network) contract check.
    pub fn check_native_fullstack_contract(&self) -> String {
        crate::native_fullstack::check_native_fullstack_contract(&self.options.root).to_json()
    }

    /// native: NativeAppHost lifecycle / persistence / update / offline contract check.
    pub fn check_native_lifecycle_contract(&self) -> String {
        crate::native_lifecycle::check_native_lifecycle_contract(&self.options.root).to_json()
    }

    /// native: typed Native Capability Bridge contract check.
    pub fn check_native_bridge_contract(&self) -> String {
        crate::native_bridge::check_native_bridge_contract(&self.options.root).to_json()
    }

    /// native: Native WebView shell contract check.
    pub fn check_native_shell_contract(&self) -> String {
        crate::native_shell::check_native_shell_contract(&self.options.root).to_json()
    }

    /// native: NativeAppHost / WebView deployment contract check.
    pub fn check_native_host_contract(&self) -> String {
        crate::native_host::check_native_host_contract(&self.options.root).to_json()
    }

    /// native: native-host protocol catalog JSON.
    pub fn query_native_host_catalog(&self) -> String {
        vmz_protocol::NativeHostProtocolCatalog::v0().to_json()
    }

    pub fn clear_dirty(&mut self) {
        self.dirty.clear();
    }
}

fn resolve_explain_target(
    target: &str,
    deployment: Option<&str>,
    root: &Path,
) -> (String, Option<String>, Option<String>, Option<String>) {
    if target.starts_with("contribution:") {
        return ("contribution".into(), None, None, None);
    }

    // `chunk#binding:0` | `chunk#effect:name` | `chunk#call:method`
    if let Some((head, edge)) = target.split_once('#') {
        let (_kind, chunk, unit, _) = resolve_explain_target(head, deployment, root);
        let edge_kind = if edge.starts_with("binding:") {
            "binding"
        } else if edge.starts_with("effect:") {
            "effect"
        } else if edge.starts_with("call:") {
            "call"
        } else {
            "edge"
        };
        return (edge_kind.into(), chunk, unit, Some(edge.to_string()));
    }

    if let Some(method) = target.strip_prefix("capability:") {
        if let Some(dep) = deployment {
            for line in dep.lines() {
                if line.contains("\"capabilities\"") && line.contains(method) {
                    if let Some(chunk) = extract_json_str_line(line, "chunkId") {
                        return (
                            "capability".into(),
                            Some(chunk),
                            Some(line.trim().trim_end_matches(',').to_string()),
                            None,
                        );
                    }
                }
            }
        }
        return ("capability".into(), None, None, None);
    }

    if let Some(dep) = deployment {
        for line in dep.lines() {
            if let Some(chunk) = extract_json_str_line(line, "chunkId") {
                if chunk == target {
                    return (
                        "chunk".into(),
                        Some(chunk),
                        Some(line.trim().trim_end_matches(',').to_string()),
                        None,
                    );
                }
            }
        }
    }

    let abs =
        if Path::new(target).is_absolute() { PathBuf::from(target) } else { root.join(target) };
    let norm = abs.to_string_lossy().replace('\\', "/");
    if let Some(dep) = deployment {
        for line in dep.lines() {
            if let Some(source) = extract_json_str_line(line, "source") {
                let src_norm = source.replace('\\', "/");
                if src_norm == norm
                    || src_norm.ends_with(target)
                    || norm.ends_with(&src_norm)
                    || src_norm.contains(target)
                {
                    let chunk = extract_json_str_line(line, "chunkId");
                    return (
                        "source".into(),
                        chunk,
                        Some(line.trim().trim_end_matches(',').to_string()),
                        None,
                    );
                }
            }
        }
    }

    if target.contains('/') && target.ends_with(".vmz") {
        return ("source".into(), None, None, None);
    }
    ("chunk".into(), Some(target.to_string()), None, None)
}

fn explain_edge(program_json: &str, sel: &str) -> String {
    if let Some(id_s) = sel.strip_prefix("binding:") {
        let Ok(want) = id_s.parse::<u32>() else {
            return format!("{{\"error\":\"bad binding id\", \"sel\":{sel:?}}}");
        };
        // Scan binding objects: "id": N
        let mut found = None;
        for line in program_json.lines() {
            let t = line.trim();
            if !t.contains("\"id\":") || !t.contains("\"kind\":") {
                continue;
            }
            if let Some(id) = extract_json_number(t, "id") {
                if id == want {
                    found = Some(t.trim_end_matches(',').to_string());
                    break;
                }
            }
        }
        return match found {
            Some(raw) => format!("{{\"selector\":{sel:?},\"binding\":{raw}}}"),
            None => format!("{{\"selector\":{sel:?},\"binding\":null}}"),
        };
    }
    if let Some(name) = sel.strip_prefix("effect:") {
        for line in program_json.lines() {
            let t = line.trim();
            if t.contains("\"name\":") && t.contains("\"writes\":") {
                if extract_json_str_line(t, "name").as_deref() == Some(name) {
                    return format!(
                        "{{\"selector\":{sel:?},\"effect\":{}}}",
                        t.trim_end_matches(',')
                    );
                }
            }
        }
        return format!("{{\"selector\":{sel:?},\"effect\":null}}");
    }
    if let Some(method) = sel.strip_prefix("call:") {
        for line in program_json.lines() {
            let t = line.trim();
            if t.contains("\"method\":")
                && (t.contains("fromClientMethod") || t.contains("from_client_method"))
            {
                if extract_json_str_line(t, "method").as_deref() == Some(method) {
                    return format!(
                        "{{\"selector\":{sel:?},\"call\":{}}}",
                        t.trim_end_matches(',')
                    );
                }
            }
        }
        // Also match deployment clientCalls / server capabilities surface.
        if program_json.contains(&format!("\"method\": \"{method}\""))
            || program_json.contains(&format!("\"method\":{method:?}"))
        {
            return format!(
                "{{\"selector\":{sel:?},\"call\":{{\"method\":{method:?},\"present\":true}}}}"
            );
        }
        return format!("{{\"selector\":{sel:?},\"call\":null}}");
    }
    format!("{{\"selector\":{sel:?},\"error\":\"unknown edge selector\"}}")
}

fn extract_json_number(line: &str, key: &str) -> Option<u32> {
    let pat = format!("\"{key}\":");
    let i = line.find(&pat)?;
    let rest = line[i + pat.len()..].trim_start();
    let end = rest.find(|c: char| !c.is_ascii_digit()).unwrap_or(rest.len());
    rest[..end].parse().ok()
}

fn extract_json_str_line(line: &str, key: &str) -> Option<String> {
    let pat = format!("\"{key}\":");
    let i = line.find(&pat)?;
    let mut rest = line[i + pat.len()..].trim_start();
    if rest.starts_with("null") {
        return None;
    }
    if !rest.starts_with('"') {
        return None;
    }
    rest = &rest[1..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

fn summarize_program_json(text: &str) -> String {
    let name =
        text.lines().find_map(|l| extract_json_str_line(l, "name")).unwrap_or_else(|| "?".into());
    let mut caps = Vec::new();
    for line in text.lines() {
        if line.contains("\"method\":")
            && (line.contains("async_boundary")
                || line.contains("callable_from_client")
                || line.contains("fromClientMethod")
                || line.contains("from_client_method"))
        {
            if let Some(m) = extract_json_str_line(line, "method") {
                if !caps.contains(&m) {
                    caps.push(m);
                }
            }
        }
    }
    let mut regions = Vec::new();
    for key in ["\"regionIds\"", "\"region_ids\""] {
        if let Some(i) = text.find(key) {
            let rest = &text[i..];
            if let Some(lb) = rest.find('[') {
                if let Some(rb) = rest[lb..].find(']') {
                    for part in rest[lb + 1..lb + rb].split(',') {
                        let t = part.trim();
                        if !t.is_empty() {
                            regions.push(t.to_string());
                        }
                    }
                }
            }
            break;
        }
    }
    let edge_count = text.matches("\"kind\": \"reads\"").count()
        + text.matches("\"kind\": \"writes\"").count()
        + text.matches("\"kind\": \"calls\"").count()
        + text.matches("\"kind\": \"region_stable\"").count();
    let unknown_count = text.matches("\"reason\": \"opaque_callee\"").count()
        + text.matches("\"reason\": \"unresolved_method\"").count()
        + text.matches("\"reason\": \"array_destructure\"").count()
        + text.matches("\"reason\": \"computed_member\"").count()
        + text.matches("\"reason\": \"rest_destructure\"").count()
        + text.matches("\"reason\": \"closure_boundary\"").count()
        + text.matches("\"reason\": \"field_star\"").count()
        + text.matches("\"reason\": \"ir_unknown\"").count();
    let resource_partial = text.contains("\"resources\"")
        && (text.contains("async_effect")
            || text.contains("server_capability")
            || text.contains("\"kind\": \"http\""));
    let cap_s = caps.iter().map(|c| format!("{c:?}")).collect::<Vec<_>>().join(", ");
    format!(
        "{{\"unitName\":{name:?},\"capabilities\":[{cap_s}],\"regionIds\":[{}],\"edgeCount\":{edge_count},\"unknownCount\":{unknown_count},\"hasResources\":{resource_partial}}}",
        regions.join(", ")
    )
}
