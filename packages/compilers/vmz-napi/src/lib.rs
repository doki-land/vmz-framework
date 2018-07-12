//! Node N-API bindings for the VMZ workspace session.
//!
//! Coarse-grained only; no per-AST JS callbacks.

#![deny(missing_docs)]
use std::path::PathBuf;
use std::sync::Mutex;

use napi::bindgen_prelude::*;
use napi_derive::napi;
use vmz_compiler::{
    BuildRequest, ChangeKind, CheckOptions, ContributionBatch, ContributionItem, ContributionKind,
    FileChange, PROTOCOL, PluginIdentity, PluginStage, ProtocolVersionsOwned, Workspace,
    WorkspaceOptions, check_application_artifact_boundary, check_application_dev_test_deploy,
    check_application_host_composition, check_application_isolation, check_application_relocatable,
    check_applications, handshake, parse_severity, relocate_manifest_json,
};
use vmz_inspector::append_convention_lints;
use vmz_protocol::ApplicationProtocolCatalog;

/// Protocol version strings claimed by host and compiler (handshake payload).
#[napi(object)]
pub struct JsProtocolVersions {
    /// Host-side protocol id (e.g. Node CLI / IDE host).
    pub host_protocol: String,
    /// Compiler protocol id expected by this native addon.
    pub compiler_protocol: String,
    /// Program IR schema version string.
    pub program_ir_schema: String,
    /// Plugin contribution protocol version string.
    pub plugin_protocol: String,
}

/// One file change to apply to the workspace dirty set.
#[napi(object)]
pub struct JsFileChange {
    /// Absolute or workspace-relative path of the changed file.
    pub path: String,
    /// `"update"` | `"delete"`
    pub kind: String,
}

/// Single diagnostic surfaced to JS (path + severity + message).
#[napi(object)]
pub struct JsDiagnostic {
    /// Source path associated with the diagnostic (may be synthetic).
    pub path: String,
    /// `"error"` | `"warning"` | `"advice"`.
    pub severity: String,
    /// Human-readable diagnostic text.
    pub message: String,
}

/// Result of [`JsWorkspace::check`] / [`JsWorkspace::lint`].
#[napi(object)]
pub struct JsCheckReport {
    /// Number of files visited by the check pass.
    pub files_checked: u32,
    /// Collected diagnostics for this pass.
    pub diagnostics: Vec<JsDiagnostic>,
    /// Remaining dirty paths after the pass.
    pub dirty_count: u32,
}

/// Result of [`JsWorkspace::build`].
#[napi(object)]
pub struct JsBuildReport {
    /// Absolute paths of emitted artifacts.
    pub emitted: Vec<String>,
    /// Diagnostics produced during the build.
    pub diagnostics: Vec<JsDiagnostic>,
    /// Dirty path count after the build (cleared when no errors).
    pub dirty_count: u32,
    /// True when the build rebuilt the full graph (not incremental).
    pub full: bool,
    /// Source paths included in the affected set.
    pub affected_sources: Vec<String>,
    /// Chunk ids included in the affected set.
    pub affected_chunks: Vec<String>,
    /// Seed chunk ids that drove incremental selection.
    pub seed_chunks: Vec<String>,
    /// True when only island HMR units were selected.
    pub island_hmr: bool,
}

/// One deployment unit from [`JsWorkspace::query_affected`].
#[napi(object)]
pub struct JsAffectedUnit {
    /// Source path for this unit.
    pub source: String,
    /// Unit kind label (compiler `as_str`).
    pub kind: String,
    /// Chunk id owning this unit.
    pub chunk_id: String,
}

/// Incremental rebuild plan for the current dirty set.
#[napi(object)]
pub struct JsAffectedPlan {
    /// True when a full rebuild is required.
    pub full: bool,
    /// Whether the shared runtime bundle must rebuild.
    pub rebuild_runtime: bool,
    /// Whether the server tree must rebuild.
    pub rebuild_server_tree: bool,
    /// Affected units selected for rebuild.
    pub units: Vec<JsAffectedUnit>,
    /// Seed chunk ids for the plan.
    pub seed_chunks: Vec<String>,
    /// True when only island units are affected.
    pub island_only: bool,
}

/// Result of [`JsWorkspace::format`].
#[napi(object)]
pub struct JsFormatReport {
    /// Files examined by the formatter.
    pub files_checked: u32,
    /// Files written when not in check-only mode.
    pub files_written: u32,
    /// Files that would need a write under `--check`.
    pub files_need_write: u32,
    /// Formatter diagnostics.
    pub diagnostics: Vec<JsDiagnostic>,
}

/// Options for [`JsWorkspace::create`].
#[napi(object)]
pub struct JsWorkspaceOptions {
    /// Workspace / project root directory.
    pub root: String,
    /// Emit directory (defaults to `<root>/dist`).
    pub out_dir: Option<String>,
    /// Optional protocol claim; defaults to this addon's [`get_protocol_versions`].
    pub protocol: Option<JsProtocolVersions>,
    /// Absolute path to `@vmz/core` dist/ (Node resolves via npm).
    pub runtime_dist: Option<String>,
}

/// One structured plugin contribution item (source / analyzer / target / graph_mutation).
#[napi(object)]
pub struct JsContributionItem {
    /// Stable item id within the batch.
    pub id: String,
    /// `source` | `analyzer` | `target` | `graph_mutation`
    pub kind: String,
    /// Path for source/analyzer items.
    pub path: Option<String>,
    /// Source file contents when `kind` is `source`.
    pub content: Option<String>,
    /// Content hash for source materialization / cache keys.
    pub content_hash: Option<String>,
    /// Whether to materialize source onto disk (default true).
    pub materialize: Option<bool>,
    /// Analyzer severity string (`error` | `warning` | `advice`).
    pub severity: Option<String>,
    /// Analyzer message text.
    pub message: Option<String>,
    /// Optional analyzer diagnostic code.
    pub code: Option<String>,
    /// Target contribution id.
    pub target_id: Option<String>,
    /// Target contribution kind label.
    pub target_kind: Option<String>,
    /// Target manifest as a JSON object string.
    pub manifest_json: Option<String>,
    /// Detail string for graph_mutation items.
    pub detail: Option<String>,
}

/// Plugin contribution batch applied via [`JsWorkspace::apply_plugin_contributions`].
#[napi(object)]
pub struct JsContributionBatch {
    /// Plugin package / identity name.
    pub plugin_name: String,
    /// Plugin semver string.
    pub plugin_version: String,
    /// Plugin protocol version claimed by the batch.
    pub protocol: String,
    /// `workspace_resolve` | `source_adapter` | `analyzer` | `target`
    pub stage: String,
    /// Deterministic cache key for this batch.
    pub cache_key: String,
    /// Whether the batch is marked deterministic (default true).
    pub deterministic: Option<bool>,
    /// Contribution items in this batch.
    pub items: Vec<JsContributionItem>,
}

/// One rejected contribution item from apply.
#[napi(object)]
pub struct JsRejection {
    /// Plugin name that produced the item.
    pub plugin: String,
    /// Rejected item id.
    pub item_id: String,
    /// Human-readable rejection reason.
    pub reason: String,
}

/// Diff of contribution ids after a successful apply merge.
#[napi(object)]
pub struct JsContributionDiff {
    /// Newly accepted contribution ids.
    pub added: Vec<String>,
    /// Contribution ids removed by this apply.
    pub removed: Vec<String>,
    /// Contribution ids unchanged across the apply.
    pub unchanged: Vec<String>,
}

/// Report from [`JsWorkspace::apply_plugin_contributions`].
#[napi(object)]
pub struct JsApplyContributionsReport {
    /// Number of items accepted into the workspace.
    pub accepted: u32,
    /// Items rejected with reasons.
    pub rejected: Vec<JsRejection>,
    /// Id-level diff against the prior contribution set.
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
            "analyzer" => {
                let raw = it.severity.unwrap_or_else(|| "warning".into());
                let severity = parse_severity(&raw).ok_or_else(|| {
                    Error::from_reason(format!(
                        "unknown analyzer severity `{raw}` (error|warning|advice)"
                    ))
                })?;
                ContributionKind::Analyzer {
                    path: PathBuf::from(it.path.unwrap_or_else(|| "<plugin>".into())),
                    severity,
                    message: it
                        .message
                        .ok_or_else(|| Error::from_reason("analyzer.message required"))?,
                    code: it.code,
                }
            }
            "target" => {
                let manifest_raw = it
                    .manifest_json
                    .ok_or_else(|| Error::from_reason("target.manifestJson required"))?;
                let manifest: serde_json::Value = serde_json::from_str(&manifest_raw)
                    .map_err(|e| Error::from_reason(format!("target.manifestJson: {e}")))?;
                if !manifest.is_object() {
                    return Err(Error::from_reason("target.manifestJson must be a JSON object"));
                }
                ContributionKind::Target {
                    target_id: it
                        .target_id
                        .ok_or_else(|| Error::from_reason("target.targetId required"))?,
                    target_kind: it
                        .target_kind
                        .ok_or_else(|| Error::from_reason("target.targetKind required"))?,
                    manifest,
                }
            }
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

/// Return the protocol versions this native addon was built against.
#[napi]
pub fn get_protocol_versions() -> JsProtocolVersions {
    JsProtocolVersions {
        host_protocol: PROTOCOL.host_protocol.into(),
        compiler_protocol: PROTOCOL.compiler_protocol.into(),
        program_ir_schema: PROTOCOL.program_ir_schema.into(),
        plugin_protocol: PROTOCOL.plugin_protocol.into(),
    }
}

/// Fail if the host-claimed protocol versions are incompatible with this addon.
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

/// miniprogram: lower TemplateSurface static slice (template + logic data).
#[napi]
pub fn lower_miniprogram_static_slice_json(root: String) -> String {
    vmz_compiler::miniprogram_static_slice::lower_miniprogram_static_slices(std::path::Path::new(
        &root,
    ))
    .to_json()
}

/// miniprogram: lower BindingId patch + event table.
#[napi]
pub fn lower_miniprogram_binding_event_json(root: String) -> String {
    vmz_compiler::miniprogram_binding_event::lower_miniprogram_binding_event_slices(
        std::path::Path::new(&root),
    )
    .to_json()
}

/// miniprogram: lower structure + lifecycle/dispose tables.
#[napi]
pub fn lower_miniprogram_structure_json(root: String) -> String {
    vmz_compiler::miniprogram_structure::lower_miniprogram_structure_slices(std::path::Path::new(
        &root,
    ))
    .to_json()
}

/// miniprogram: lower Route + `#server` stubs + Canonical Style.
#[napi]
pub fn lower_miniprogram_route_server_style_json(root: String) -> String {
    vmz_compiler::miniprogram_route_server_style::lower_miniprogram_route_server_style_slices(
        std::path::Path::new(&root),
    )
    .to_json()
}

/// miniprogram: tooling deploy package + Mini Host handoff.
#[napi]
pub fn lower_miniprogram_tooling_deploy_json(root: String) -> String {
    vmz_compiler::miniprogram_tooling_deploy::lower_miniprogram_tooling_deploy(
        std::path::Path::new(&root),
    )
    .to_json()
}

/// miniprogram: multi-adapter (≥2 packaging stubs) conformance.
#[napi]
pub fn lower_miniprogram_multi_adapter_json(root: String) -> String {
    vmz_compiler::miniprogram_multi_adapter::lower_miniprogram_multi_adapter(std::path::Path::new(
        &root,
    ))
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

/// Mutex-backed workspace session exposed to Node (check / build / DX queries).
#[napi]
pub struct JsWorkspace {
    inner: Mutex<Workspace>,
}

#[napi]
impl JsWorkspace {
    /// Create a workspace after protocol handshake; links production TW + SCSS compilers.
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

    /// Absolute project root path for this session.
    #[napi]
    pub fn root(&self) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.root().display().to_string())
    }

    /// Absolute emit / artifact directory for this session.
    #[napi]
    pub fn out_dir(&self) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.out_dir().display().to_string())
    }

    /// Number of accepted plugin contributions currently held by the session.
    #[napi]
    pub fn contribution_count(&self) -> Result<u32> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.contribution_count() as u32)
    }

    /// Apply file update/delete notifications to the dirty set.
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

    /// List currently dirty paths as display strings.
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

    /// Run semantic check on the workspace (hard errors; optional deny-warnings).
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

    /// Emit project artifacts; clears dirty when the build has no errors.
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
                    kind: u.kind.as_str().into(),
                    chunk_id: u.chunk_id.clone(),
                })
                .collect(),
        })
    }

    /// Serialize the program graph for one source path as JSON.
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

    /// Monotonic session generation counter (increments on structural session changes).
    #[napi]
    pub fn session_generation(&self) -> Result<u32> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.session_generation() as u32)
    }

    /// Explain a StableId / target string using the session explain pipeline.
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

    /// miniprogram: TemplateSurface static slice JSON.
    #[napi]
    pub fn lower_miniprogram_static_slice(&self) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.lower_miniprogram_static_slice())
    }

    /// miniprogram: BindingId patch + event table JSON.
    #[napi]
    pub fn lower_miniprogram_binding_event(&self) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.lower_miniprogram_binding_event())
    }

    /// miniprogram: structure + lifecycle/dispose JSON.
    #[napi]
    pub fn lower_miniprogram_structure(&self) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.lower_miniprogram_structure())
    }

    /// miniprogram: Route + `#server` + Canonical Style JSON.
    #[napi]
    pub fn lower_miniprogram_route_server_style(&self) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.lower_miniprogram_route_server_style())
    }

    /// miniprogram: tooling deploy package + Mini Host handoff JSON.
    #[napi]
    pub fn lower_miniprogram_tooling_deploy(&self) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.lower_miniprogram_tooling_deploy())
    }

    /// miniprogram: multi-adapter (≥2 packaging stubs) JSON.
    #[napi]
    pub fn lower_miniprogram_multi_adapter(&self) -> Result<String> {
        let ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        Ok(ws.lower_miniprogram_multi_adapter())
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

    /// Release session bookkeeping (clears the dirty set; does not drop the handle).
    #[napi]
    pub fn dispose(&self) -> Result<()> {
        let mut ws = self.inner.lock().map_err(|_| Error::from_reason("workspace lock"))?;
        ws.clear_dirty();
        Ok(())
    }
}

/// One component entry for [`generate_serve_entry_client`].
#[napi(object)]
pub struct JsEntryComponent {
    /// Export / register name.
    pub name: String,
    /// Relative module path without leading `./`.
    pub entry: String,
}

/// Generate `entry-client.js` via `vmz-generator` (oxc reprint).
#[napi]
pub fn generate_serve_entry_client(
    eager: Vec<JsEntryComponent>,
    lazy: Vec<JsEntryComponent>,
    cache_query: String,
) -> String {
    let eager: Vec<_> = eager
        .into_iter()
        .map(|e| vmz_generator::js::EntryComponent { name: e.name, entry: e.entry })
        .collect();
    let lazy: Vec<_> = lazy
        .into_iter()
        .map(|e| vmz_generator::js::EntryComponent { name: e.name, entry: e.entry })
        .collect();
    vmz_generator::js::emit_serve_entry_client(&eager, &lazy, &cache_query).code
}

/// Generate `entry-event.js` via `vmz-generator` (oxc reprint).
#[napi]
pub fn generate_serve_entry_event(cache_query: String) -> String {
    vmz_generator::js::emit_serve_entry_event(&cache_query).code
}

/// Hreflang alternate for [`generate_page_shell`].
#[napi(object)]
pub struct JsHreflangAlternate {
    /// `hreflang` attribute.
    pub hreflang: String,
    /// Absolute `href`.
    pub href: String,
}

/// SEO meta for [`generate_page_shell`].
#[napi(object)]
pub struct JsPageShellMeta {
    /// Document title.
    pub title: String,
    /// Meta description.
    pub description: String,
    /// Canonical URL.
    pub canonical: String,
    /// Robots content.
    pub robots: String,
    /// `html[lang]` / locale id.
    pub lang: String,
    /// `dir` (`ltr` / `rtl`).
    pub dir: String,
    /// Optional hreflang alternates.
    pub alternates: Option<Vec<JsHreflangAlternate>>,
}

/// Input for [`generate_page_shell`].
#[napi(object)]
pub struct JsPageShellInput {
    /// Trusted SSR / static body HTML.
    pub body_html: String,
    /// `data-vmz-page` chunk id.
    pub chunk_id: String,
    /// Layout chain chunk ids.
    pub layout_chain: Vec<String>,
    /// Already-stringified props JSON.
    pub props_json: String,
    /// Head meta.
    pub meta: JsPageShellMeta,
    /// Optional CSS entry (e.g. `vmz.css`).
    pub css_entry: Option<String>,
    /// Omit entry-client when true.
    pub is_error_document: Option<bool>,
}

/// Generate production page HTML shell via MarkupCodeGenerator.
#[napi]
pub fn generate_page_shell(input: JsPageShellInput) -> String {
    let meta = vmz_generator::PageShellMeta {
        title: input.meta.title,
        description: input.meta.description,
        canonical: input.meta.canonical,
        robots: input.meta.robots,
        lang: input.meta.lang,
        dir: input.meta.dir,
        alternates: input
            .meta
            .alternates
            .unwrap_or_default()
            .into_iter()
            .map(|a| vmz_generator::HreflangAlternate { hreflang: a.hreflang, href: a.href })
            .collect(),
    };
    vmz_generator::emit_page_shell(&vmz_generator::PageShellInput {
        body_html: input.body_html,
        chunk_id: input.chunk_id,
        layout_chain: input.layout_chain,
        props_json: input.props_json,
        meta,
        css_entry: input.css_entry,
        is_error_document: input.is_error_document.unwrap_or(false),
    })
}

/// One sitemap URL for [`generate_sitemap_xml`].
#[napi(object)]
pub struct JsSitemapUrl {
    /// Absolute loc URL.
    pub loc: String,
}

/// Generate `sitemap.xml` via MarkupCodeGenerator.
#[napi]
pub fn generate_sitemap_xml(urls: Vec<JsSitemapUrl>) -> String {
    let urls: Vec<_> = urls.into_iter().map(|u| vmz_generator::SitemapUrl { loc: u.loc }).collect();
    vmz_generator::emit_sitemap_xml(&urls)
}

/// Input for [`generate_html_shell`].
#[napi(object)]
pub struct JsHtmlShellInput {
    /// Document title.
    pub title: String,
    /// `html[lang]`.
    pub lang: String,
    /// Stylesheet hrefs.
    pub css_hrefs: Option<Vec<String>>,
    /// Trusted body HTML.
    pub body_html: String,
    /// Body attribute pairs `[name, value, …]` flattened (even length).
    pub body_attrs: Option<Vec<String>>,
}

/// Generate a generic HTML5 shell via MarkupCodeGenerator.
#[napi]
pub fn generate_html_shell(input: JsHtmlShellInput) -> String {
    let mut body_attrs = Vec::new();
    let flat = input.body_attrs.unwrap_or_default();
    let mut i = 0;
    while i + 1 < flat.len() {
        body_attrs.push((flat[i].clone(), flat[i + 1].clone()));
        i += 2;
    }
    vmz_generator::emit_html_shell(&vmz_generator::HtmlShellInput {
        title: input.title,
        lang: input.lang,
        css_hrefs: input.css_hrefs.unwrap_or_default(),
        body_html: input.body_html,
        body_attrs,
        body_nodes: vec![],
        head_extra: vec![],
    })
}

/// Input for [`generate_redirect_html`].
#[napi(object)]
pub struct JsRedirectHtmlInput {
    /// `html[lang]`.
    pub lang: String,
    /// Redirect target URL.
    pub target: String,
    /// Document title.
    pub title: String,
    /// Optional visible link label.
    pub link_label: Option<String>,
}

/// Generate a meta-refresh redirect HTML page.
#[napi]
pub fn generate_redirect_html(input: JsRedirectHtmlInput) -> String {
    vmz_generator::emit_redirect_html(&vmz_generator::RedirectHtmlInput {
        lang: input.lang,
        target: input.target,
        title: input.title,
        link_label: input.link_label.unwrap_or_default(),
    })
}

/// One locale export for [`generate_locale_runtime_module`].
#[napi(object)]
pub struct JsLocaleExport {
    /// JS export name.
    pub export_name: String,
    /// Flattened variants as `[localeId, template, …]` pairs.
    pub variants: Vec<Vec<String>>,
    /// Whether the function takes `args`.
    pub has_params: bool,
}

/// Generate `dist/locales/*.js` via JsCodeGenerator (oxc reprint).
#[napi]
pub fn generate_locale_runtime_module(
    default_locale: String,
    exports: Vec<JsLocaleExport>,
) -> String {
    let exports: Vec<_> = exports
        .into_iter()
        .map(|e| {
            let mut variants = Vec::new();
            for pair in e.variants {
                if pair.len() >= 2 {
                    variants.push((pair[0].clone(), pair[1].clone()));
                }
            }
            vmz_generator::js::LocaleExport {
                export_name: e.export_name,
                variants,
                has_params: e.has_params,
            }
        })
        .collect();
    vmz_generator::js::emit_locale_runtime_module(&default_locale, &exports).code
}

/// Pretty-print a JSON document via JsonCodeGenerator.
///
/// `json_text` must be valid compact or pretty JSON (typically `JSON.stringify(value)`).
/// Returns pretty-printed JSON **without** a trailing newline (callers add `\n` when writing files).
#[napi]
pub fn generate_pretty_json(json_text: String) -> Result<String> {
    let value: serde_json::Value = serde_json::from_str(&json_text)
        .map_err(|e| Error::from_reason(format!("generatePrettyJson: invalid JSON: {e}")))?;
    vmz_generator::to_pretty_json(&value)
        .map_err(|e| Error::from_reason(format!("generatePrettyJson: {e}")))
}

/// Compact JSON via JsonCodeGenerator (same parse → print contract as pretty).
#[napi]
pub fn generate_json(json_text: String) -> Result<String> {
    let value: serde_json::Value = serde_json::from_str(&json_text)
        .map_err(|e| Error::from_reason(format!("generateJson: invalid JSON: {e}")))?;
    vmz_generator::to_json(&value).map_err(|e| Error::from_reason(format!("generateJson: {e}")))
}
