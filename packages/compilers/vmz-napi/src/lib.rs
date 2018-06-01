//! Node N-API bindings for the VMZ workspace session (–).
//!
//! Coarse-grained only — no per-AST JS callbacks.

#![warn(missing_docs)]
use std::path::PathBuf;
use std::sync::Mutex;

use napi::bindgen_prelude::*;
use napi_derive::napi;
use vmz_compiler::{
    BuildRequest, ChangeKind, CheckOptions, ContributionBatch, ContributionItem, ContributionKind,
    FileChange, PROTOCOL, PluginIdentity, PluginStage, ProtocolVersionsOwned, Workspace,
    WorkspaceOptions, check_application_artifact_boundary, check_application_dev_test_deploy,
    check_application_host_composition, check_application_isolation, check_application_relocatable,
    check_applications, handshake, relocate_manifest_json,
};
use vmz_inspector::append_convention_lints;
use vmz_protocol::ApplicationProtocolCatalog;

#[napi(object)]
pub struct JsProtocolVersions {
    pub host_protocol: String,
    pub compiler_protocol: String,
    pub program_ir_schema: String,
    pub plugin_protocol: String,
}

#[napi(object)]
pub struct JsFileChange {
    pub path: String,
    /// `"update"` | `"delete"`
    pub kind: String,
}

#[napi(object)]
pub struct JsDiagnostic {
    pub path: String,
    pub severity: String,
    pub message: String,
}

#[napi(object)]
pub struct JsCheckReport {
    pub files_checked: u32,
    pub diagnostics: Vec<JsDiagnostic>,
    pub dirty_count: u32,
}

#[napi(object)]
pub struct JsBuildReport {
    pub emitted: Vec<String>,
    pub diagnostics: Vec<JsDiagnostic>,
    pub dirty_count: u32,
    pub full: bool,
    pub affected_sources: Vec<String>,
    pub affected_chunks: Vec<String>,
    pub seed_chunks: Vec<String>,
    pub island_hmr: bool,
}

#[napi(object)]
pub struct JsAffectedUnit {
    pub source: String,
    pub kind: String,
    pub chunk_id: String,
}

#[napi(object)]
pub struct JsAffectedPlan {
    pub full: bool,
    pub rebuild_runtime: bool,
    pub rebuild_server_tree: bool,
    pub units: Vec<JsAffectedUnit>,
    pub seed_chunks: Vec<String>,
    pub island_only: bool,
}

#[napi(object)]
pub struct JsFormatReport {
    pub files_checked: u32,
    pub files_written: u32,
    pub files_need_write: u32,
    pub diagnostics: Vec<JsDiagnostic>,
}

#[napi(object)]
pub struct JsWorkspaceOptions {
    pub root: String,
    pub out_dir: Option<String>,
    pub protocol: Option<JsProtocolVersions>,
    /// Absolute path to `@vmz/core` dist/ (Node resolves via npm).
    pub runtime_dist: Option<String>,
}

#[napi(object)]
pub struct JsContributionItem {
    pub id: String,
    /// `source` | `analyzer` | `target` | `graph_mutation`
    pub kind: String,
    pub path: Option<String>,
    pub content: Option<String>,
    pub content_hash: Option<String>,
    pub materialize: Option<bool>,
    pub severity: Option<String>,
    pub message: Option<String>,
    pub code: Option<String>,
    pub target_id: Option<String>,
    pub target_kind: Option<String>,
    pub manifest_json: Option<String>,
    pub detail: Option<String>,
}

#[napi(object)]
pub struct JsContributionBatch {
    pub plugin_name: String,
    pub plugin_version: String,
    pub protocol: String,
    /// `workspace_resolve` | `source_adapter` | `analyzer` | `target`
    pub stage: String,
    pub cache_key: String,
    pub deterministic: Option<bool>,
    pub items: Vec<JsContributionItem>,
}

#[napi(object)]
pub struct JsRejection {
    pub plugin: String,
    pub item_id: String,
    pub reason: String,
}

#[napi(object)]
pub struct JsContributionDiff {
    pub added: Vec<String>,
    pub removed: Vec<String>,
    pub unchanged: Vec<String>,
}

#[napi(object)]
pub struct JsApplyContributionsReport {
    pub accepted: u32,
    pub rejected: Vec<JsRejection>,
    pub diff: JsContributionDiff,
}

fn map_diag(d: &vmz_compiler::ReportedDiagnostic) -> JsDiagnostic {
    let severity = match d.severity() {
        vmz_compiler::Severity::Error => "error",
        vmz_compiler::Severity::Warning => "warning",
        vmz_compiler::Severity::Advice => "advice",
    };
    JsDiagnostic {
        path: d.path().display().to_string(),
        severity: severity.into(),
        message: d.message().to_string(),
    }
}

fn owned_protocol(p: &JsProtocolVersions) -> ProtocolVersionsOwned {
    ProtocolVersionsOwned {
        host_protocol: p.host_protocol.clone(),
        compiler_protocol: p.compiler_protocol.clone(),
        program_ir_schema: p.program_ir_schema.clone(),
        plugin_protocol: p.plugin_protocol.clone(),
    }
}

fn map_batch(batch: JsContributionBatch) -> Result<ContributionBatch> {
    let stage = PluginStage::parse(&batch.stage).ok_or_else(|| {
        Error::from_reason(format!(
            "unknown plugin stage `{}` (workspace_resolve|source_adapter|analyzer|target)",
            batch.stage
        ))
    })?;
    let mut items = Vec::with_capacity(batch.items.len());
    for it in batch.items {
        let kind = match it.kind.as_str() {
            "source" => ContributionKind::Source {
                path: PathBuf::from(
                    it.path.ok_or_else(|| Error::from_reason("source.path required"))?,
                ),
                content: it.content.ok_or_else(|| Error::from_reason("source.content required"))?,
                content_hash: it
                    .content_hash
                    .ok_or_else(|| Error::from_reason("source.contentHash required"))?,
                materialize: it.materialize.unwrap_or(true),
            },
            "analyzer" => ContributionKind::Analyzer {
                path: PathBuf::from(it.path.unwrap_or_else(|| "<plugin>".into())),
                severity: it.severity.unwrap_or_else(|| "warning".into()),
                message: it
                    .message
                    .ok_or_else(|| Error::from_reason("analyzer.message required"))?,
                code: it.code,
            },
            "target" => ContributionKind::Target {
                target_id: it
                    .target_id
                    .ok_or_else(|| Error::from_reason("target.targetId required"))?,
                kind: it
                    .target_kind
                    .ok_or_else(|| Error::from_reason("target.targetKind required"))?,
                manifest_json: it
                    .manifest_json
                    .ok_or_else(|| Error::from_reason("target.manifestJson required"))?,
            },
            "graph_mutation" => ContributionKind::GraphMutation {
                detail: it.detail.unwrap_or_else(|| "unspecified".into()),
            },
            other => {
                return Err(Error::from_reason(format!("unknown contribution kind `{other}`")));
            }
        };
        items.push(ContributionItem { id: it.id, kind });
    }
    Ok(ContributionBatch {
        plugin: PluginIdentity { name: batch.plugin_name, version: batch.plugin_version },
        protocol: batch.protocol,
        stage,
        cache_key: batch.cache_key,
        deterministic: batch.deterministic.unwrap_or(true),
        items,
    })
}

#[napi]
pub fn get_protocol_versions() -> JsProtocolVersions {
    JsProtocolVersions {
        host_protocol: PROTOCOL.host_protocol.into(),
        compiler_protocol: PROTOCOL.compiler_protocol.into(),
        program_ir_schema: PROTOCOL.program_ir_schema.into(),
        plugin_protocol: PROTOCOL.plugin_protocol.into(),
    }
}

#[napi]
pub fn handshake_protocols(host: JsProtocolVersions) -> Result<()> {
    handshake(&owned_protocol(&host)).map_err(|e| Error::from_reason(e.to_string()))
}

/// frozen application composition schema catalog (`vmz.application.protocol.v0`).
#[napi]
pub fn query_application_protocol_catalog() -> String {
    ApplicationProtocolCatalog::v0().to_json()
}

/// miniprogram: target protocol catalog (`vmz.target.protocol.v0`).
#[napi]
pub fn query_target_protocol_catalog() -> String {
    vmz_protocol::TargetProtocolCatalog::v0().to_json()
}

/// native: native-host protocol catalog.
#[napi]
pub fn query_native_host_protocol_catalog() -> String {
    vmz_protocol::NativeHostProtocolCatalog::v0().to_json()
}

/// native: check NativeAppHost / WebView contract for a workspace root.
#[napi]
pub fn check_native_host_contract_json(root: String) -> String {
    vmz_compiler::native_host::check_native_host_contract(std::path::Path::new(&root)).to_json()
}

/// native: check Native WebView shell contract for a workspace root.
#[napi]
pub fn check_native_shell_contract_json(root: String) -> String {
    vmz_compiler::native_shell::check_native_shell_contract(std::path::Path::new(&root)).to_json()
}

/// native: check typed Native Capability Bridge contract for a workspace root.
#[napi]
pub fn check_native_bridge_contract_json(root: String) -> String {
    vmz_compiler::native_bridge::check_native_bridge_contract(std::path::Path::new(&root)).to_json()
}

/// native: check NativeAppHost lifecycle contract for a workspace root.
#[napi]
pub fn check_native_lifecycle_contract_json(root: String) -> String {
    vmz_compiler::native_lifecycle::check_native_lifecycle_contract(std::path::Path::new(&root))
        .to_json()
}

/// native: check NativeAppHost full-stack contract for a workspace root.
#[napi]
pub fn check_native_fullstack_contract_json(root: String) -> String {
    vmz_compiler::native_fullstack::check_native_fullstack_contract(std::path::Path::new(&root))
        .to_json()
}

/// native: check NativeSurface contract for a workspace root.
#[napi]
pub fn check_native_surface_contract_json(root: String) -> String {
    vmz_compiler::native_surface::check_native_surface_contract(std::path::Path::new(&root))
        .to_json()
}

/// native: check multi-platform shared Host Profile contract for a workspace root.
#[napi]
pub fn check_multi_platform_contract_json(root: String) -> String {
    vmz_compiler::multi_platform::check_multi_platform_contract(std::path::Path::new(&root))
        .to_json()
}

/// miniprogram: check target-neutral contract for a workspace root.
#[napi]
pub fn check_miniprogram_target_contract_json(root: String) -> String {
    vmz_compiler::miniprogram_target::check_miniprogram_target_contract(std::path::Path::new(&root))
        .to_json()
}

/// profile protocol catalog.
#[napi]
pub fn query_profile_protocol_catalog() -> String {
    vmz_protocol::ProfileProtocolCatalog::v0().to_json()
}

/// check HostProfile / DeliveryProfile protocol for a workspace root.
#[napi]
pub fn check_host_profile_protocol_json(root: String) -> String {
    vmz_compiler::host_profile::check_host_profile_protocol(std::path::Path::new(&root)).to_json()
}

/// check deterministic profile solver for a workspace root.
#[napi]
pub fn check_profile_solver_json(root: String) -> String {
    vmz_compiler::profile_solver::check_profile_solver(std::path::Path::new(&root)).to_json()
}

/// check Unified Executor algebraic scenario for a workspace root.
#[napi]
pub fn check_unified_executor_json(root: String) -> String {
    vmz_compiler::unified_executor::check_unified_executor(std::path::Path::new(&root)).to_json()
}

/// check Lifecycle / Recovery algebraic scenario for a workspace root.
#[napi]
pub fn check_lifecycle_recovery_json(root: String) -> String {
    vmz_compiler::lifecycle_recovery::check_lifecycle_recovery(std::path::Path::new(&root))
        .to_json()
}

/// check Delivery Proof algebraic scenario for a workspace root.
#[napi]
pub fn check_delivery_proof_json(root: String) -> String {
    vmz_compiler::delivery_proof::check_delivery_proof(std::path::Path::new(&root)).to_json()
}

/// check Cross-Host Conformance algebraic scenario for a workspace root.
#[napi]
pub fn check_cross_host_conformance_json(root: String) -> String {
    vmz_compiler::cross_host_conformance::check_cross_host_conformance(std::path::Path::new(&root))
        .to_json()
}

// check host `applications.config.json5` + workspace package descriptors.
/// `package_roots` come from Node workspace resolution (never inferred as gallery membership).
#[napi]
pub fn check_applications_json(host_root: String, package_roots: Vec<String>) -> String {
    let roots: Vec<PathBuf> = package_roots.into_iter().map(PathBuf::from).collect();
    check_applications(PathBuf::from(host_root), &roots).to_json()
}

/// prove independent `/` + non-root ApplicationBase relocation; scan non-relocatable URLs.
#[napi]
pub fn check_application_relocatable_json(
    package_root: String,
    relocate_base: Option<String>,
) -> String {
    check_application_relocatable(PathBuf::from(package_root), relocate_base.as_deref()).to_json()
}

/// apply ApplicationBase to a logical relocation manifest JSON.
#[napi]
pub fn relocate_application_manifest_json(manifest_json: String, base: String) -> Result<String> {
    relocate_manifest_json(&manifest_json, &base).map_err(Error::from_reason)
}

/// independent ApplicationArtifact + MountTable/Catalog boundary (refs only).
#[napi]
pub fn check_application_artifact_boundary_json(
    host_root: String,
    package_roots: Vec<String>,
) -> String {
    let roots: Vec<PathBuf> = package_roots.into_iter().map(PathBuf::from).collect();
    check_application_artifact_boundary(PathBuf::from(host_root), &roots).to_json()
}

/// absolute isolation namespaces + failure containment (503 unavailable).
#[napi]
pub fn check_application_isolation_json(host_root: String, package_roots: Vec<String>) -> String {
    let roots: Vec<PathBuf> = package_roots.into_iter().map(PathBuf::from).collect();
    check_application_isolation(PathBuf::from(host_root), &roots).to_json()
}

/// host catalog consumption + cross-application Link resolution.
#[napi]
pub fn check_application_host_composition_json(
    host_root: String,
    package_roots: Vec<String>,
) -> String {
    let roots: Vec<PathBuf> = package_roots.into_iter().map(PathBuf::from).collect();
    check_application_host_composition(PathBuf::from(host_root), &roots).to_json()
}

/// multi-session affected rebuild + proxy dispatch + mounted tests + deploy adapter.
#[napi]
pub fn check_application_dev_test_deploy_json(
    host_root: String,
    package_roots: Vec<String>,
    dirty_paths: Vec<String>,
) -> String {
    let roots: Vec<PathBuf> = package_roots.into_iter().map(PathBuf::from).collect();
    let dirty: Vec<PathBuf> = dirty_paths.into_iter().map(PathBuf::from).collect();
    check_application_dev_test_deploy(PathBuf::from(host_root), &roots, &dirty).to_json()
}

#[napi]
pub struct JsWorkspace {
    inner: Mutex<Workspace>,
}

#[napi]
impl JsWorkspace {
    #[napi(factory)]
    pub fn create(options: JsWorkspaceOptions) -> Result<Self> {
        let claimed = options.protocol.unwrap_or_else(get_protocol_versions);
        handshake(&owned_protocol(&claimed)).map_err(|e| Error::from_reason(e.to_string()))?;

        let root = PathBuf::from(options.root);
        let out_dir = options.out_dir.map(PathBuf::from).unwrap_or_else(|| root.join("dist"));

        Ok(Self {
            inner: Mutex::new(Workspace::create(WorkspaceOptions {
                root,
                out_dir,
                tw: Some(vmz_plugin_tailwind::default_tw_compiler()),
                scss: Some(vmz_plugin_sasso::default_scss_compiler()),
                runtime_dist: options.runtime_dist.map(PathBuf::from),
            })),
        })
    }

    #[napi]
    pub fn root(&self) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.root().display().to_string())
    }

    #[napi]
    pub fn out_dir(&self) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.out_dir().display().to_string())
    }

    #[napi]
    pub fn contribution_count(&self) -> Result<u32> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.contribution_count() as u32)
    }

    #[napi]
    pub fn update_files(&self, changes: Vec<JsFileChange>) -> Result<()> {
        let mut ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        let mapped: Result<Vec<_>> = changes
            .into_iter()
            .map(|c| {
                let kind = match c.kind.as_str() {
                    "update" | "Update" => ChangeKind::Update,
                    "delete" | "Delete" => ChangeKind::Delete,
                    other => {
                        return Err(Error::from_reason(format!(
                            "unknown change kind `{other}` (expected update|delete)"
                        )));
                    }
                };
                Ok(FileChange { path: PathBuf::from(c.path), kind })
            })
            .collect();
        ws.update_files(mapped?);
        Ok(())
    }

    #[napi]
    pub fn dirty_paths(&self) -> Result<Vec<String>> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.dirty_paths().map(|p| p.display().to_string()).collect())
    }

    /// validate + merge structured plugin contributions (no VPG mutation).
    #[napi]
    pub fn apply_plugin_contributions(
        &self,
        batch: JsContributionBatch,
    ) -> Result<JsApplyContributionsReport> {
        let mut ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        let mapped = map_batch(batch)?;
        let report = ws.apply_plugin_contributions(mapped);
        Ok(JsApplyContributionsReport {
            accepted: report.accepted as u32,
            rejected: report
                .rejected
                .into_iter()
                .map(|r| JsRejection { plugin: r.plugin, item_id: r.item_id, reason: r.reason })
                .collect(),
            diff: JsContributionDiff {
                added: report.diff.added,
                removed: report.diff.removed,
                unchanged: report.diff.unchanged,
            },
        })
    }

    #[napi]
    pub fn check(&self, deny_warnings: Option<bool>) -> Result<JsCheckReport> {
        let mut ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        let report = ws
            .check(&CheckOptions {
                deny_warnings: deny_warnings.unwrap_or(false),
                require_browser_safe_server_slices: false,
            })
            .map_err(|e| Error::from_reason(e.to_string()))?;
        let dirty_count = ws.dirty_paths().count() as u32;
        Ok(JsCheckReport {
            files_checked: report.files_checked as u32,
            diagnostics: report.diagnostics.iter().map(map_diag).collect(),
            dirty_count,
        })
    }

    /// Inspect lint profile: semantic check + convention advice (`vmz-inspector`).
    #[napi]
    pub fn lint(&self, deny_warnings: Option<bool>) -> Result<JsCheckReport> {
        let mut ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        let mut report = ws
            .check(&CheckOptions {
                deny_warnings: deny_warnings.unwrap_or(false),
                require_browser_safe_server_slices: false,
            })
            .map_err(|e| Error::from_reason(e.to_string()))?;
        append_convention_lints(ws.root(), &mut report);
        let dirty_count = ws.dirty_paths().count() as u32;
        Ok(JsCheckReport {
            files_checked: report.files_checked as u32,
            diagnostics: report.diagnostics.iter().map(map_diag).collect(),
            dirty_count,
        })
    }

    /// format workspace `.vmz` files (no cargo spawn).
    #[napi]
    pub fn format(&self, check_only: Option<bool>) -> Result<JsFormatReport> {
        let mut ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        let report = ws
            .format(&vmz_compiler::FormatOptions { check: check_only.unwrap_or(false) })
            .map_err(|e| Error::from_reason(e.to_string()))?;
        Ok(JsFormatReport {
            files_checked: report.files_checked as u32,
            files_written: report.files_written as u32,
            files_need_write: report.files_need_write as u32,
            diagnostics: report.diagnostics.iter().map(map_diag).collect(),
        })
    }

    #[napi]
    pub fn build(
        &self,
        release: Option<bool>,
        analysis_ticket: Option<u32>,
    ) -> Result<JsBuildReport> {
        let mut ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        let report = ws
            .build_with(&BuildRequest {
                release: release.unwrap_or(false),
                analysis_ticket: analysis_ticket.map(u64::from),
            })
            .map_err(|e| Error::from_reason(e.to_string()))?;
        let dirty_count = ws.dirty_paths().count() as u32;
        if report.diagnostics.iter().all(|d| !d.is_error()) {
            ws.clear_dirty();
        }
        Ok(JsBuildReport {
            emitted: report.emitted.iter().map(|p| p.display().to_string()).collect(),
            diagnostics: report.diagnostics.iter().map(map_diag).collect(),
            dirty_count,
            full: report.full,
            affected_sources: report
                .affected_sources
                .iter()
                .map(|p| p.display().to_string())
                .collect(),
            affected_chunks: report.affected_chunks.clone(),
            seed_chunks: report.seed_chunks.clone(),
            island_hmr: report.island_hmr,
        })
    }

    /// session: query which deployment units current dirty set would rebuild.
    #[napi]
    pub fn query_affected(&self) -> Result<JsAffectedPlan> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        let plan = ws.query_affected();
        Ok(JsAffectedPlan {
            full: plan.full,
            rebuild_runtime: plan.rebuild_runtime,
            rebuild_server_tree: plan.rebuild_server_tree,
            seed_chunks: plan.seed_chunks.clone(),
            island_only: plan.island_only(),
            units: plan
                .units
                .iter()
                .map(|u| JsAffectedUnit {
                    source: u.source.display().to_string(),
                    kind: match u.kind {
                        vmz_compiler::VmzModuleKind::App => "app".into(),
                        vmz_compiler::VmzModuleKind::Page => "page".into(),
                        vmz_compiler::VmzModuleKind::Component => "component".into(),
                        vmz_compiler::VmzModuleKind::Other => "other".into(),
                    },
                    chunk_id: u.chunk_id.clone(),
                })
                .collect(),
        })
    }

    #[napi]
    pub fn query_program_graph(&self, source: String) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        ws.query_program_graph(source).map_err(|e| Error::from_reason(e.to_string()))
    }

    /// in-memory session Deployment/VPG index.
    #[napi]
    pub fn query_session_graph(&self) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.query_session_graph())
    }

    #[napi]
    pub fn session_generation(&self) -> Result<u32> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.session_generation() as u32)
    }

    #[napi]
    pub fn explain(&self, target: String) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.explain(&target))
    }

    /// DX protocol catalog (`vmz.dx.v0`).
    #[napi]
    pub fn query_dx_catalog(&self) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.query_dx_catalog())
    }

    /// Umbrella protocol catalog (`vmz.protocol.v0`).
    #[napi]
    pub fn query_protocol_catalog(&self) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.query_protocol_catalog())
    }

    /// Affected as `vmz.dx.affected.v0` JSON document.
    #[napi]
    pub fn query_affected_dx(&self) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.query_affected_dx())
    }

    /// plan rename -> `vmz.dx.workspace_edit.v0` (TextEdits when refs proven).
    #[napi]
    pub fn plan_rename(&self, intent_json: String) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.plan_rename(&intent_json))
    }

    /// atomically apply WorkspaceEditPlan.
    #[napi]
    pub fn apply_workspace_edit(&self, plan_json: String) -> Result<String> {
        let mut ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.apply_workspace_edit(&plan_json))
    }

    /// test selection for current dirty/affected set (`vmz.dx.test_selection.v0`).
    #[napi]
    pub fn select_tests_affected(&self) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.select_tests_affected())
    }

    /// rename causal explain chain.
    #[napi]
    pub fn explain_rename_chain(&self, intent_json: String) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.explain_rename_chain(&intent_json))
    }

    /// Symbol/Reference index + source map + safe_fix report.
    #[napi]
    pub fn check_cross_sfc(&self) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.check_cross_sfc())
    }

    /// Symbol index document JSON.
    #[napi]
    pub fn query_symbols(&self) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.query_symbols())
    }

    /// references for `kind:id`.
    #[napi]
    pub fn query_references(&self, target: String) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.query_references(&target))
    }

    /// CodeAction list JSON.
    #[napi]
    pub fn list_code_actions(&self) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.list_code_actions())
    }

    /// atomic TextEdit batch (`vmz.dx.semantic_transaction.v0`).
    #[napi]
    pub fn apply_semantic_transaction(&self, edits_json: String) -> Result<String> {
        let mut ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.apply_semantic_transaction(&edits_json))
    }

    /// open analysis ticket (`vmz.dx.cancel.v0`).
    #[napi]
    pub fn begin_analysis(&self) -> Result<String> {
        let mut ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.begin_analysis())
    }

    /// cancel analysis ticket.
    #[napi]
    pub fn cancel_analysis(&self, ticket_id: u32) -> Result<String> {
        let mut ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.cancel_analysis(u64::from(ticket_id)))
    }

    /// affected preview JSON.
    #[napi]
    pub fn query_affected_preview(&self) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.query_affected_preview())
    }

    /// HMR plan JSON.
    #[napi]
    pub fn query_hmr_plan(&self) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.query_hmr_plan())
    }

    /// route/chunk budget JSON.
    #[napi]
    pub fn query_budget(&self) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.query_budget())
    }

    /// umbrella incremental DX report.
    #[napi]
    pub fn check_transaction(&self) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.check_transaction())
    }

    /// boundary validators JSON (`vmz.dx.boundary_validator.v0`).
    #[napi]
    pub fn query_boundary_validators(&self) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.query_boundary_validators())
    }

    /// leakage findings JSON (`vmz.dx.leakage.v0`).
    #[napi]
    pub fn query_leakage(&self) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.query_leakage())
    }

    /// capability targets JSON (`vmz.dx.capability_target.v0`).
    #[napi]
    pub fn query_capability_targets(&self) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.query_capability_targets())
    }

    /// dead graph JSON (`vmz.dx.dead_graph.v0`).
    #[napi]
    pub fn query_dead_graph(&self) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.query_dead_graph())
    }

    /// umbrella deployment proof (`vmz.dx.deployment_proof_check.v0`).
    #[napi]
    pub fn check_deployment_proof(&self) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.check_deployment_proof())
    }

    /// ingest StableId trace JSON (`vmz.dx.trace.v0`).
    #[napi]
    pub fn ingest_runtime_trace(&self, trace_json: String) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.ingest_runtime_trace(&trace_json))
    }

    /// causal replay JSON (`vmz.dx.causal_replay.v0`).
    #[napi]
    pub fn replay_causal(&self, trace_json: String) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.replay_causal(&trace_json))
    }

    /// umbrella deep-explain report (`vmz.dx.causal_replay_check.v0`).
    #[napi]
    pub fn check_causal_replay(&self) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.check_causal_replay())
    }

    /// miniprogram: target-neutral contract check JSON.
    #[napi]
    pub fn check_miniprogram_target_contract(&self) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.check_miniprogram_target_contract())
    }

    /// HostProfile / DeliveryProfile protocol check.
    #[napi]
    pub fn check_host_profile_protocol(&self) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.check_host_profile_protocol())
    }

    /// deterministic Surface/capability/route solver check.
    #[napi]
    pub fn check_profile_solver(&self) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.check_profile_solver())
    }

    /// Unified Executor algebraic check.
    #[napi]
    pub fn check_unified_executor(&self) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.check_unified_executor())
    }

    /// Lifecycle / Recovery algebraic check JSON.
    #[napi]
    pub fn check_lifecycle_recovery(&self) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.check_lifecycle_recovery())
    }

    /// Delivery Proof algebraic check JSON.
    #[napi]
    pub fn check_delivery_proof(&self) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.check_delivery_proof())
    }

    /// Cross-Host Conformance algebraic check JSON.
    #[napi]
    pub fn check_cross_host_conformance(&self) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.check_cross_host_conformance())
    }

    /// profile protocol catalog JSON.
    #[napi]
    pub fn query_profile_catalog(&self) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.query_profile_catalog())
    }

    /// miniprogram: target protocol catalog JSON.
    #[napi]
    pub fn query_target_catalog(&self) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.query_target_catalog())
    }

    /// native: NativeSurface contract check.
    #[napi]
    pub fn check_native_surface_contract(&self) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.check_native_surface_contract())
    }

    /// native: multi-platform shared Host Profile contract check.
    #[napi]
    pub fn check_multi_platform_contract(&self) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.check_multi_platform_contract())
    }

    /// native: NativeAppHost full-stack contract check.
    #[napi]
    pub fn check_native_fullstack_contract(&self) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.check_native_fullstack_contract())
    }

    /// native: NativeAppHost lifecycle contract check.
    #[napi]
    pub fn check_native_lifecycle_contract(&self) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.check_native_lifecycle_contract())
    }

    /// native: typed Native Capability Bridge contract check.
    #[napi]
    pub fn check_native_bridge_contract(&self) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.check_native_bridge_contract())
    }

    /// native: Native WebView shell contract check.
    #[napi]
    pub fn check_native_shell_contract(&self) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.check_native_shell_contract())
    }

    /// native: NativeAppHost / WebView contract check.
    #[napi]
    pub fn check_native_host_contract(&self) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.check_native_host_contract())
    }

    /// native: native-host catalog.
    #[napi]
    pub fn query_native_host_catalog(&self) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.query_native_host_catalog())
    }

    #[napi]
    pub fn dispose(&self) -> Result<()> {
        let mut ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        ws.clear_dirty();
        Ok(())
    }
}
