//! Compile `.vmz` paths or projects into JS, routes, and deployment artifacts.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::affected::{AffectedPlan, chunk_id_for, plan_affected};
use crate::analyze::analyze_script;
use crate::check::{CheckOptions, check_path};
use crate::diagnostic::ReportedDiagnostic;
use crate::emit::{ServerBridge, emit_server_js};
use crate::project::{VmzModuleKind, discover_vmz_files};
use crate::scss::{ScssCompilerHandle, ScssEmitRequest};
use crate::sfc::{ScriptKind, parse_vmz};
use crate::template::{
    lower_concrete_to_ir, lower_concrete_to_semantic, parse_template_concrete,
    template_parse_to_diagnostic,
};
use crate::tw::{TwCompilerHandle, TwEmitRequest, register_tw_from_parsed};
use crate::virtual_server;
use vmz_protocol::SourceSpan;
use vmz_types::{DeploymentClientCall, DeploymentView, ProgramModule, StubStatus};
use walkdir::WalkDir;

/// Schema id written into `vmz-deployment.json`.
pub const DEPLOYMENT_SCHEMA: &str = "vmz.deployment.v0";

/// Compile session options (out dir, release, style plugins, runtime dist).
#[derive(Clone)]
pub struct CompileOptions {
    /// Output directory for JS / JSON artifacts.
    pub out_dir: PathBuf,
    /// Production emit (omits local serve-host from copied runtime).
    pub release: bool,
    /// TW style plugin. `None` skips TW emit.
    pub tw: Option<TwCompilerHandle>,
    /// SCSS style plugin. `None` skips `<style>` emit.
    pub scss: Option<ScssCompilerHandle>,
    /// `@vmz/core` / `vmz-runtime` `dist/` directory. When `None`, fall back to
    /// monorepo path relative to this crate (dev / cargo-only builds).
    pub runtime_dist: Option<PathBuf>,
}

impl Default for CompileOptions {
    fn default() -> Self {
        Self {
            out_dir: PathBuf::from("dist"),
            release: false,
            tw: None,
            scss: None,
            runtime_dist: None,
        }
    }
}

impl std::fmt::Debug for CompileOptions {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CompileOptions")
            .field("out_dir", &self.out_dir)
            .field("release", &self.release)
            .field("tw", &self.tw.as_ref().map(|_| "Some(TwCompiler)"))
            .field("scss", &self.scss.as_ref().map(|_| "Some(ScssCompiler)"))
            .field("runtime_dist", &self.runtime_dist)
            .finish()
    }
}

/// One HTTP route row written to `vmz-routes.json`.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct EmittedRoute {
    /// Uppercase HTTP verb.
    pub verb: String,
    /// Route path template.
    pub path: String,
    /// Virtual `#server/...` module id.
    pub module_id: String,
    /// Server method name.
    pub method: String,
    /// Server class name.
    pub class_name: String,
}

/// One client->server call listed on a deployment unit.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentCallWire {
    /// Server method name.
    pub method: String,
    /// Optional client method that issued the call.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from_client_method: Option<String>,
}

/// One Island resume entry listed on a deployment unit.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentResumeWire {
    /// Component tag / name.
    pub component: String,
    /// Resume strategy (`load`, `idle`, ...).
    pub strategy: String,
}

/// One unit row inside [`DeploymentDocument`].
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentUnitWire {
    /// Stable chunk id.
    pub chunk_id: String,
    /// Module kind (closed unit enum).
    pub kind: crate::project::VmzModuleKind,
    /// Workspace-relative source path.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub source: String,
    /// Client JS entry relative to out_dir.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub client_entry: String,
    /// Program IR path relative to out_dir.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub program_ir: String,
    /// Forward dependency chunk ids.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub depends_on: Vec<String>,
    /// Reverse dependency chunk ids.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub depended_by: Vec<String>,
    /// Control region ids.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub region_ids: Vec<u32>,
    /// Server capability method names.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub capabilities: Vec<String>,
    /// Virtual `#server/...` module id when present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_module_id: Option<String>,
    /// Client->server call edges.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub client_calls: Vec<DeploymentCallWire>,
    /// Island resume entries.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub resume_entries: Vec<DeploymentResumeWire>,
    /// Browser HTTP path pattern (`/` / `/home` / `/users/:id`). Mini pack ignores this.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub path_pattern: String,
    /// Stable RouteId when this unit is a page.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub route_id: String,
    /// SSR / hydrate layout chunk ids outer→inner (Application shell then nested Layout).
    /// Always emitted on page units (may be empty) so hosts do not re-walk the filesystem.
    #[serde(default)]
    pub layout_chain: Vec<String>,
    /// True when this unit was rebuilt in the current plan.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub rebuilt: bool,
}

/// Wire document for `vmz-deployment.json`.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentDocument {
    /// Always [`DEPLOYMENT_SCHEMA`].
    pub schema: String,
    /// All known units in the project catalog.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub units: Vec<DeploymentUnitWire>,
    /// Chunk ids rebuilt this round.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub affected_chunks: Vec<String>,
    /// Dirty seed chunks before reverse expansion.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub seed_chunks: Vec<String>,
    /// Island-only HMR eligibility for this plan.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub island_hmr: bool,
    /// Project stylesheet relative to out_dir.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub css_entry: Option<String>,
    /// Style Theme summary when designs are present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style_theme: Option<crate::designs::StyleThemeSummary>,
    /// Style bundle fingerprint.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style_bundle_hash: Option<String>,
    /// Whether this emit covered the full project.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub full: bool,
}

/// Per-method read/write summary inside [`VmzMetaDocument`].
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct MethodRwWire {
    /// Field / path reads.
    pub reads: Vec<String>,
    /// Field / path writes.
    pub writes: Vec<String>,
    /// True when the method is `async` (event flush must not assume sync drain).
    #[serde(rename = "async", default, skip_serializing_if = "std::ops::Not::not")]
    pub async_: bool,
}

/// Per-file meta document (`*.vmz.json`) for tooling.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct VmzMetaDocument {
    /// Source `.vmz` path.
    pub file: String,
    /// Default-exported client class name.
    pub client: String,
    /// Co-located server class name when present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server: Option<String>,
    /// Virtual `#server/...` module id when present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server_module: Option<String>,
    /// Template root count.
    pub template_roots: usize,
    /// Method name -> read/write summary.
    #[serde(default)]
    pub method_rw: std::collections::BTreeMap<String, MethodRwWire>,
}

/// Outcome of a compile session (diagnostics, outputs, and incremental metadata).
#[derive(Debug, Default)]
pub struct CompileReport {
    /// Diagnostics produced during check / emit (may include errors and warnings).
    pub diagnostics: Vec<ReportedDiagnostic>,
    /// Absolute paths of files written this round (JS, JSON, CSS, etc.).
    pub emitted: Vec<PathBuf>,
    /// Routes realized into `routes.json` / deployment metadata.
    pub routes: Vec<EmittedRoute>,
    /// session: whether this was a full project emit.
    pub full: bool,
    /// session: source `.vmz` paths rebuilt this round.
    pub affected_sources: Vec<PathBuf>,
    /// session: deployment chunk ids rebuilt this round.
    pub affected_chunks: Vec<String>,
    /// dirty seeds before reverse-edge expansion.
    pub seed_chunks: Vec<String>,
    /// all affected units are components (island HMR eligible).
    pub island_hmr: bool,
    /// Project stylesheet relative to out_dir (e.g. `vmz.css`).
    pub css_entry: Option<String>,
    /// Absolute paths of style assets written this round.
    pub style_assets: Vec<PathBuf>,
    /// Style Theme summary for deployment (language-agnostic).
    pub style_theme: Option<crate::designs::StyleThemeSummary>,
    /// Fingerprint of style inputs (theme + designs styles + all TW regs + SFC `<style>`).
    pub style_bundle_hash: Option<String>,
    /// TW tokens registered while emitting units.
    pub tw_registrations: Vec<crate::tw::TwRegistration>,
    /// Relative paths under `out_dir` written this round (generation write-set).
    pub written_outputs: Vec<String>,
    /// Stable digest of deployment, routes, and written artifact bytes (dev artifact diff).
    pub output_revision: String,
    /// Whether browsers should soft-reload after this build (dev convergence).
    pub reload_required: bool,
}

/// Compile a single `.vmz` file or a project root directory.
pub fn compile_path(
    path: impl AsRef<Path>,
    options: &CompileOptions,
) -> crate::Result<CompileReport> {
    let path = path.as_ref();
    let check = check_path(path, &CheckOptions::default())?;
    if check.has_errors() {
        return Ok(CompileReport {
            diagnostics: check.diagnostics,
            emitted: Vec::new(),
            routes: Vec::new(),
            full: true,
            affected_sources: Vec::new(),
            affected_chunks: Vec::new(),
            seed_chunks: Vec::new(),
            island_hmr: false,
            css_entry: None,
            style_assets: Vec::new(),
            style_theme: None,
            style_bundle_hash: None,
            tw_registrations: Vec::new(),
            written_outputs: Vec::new(),
            output_revision: String::new(),
            reload_required: false,
        });
    }

    if path.is_file() {
        let mut report = CompileReport {
            full: true,
            affected_sources: vec![path.to_path_buf()],
            ..CompileReport::default()
        };
        fs::create_dir_all(&options.out_dir)?;
        emit_runtime_js(options, &mut report)?;
        let src_root = path.parent().and_then(|p| p.parent()).unwrap_or(path);
        let kind = VmzModuleKind::Other;
        let chunk = chunk_id_for(src_root, path);
        report.affected_chunks.push(chunk.clone());
        // Single-file compile has no ComponentGraph — empty map keeps string-tag fallback.
        emit_file(path, src_root, options, &mut report, kind, &chunk, None, None)?;
        emit_routes_json(options, &mut report)?;
        let project_root =
            path.parent().and_then(|p| p.parent()).unwrap_or_else(|| path.parent().unwrap_or(path));
        emit_stylesheets(project_root, options, &mut report)?;
        return Ok(report);
    }
    compile_project(path, options)
}

/// Full-project compile: discover all units, emit outputs, no dirty-set filtering.
pub fn compile_project(
    root: impl AsRef<Path>,
    options: &CompileOptions,
) -> crate::Result<CompileReport> {
    compile_project_with_dirty(root, options, &[])
}

/// session: when `dirty` is non-empty, re-emit only VPG-affected deployment units.
pub fn compile_project_with_dirty(
    root: impl AsRef<Path>,
    options: &CompileOptions,
    dirty: &[PathBuf],
) -> crate::Result<CompileReport> {
    let root = root.as_ref();
    let check = check_path(root, &CheckOptions::default())?;
    if check.has_errors() {
        return Ok(CompileReport {
            diagnostics: check.diagnostics,
            emitted: Vec::new(),
            routes: Vec::new(),
            full: dirty.is_empty(),
            affected_sources: Vec::new(),
            affected_chunks: Vec::new(),
            seed_chunks: Vec::new(),
            island_hmr: false,
            css_entry: None,
            style_assets: Vec::new(),
            style_theme: None,
            style_bundle_hash: None,
            tw_registrations: Vec::new(),
            written_outputs: Vec::new(),
            output_revision: String::new(),
            reload_required: false,
        });
    }

    let src_root = if root.join("src").is_dir() { root.join("src") } else { root.to_path_buf() };

    let plan = plan_affected(root, dirty);
    let mut report = CompileReport {
        full: plan.full,
        affected_sources: plan.units.iter().map(|u| u.source.clone()).collect(),
        affected_chunks: plan.units.iter().map(|u| u.chunk_id.clone()).collect(),
        seed_chunks: plan.seed_chunks.clone(),
        island_hmr: plan.island_only(),
        ..CompileReport::default()
    };
    report.full = plan.full;

    fs::create_dir_all(&options.out_dir)?;
    if plan.rebuild_runtime || !options.out_dir.join("vmz-runtime.js").is_file() {
        emit_runtime_js(options, &mut report)?;
    }
    if plan.rebuild_server_tree {
        emit_server_tree(&src_root, options, &mut report)?;
    }
    // Plain `src/**/*.{ts,js}` helpers (not `#server`, not `.vmz`) → `dist/**/*.js`.
    emit_client_modules(&src_root, options, &mut report, dirty, plan.full)?;

    // Full RouteTable from all pages (Link resolve must not depend on dirty set / filesystem probes).
    let route_table = match build_project_route_table(root, &src_root, &mut report) {
        Some(t) => t,
        None => return Ok(report),
    };
    advise_browser_path_deviations(&route_table, &mut report);

    let (_graph_src, graph, _catalog) = crate::affected::component_graph_for(root);

    for unit in &plan.units {
        let child_ctors = child_ctors_for_chunk(&unit.chunk_id, &graph.by_tag);
        emit_file(
            &unit.source,
            &src_root,
            options,
            &mut report,
            unit.kind,
            &unit.chunk_id,
            Some(&route_table),
            Some(&child_ctors),
        )?;
    }
    if plan.full {
        emit_routes_json(options, &mut report)?;
    } else if !report.routes.is_empty() {
        merge_routes_json(options, &mut report)?;
    }
    emit_stylesheets(root, options, &mut report)?;
    emit_deployment_json(root, &src_root, options, &plan, &route_table, &mut report)?;
    finalize_output_revision(options, dirty, &mut report);
    Ok(report)
}

fn build_project_route_table(
    root: &Path,
    src_root: &Path,
    report: &mut CompileReport,
) -> Option<crate::pipeline::link::RouteTable> {
    let mut parsed_pages = Vec::new();
    for (path, kind) in discover_vmz_files(root) {
        if kind != VmzModuleKind::Page {
            continue;
        }
        let Ok(source) = fs::read_to_string(&path) else {
            report.diagnostics.push(
                ReportedDiagnostic::error(&path, "vmz::io::read_failed")
                    .with_arg("detail", "failed to read page for RouteTable"),
            );
            continue;
        };
        let parsed = match parse_vmz(&path, source) {
            Ok(p) => p,
            Err(e) => {
                report.diagnostics.push(
                    ReportedDiagnostic::error(&path, "vmz::sfc::parse_failed")
                        .with_arg("detail", e.to_string()),
                );
                continue;
            }
        };
        let client = analyze_script(ScriptKind::Client, &parsed.client.content);
        let chunk_id = chunk_id_for(src_root, &path);
        parsed_pages.push((path, parsed, client.decl.name, chunk_id));
    }
    match crate::pipeline::link::collect_route_table(&parsed_pages) {
        Ok(table) => Some(table),
        Err(errs) => {
            for e in errs {
                report.diagnostics.push(
                    ReportedDiagnostic::error(root, "vmz::router::route_table_invalid")
                        .with_arg("detail", e),
                );
            }
            None
        }
    }
}

fn advise_browser_path_deviations(
    table: &crate::pipeline::link::RouteTable,
    report: &mut CompileReport,
) {
    for entry in table.by_id.values() {
        let file = crate::pipeline::link::path_pattern_from_chunk(&entry.chunk_id);
        if entry.path_pattern == file {
            continue;
        }
        report.diagnostics.push(
            ReportedDiagnostic::advice(&entry.source, "vmz::router::path_deviation")
                .with_arg("explicit", entry.path_pattern.clone())
                .with_arg("file", file),
        );
    }
}

fn emit_stylesheets(
    root: &Path,
    options: &CompileOptions,
    report: &mut CompileReport,
) -> crate::Result<()> {
    use crate::designs::{emit_style_theme_css, load_designs};
    use crate::style_emit::{StyleContribution, StyleLayer, emit_style_bundle_opts};

    let designs = load_designs(root);
    report.diagnostics.extend(designs.diagnostics.clone());
    report
        .diagnostics
        .extend(crate::style_token_diag::validate_project_design_token_refs(root, &designs));
    if !designs.theme.is_empty() {
        report.style_theme = Some(designs.theme.summary());
    }

    let (input_hash, project_tw) = style_input_fingerprint(root, &designs);
    report.style_bundle_hash = Some(input_hash.clone());

    let prev = read_prev_style_deployment(&options.out_dir);
    let entry_exists =
        options.out_dir.join(prev.css_entry.as_deref().unwrap_or("vmz.css")).is_file();
    if let (Some(prev_hash), Some(_)) = (&prev.style_bundle_hash, &prev.css_entry) {
        if prev_hash == &input_hash && entry_exists {
            report.css_entry = prev.css_entry;
            if report.style_theme.is_none() {
                report.style_theme = prev.style_theme;
            }
            return Ok(());
        }
    }

    let sources: Vec<PathBuf> = discover_vmz_files(root).into_iter().map(|(p, _)| p).collect();
    let mut contributions: Vec<StyleContribution> = Vec::new();

    let designs_css = emit_style_theme_css(&designs.theme);
    if !designs_css.trim().is_empty() {
        contributions.push(StyleContribution {
            layer: StyleLayer::Designs,
            asset_name: "vmz-designs.css".into(),
            css: designs_css,
        });
    }

    if let Some(scss) = &options.scss {
        if !sources.is_empty() || designs.style_entry.is_some() || !designs.style_files.is_empty() {
            let result = scss.emit_project(&ScssEmitRequest {
                project_root: root.to_path_buf(),
                out_dir: options.out_dir.clone(),
                sources: sources.clone(),
                designs_style_entry: designs.style_entry.clone(),
                designs_style_files: designs.style_files.clone(),
            });
            report.diagnostics.extend(result.diagnostics);
            if !result.css.trim().is_empty() {
                let rel = if result.css_relative.is_empty() {
                    "vmz-style.css".to_string()
                } else {
                    result.css_relative
                };
                contributions.push(StyleContribution {
                    layer: StyleLayer::Scss,
                    asset_name: rel,
                    css: result.css,
                });
            }
        }
    }

    if let Some(tw) = &options.tw {
        // Always project from the full project registrations (not only this dirty round).
        let result = tw.emit_project(&TwEmitRequest {
            project_root: root.to_path_buf(),
            out_dir: options.out_dir.clone(),
            registrations: project_tw,
            style_theme: designs.theme.clone(),
        });
        report.diagnostics.extend(result.diagnostics);
        if !(result.css.is_empty() && result.static_tokens.is_empty()) {
            let rel = if result.css_relative.is_empty() {
                "vmz-tw.css".to_string()
            } else {
                result.css_relative
            };
            contributions.push(StyleContribution {
                layer: StyleLayer::Tw,
                asset_name: rel,
                css: result.css,
            });
        }
    }

    let emitted = emit_style_bundle_opts(&options.out_dir, &contributions, options.release)?;
    for path in emitted.written {
        report.emitted.push(path.clone());
        report.style_assets.push(path);
    }
    report.css_entry = emitted.css_entry;
    Ok(())
}

#[derive(Default)]
struct PrevStyleDeployment {
    css_entry: Option<String>,
    style_theme: Option<crate::designs::StyleThemeSummary>,
    style_bundle_hash: Option<String>,
}

fn read_prev_style_deployment(out_dir: &Path) -> PrevStyleDeployment {
    let path = out_dir.join("vmz-deployment.json");
    let Ok(text) = fs::read_to_string(path) else {
        return PrevStyleDeployment::default();
    };
    let Ok(doc) = serde_json::from_str::<DeploymentDocument>(&text) else {
        return PrevStyleDeployment::default();
    };
    PrevStyleDeployment {
        css_entry: doc.css_entry,
        style_theme: doc.style_theme,
        style_bundle_hash: doc.style_bundle_hash,
    }
}

/// Theme + designs/styles + every SFC `<style>` / `style:tw` → stable input hash + full TW regs.
fn style_input_fingerprint(
    root: &Path,
    designs: &crate::designs::DesignsBundle,
) -> (String, Vec<crate::tw::TwRegistration>) {
    use crate::plugin::sha256_hex_bytes;

    let mut regs = Vec::new();
    let mut buf = String::new();
    buf.push_str(&designs.theme.content_hash());
    buf.push('\n');

    // The SCSS entry can import any sibling under designs/styles. Hashing only
    // index.scss leaves incremental builds stale when an imported partial changes.
    // The inventory is already bounded to style files, so include it in full.
    let mut style_paths = designs.style_files.clone();
    if let Some(entry) = &designs.style_entry {
        if !style_paths.contains(entry) {
            style_paths.push(entry.clone());
        }
    }
    style_paths.sort();
    for p in style_paths {
        buf.push_str(&p.to_string_lossy());
        buf.push('\n');
        if let Ok(text) = fs::read_to_string(&p) {
            buf.push_str(&sha256_hex_bytes(text.as_bytes()));
            buf.push('\n');
        }
    }

    for (path, _) in discover_vmz_files(root) {
        let Ok(text) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(parsed) = parse_vmz(&path, text) else {
            continue;
        };
        buf.push_str(&path.to_string_lossy());
        buf.push('\n');
        if let Some(style) = &parsed.style {
            buf.push_str(&sha256_hex_bytes(style.content.as_bytes()));
            buf.push('\n');
        }
        let before = regs.len();
        register_tw_from_parsed(&parsed, &mut regs);
        for r in &regs[before..] {
            buf.push_str(&r.token);
            buf.push('\n');
        }
    }

    (sha256_hex_bytes(buf.as_bytes()), regs)
}
fn emit_routes_json(options: &CompileOptions, report: &mut CompileReport) -> crate::Result<()> {
    let json = vmz_generator::to_pretty_json(&report.routes).unwrap_or_else(|_| "[]".into());
    let out = options.out_dir.join("vmz-routes.json");
    fs::write(&out, format!("{json}\n"))?;
    report.emitted.push(out);
    Ok(())
}

fn merge_routes_json(options: &CompileOptions, report: &mut CompileReport) -> crate::Result<()> {
    let out = options.out_dir.join("vmz-routes.json");
    let mut existing: Vec<EmittedRoute> = Vec::new();
    if out.is_file() {
        let text = fs::read_to_string(&out)?;
        if let Ok(arr) = serde_json::from_str::<Vec<EmittedRoute>>(&text) {
            existing = arr;
        }
    }
    let touched: std::collections::HashSet<String> =
        report.routes.iter().map(|r| r.module_id.clone()).collect();
    existing.retain(|r| !touched.contains(&r.module_id));
    existing.extend(report.routes.iter().cloned());
    report.routes = existing;
    emit_routes_json(options, report)
}

fn emit_runtime_js(options: &CompileOptions, report: &mut CompileReport) -> crate::Result<()> {
    let runtime_root = options.runtime_dist.clone().unwrap_or_else(|| {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../runtimes/vmz-runtime/dist")
    });
    let browser_copies = [
        ("faces/server.js", "vmz-runtime.js"),
        ("faces/dom.js", "vmz-dom.js"),
        ("browser/dom-core.js", "dom-core.js"),
        ("ssr/dom-ssr.js", "dom-ssr.js"),
        ("faces/dom.client.js", "dom.client.js"),
        ("faces/dom.browser.js", "dom.browser.js"),
        ("browser/direct-host-box.js", "direct-host-box.js"),
        ("browser/unknown-component.js", "unknown-component.js"),
        ("faces/http.js", "vmz-http.js"),
        ("browser/client-nav.js", "vmz-client-nav.js"),
    ];
    for (src_name, out_name) in browser_copies {
        copy_runtime_file(&runtime_root, src_name, out_name, false, options, report)?;
    }
    // Local `vmz serve` / `vmz dev` need the host; production `--release` deploys omit it.
    // 0.1.31: host companions nest under `_vmz/host/` (not delivery root).
    // 0.2.0: file list from packages/runtimes/vmz/host-runtime-files.json only.
    if !options.release {
        let host_manifest = host_runtime_files_manifest();
        for f in &host_manifest.files {
            copy_runtime_file(
                &runtime_root,
                &f.src,
                &f.out,
                f.rewrite_vmz_runtime_import,
                options,
                report,
            )?;
        }
        let stub = options.out_dir.join(&host_manifest.launcher_stub.out);
        if let Some(parent) = stub.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&stub, &host_manifest.launcher_stub.body)?;
        report.emitted.push(stub);
    }
    Ok(())
}

fn copy_runtime_file(
    runtime_root: &Path,
    src_name: &str,
    out_name: &str,
    rewrite_vmz_runtime_import: bool,
    options: &CompileOptions,
    report: &mut CompileReport,
) -> crate::Result<()> {
    let runtime_src = runtime_root.join(src_name);
    if !runtime_src.is_file() {
        report.diagnostics.push(
            ReportedDiagnostic::error(&runtime_src, "vmz::runtime::missing")
                .with_arg("name", src_name.to_string())
                .with_arg("root", runtime_root.display().to_string()),
        );
        return Ok(());
    }
    let out = options.out_dir.join(out_name);
    if let Some(parent) = out.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut text = fs::read_to_string(&runtime_src)?;
    if rewrite_vmz_runtime_import {
        // Nested under `_vmz/host/`: delivery-root `vmz-runtime.js` is two levels up.
        text = text.replace("from './vmz-runtime.js'", "from '../../vmz-runtime.js'");
        text = text.replace("from \"./vmz-runtime.js\"", "from \"../../vmz-runtime.js\"");
        text = text.replace("from '../faces/vmz-runtime.js'", "from '../../vmz-runtime.js'");
        text = text.replace("from \"../faces/vmz-runtime.js\"", "from \"../../vmz-runtime.js\"");
        text = text.replace("from '../faces/server.js'", "from '../../vmz-runtime.js'");
        text = text.replace("from \"../faces/server.js\"", "from \"../../vmz-runtime.js\"");
    } else if !out_name.starts_with("_vmz/") {
        text = rewrite_flat_delivery_imports(&text);
    }
    fs::write(&out, text)?;
    report.emitted.push(out);
    Ok(())
}

/// `@vmz/core` dist is layered (`browser/`, `ssr/`, `faces/`); delivery root is flat.
fn rewrite_flat_delivery_imports(text: &str) -> String {
    let mut out = text.to_string();
    const PAIRS: &[(&str, &str)] = &[
        ("../browser/dom-core.js", "./dom-core.js"),
        ("../browser/direct-host-box.js", "./direct-host-box.js"),
        ("../browser/unknown-component.js", "./unknown-component.js"),
        ("../browser/client-nav.js", "./vmz-client-nav.js"),
        ("../ssr/dom-ssr.js", "./dom-ssr.js"),
        ("../faces/server.js", "./vmz-runtime.js"),
        ("../faces/vmz-runtime.js", "./vmz-runtime.js"),
        ("../faces/http.js", "./vmz-http.js"),
    ];
    for (from, to) in PAIRS {
        out = out.replace(&format!("'{from}'"), &format!("'{to}'"));
        out = out.replace(&format!("\"{from}\""), &format!("\"{to}\""));
    }
    out
}

#[derive(Debug, Deserialize)]
struct HostRuntimeFilesManifest {
    files: Vec<HostRuntimeFileEntry>,
    #[serde(rename = "launcherStub")]
    launcher_stub: HostLauncherStub,
}

#[derive(Debug, Deserialize)]
struct HostRuntimeFileEntry {
    src: String,
    out: String,
    #[serde(default, rename = "rewriteVmzRuntimeImport")]
    rewrite_vmz_runtime_import: bool,
}

#[derive(Debug, Deserialize)]
struct HostLauncherStub {
    out: String,
    body: String,
}

fn host_runtime_files_manifest() -> HostRuntimeFilesManifest {
    // packages/compilers/vmz-compiler → packages/runtimes/vmz/host-runtime-files.json
    const RAW: &str = include_str!("../../../../runtimes/vmz/host-runtime-files.json");
    serde_json::from_str(RAW).expect("host-runtime-files.json must parse")
}

/// Transpile `src/server/**/*.ts` `dist/#server/**/*.js`.
fn emit_server_tree(
    src_root: &Path,
    options: &CompileOptions,
    report: &mut CompileReport,
) -> crate::Result<()> {
    let server_root = src_root.join("server");
    if !server_root.is_dir() {
        return Ok(());
    }
    for entry in WalkDir::new(&server_root).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("ts") {
            continue;
        }
        let source = fs::read_to_string(path)?;
        let id = virtual_server::id_from_src_path(src_root, path);
        match vmz_generator::transpile_ts_printed(
            &source,
            &path.display().to_string(),
            &if options.release {
                vmz_generator::JsPrintOptions::release_mapped(
                    Path::new(&id).file_name().unwrap_or_default(),
                )
            } else {
                vmz_generator::JsPrintOptions::default()
            },
        ) {
            Ok(printed) => {
                let rel = id.trim_start_matches("#server/");
                let out = options
                    .out_dir
                    .join("#server")
                    .join(rel.replace('/', std::path::MAIN_SEPARATOR_STR))
                    .with_extension("js");
                if let Some(parent) = out.parent() {
                    fs::create_dir_all(parent)?;
                }
                let js = format!("// virtual: {id}\n{}", printed.code);
                let js = virtual_server::rewrite_imports_to_relative(&js, &id);
                fs::write(&out, js)?;
                report.emitted.push(out);
            }
            Err(e) => {
                report.diagnostics.push(
                    ReportedDiagnostic::error(path, "vmz::emit::server_tree_failed")
                        .with_arg("error", e.to_string()),
                );
            }
        }
    }
    Ok(())
}

/// Mirror plain client helpers: `src/lib/foo.ts` → `dist/lib/foo.js` (skip `src/server/**`).
fn emit_client_modules(
    src_root: &Path,
    options: &CompileOptions,
    report: &mut CompileReport,
    dirty: &[PathBuf],
    full: bool,
) -> crate::Result<()> {
    if !src_root.is_dir() {
        return Ok(());
    }
    let dirty_set: std::collections::BTreeSet<PathBuf> =
        dirty.iter().map(|p| std::fs::canonicalize(p).unwrap_or_else(|_| p.clone())).collect();
    let server_root = src_root.join("server");
    for entry in WalkDir::new(src_root).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if path.strip_prefix(&server_root).is_ok() {
            continue;
        }
        if !full {
            let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
            if !dirty_set.contains(&canonical) {
                continue;
            }
        }
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        if ext != "ts" && ext != "js" && ext != "mjs" {
            continue;
        }
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if name.ends_with(".d.ts") {
            continue;
        }
        let Ok(rel) = path.strip_prefix(src_root) else {
            continue;
        };
        let out = options.out_dir.join(rel).with_extension("js");
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent)?;
        }
        let source = fs::read_to_string(path)?;
        let js = if ext == "ts" {
            match vmz_generator::transpile_ts_printed(
                &source,
                &path.display().to_string(),
                &if options.release {
                    vmz_generator::JsPrintOptions::release_mapped(out.file_name().unwrap())
                } else {
                    vmz_generator::JsPrintOptions::mapped(out.file_name().unwrap())
                },
            ) {
                Ok(printed) => {
                    if let Some(map) = printed.map {
                        let map_path = out.with_extension("js.map");
                        let _ = fs::write(&map_path, map);
                        report.emitted.push(map_path);
                    }
                    printed.code
                }
                Err(e) => {
                    report.diagnostics.push(
                        ReportedDiagnostic::error(path, "vmz::emit::client_module_failed")
                            .with_arg("error", e.to_string()),
                    );
                    continue;
                }
            }
        } else if options.release {
            match vmz_generator::print_js_source(
                &source,
                &out.file_name().unwrap().to_string_lossy(),
                &vmz_generator::JsPrintOptions::release_mapped(out.file_name().unwrap()),
            ) {
                Ok(printed) => {
                    if let Some(map) = printed.map {
                        let map_path = out.with_extension("js.map");
                        let _ = fs::write(&map_path, map);
                        report.emitted.push(map_path);
                    }
                    printed.code
                }
                Err(e) => {
                    report.diagnostics.push(
                        ReportedDiagnostic::error(path, "vmz::emit::client_js_print_failed")
                            .with_arg("error", e.to_string()),
                    );
                    continue;
                }
            }
        } else {
            source
        };
        let js = crate::emit::rewrite_ts_spec_imports(&js);
        fs::write(&out, js)?;
        report.emitted.push(out);
    }
    Ok(())
}

fn finalize_output_revision(
    options: &CompileOptions,
    dirty: &[PathBuf],
    report: &mut CompileReport,
) {
    use crate::session::plugin::sha256_hex;
    use serde_json::json;

    let mut parts: Vec<serde_json::Value> = Vec::new();
    if let Ok(bytes) = fs::read(options.out_dir.join("vmz-deployment.json")) {
        parts.push(json!({"deployment": sha256_hex(&bytes)}));
    }
    if let Ok(bytes) = fs::read(options.out_dir.join("vmz-routes.json")) {
        parts.push(json!({"routes": sha256_hex(&bytes)}));
    }

    let mut written: Vec<String> = report
        .emitted
        .iter()
        .filter_map(|p| {
            p.strip_prefix(&options.out_dir).ok().map(|r| r.to_string_lossy().replace('\\', "/"))
        })
        .collect();
    written.sort();
    written.dedup();

    for rel in &written {
        if let Ok(bytes) = fs::read(options.out_dir.join(rel)) {
            parts.push(json!({rel.clone(): sha256_hex(&bytes)}));
        }
    }
    report.written_outputs = written;
    let body = serde_json::to_string(&parts).unwrap_or_default();
    report.output_revision = sha256_hex(body.as_bytes());
    report.reload_required = !dirty.is_empty()
        && report.diagnostics.iter().all(|d| !d.is_error())
        && (!report.affected_chunks.is_empty() || report.full || report.island_hmr);
}

/// Map `ComponentGraph.by_tag` → relative import specs for a parent chunk.
///
/// Skips the parent’s own chunk. Ensures a `./` prefix when the relative path
/// does not already start with `.`.
fn child_ctors_for_chunk(
    parent_chunk_id: &str,
    by_tag: &HashMap<String, String>,
) -> HashMap<String, String> {
    let parent_dir = Path::new(parent_chunk_id).parent().unwrap_or(Path::new(""));
    let mut out = HashMap::new();
    for (tag, child_chunk) in by_tag {
        if child_chunk == parent_chunk_id {
            continue;
        }
        let target = format!("{child_chunk}.client.js");
        let rel = pathdiff_chunk(parent_dir, Path::new(&target));
        let rel = if rel.starts_with('.') { rel } else { format!("./{rel}") };
        out.insert(tag.clone(), rel);
    }
    out
}

fn pathdiff_chunk(from_dir: &Path, target: &Path) -> String {
    let from_parts: Vec<_> = from_dir
        .components()
        .filter_map(|c| c.as_os_str().to_str())
        .filter(|s| !s.is_empty())
        .collect();
    let to_parts: Vec<_> = target.components().filter_map(|c| c.as_os_str().to_str()).collect();
    let mut i = 0;
    while i < from_parts.len() && i < to_parts.len() && from_parts[i] == to_parts[i] {
        i += 1;
    }
    let mut out = Vec::new();
    out.extend(std::iter::repeat_n("..", from_parts.len() - i));
    for p in &to_parts[i..] {
        out.push(*p);
    }
    if out.is_empty() { ".".into() } else { out.join("/") }
}

fn emit_file(
    path: &Path,
    src_root: &Path,
    options: &CompileOptions,
    report: &mut CompileReport,
    kind: VmzModuleKind,
    chunk_id: &str,
    routes: Option<&crate::pipeline::link::RouteTable>,
    child_ctors: Option<&HashMap<String, String>>,
) -> crate::Result<()> {
    let source = fs::read_to_string(path)?;
    let parsed = parse_vmz(path, source)?;
    register_tw_from_parsed(&parsed, &mut report.tw_registrations);
    let client = analyze_script(ScriptKind::Client, &parsed.client.content);
    for finding in crate::secrets::collect_client_boundary_findings(&parsed.client.content) {
        report.diagnostics.push(
            ReportedDiagnostic::error_at(path, finding.code, finding.span)
                .with_arg("detail", finding.message.clone()),
        );
    }
    let server = parsed.server.as_ref().map(|s| analyze_script(ScriptKind::Server, &s.content));
    let concrete = match parse_template_concrete(&parsed.template.content) {
        Ok(c) => c,
        Err(e) => {
            report.diagnostics.push(template_parse_to_diagnostic(
                path,
                parsed.template.content_start,
                &e,
            ));
            return Ok(());
        }
    };
    let semantic = match lower_concrete_to_semantic(&concrete) {
        Ok(s) => s,
        Err(e) => {
            report.diagnostics.push(template_parse_to_diagnostic(
                path,
                parsed.template.content_start,
                &e,
            ));
            return Ok(());
        }
    };
    let template_ir = match lower_concrete_to_ir(&concrete) {
        Ok(ir) => ir,
        Err(e) => {
            report.diagnostics.push(template_parse_to_diagnostic(
                path,
                parsed.template.content_start,
                &e,
            ));
            return Ok(());
        }
    };
    let content_start = parsed.template.content_start as u32;
    for err in crate::reactive_build::collect_concrete_expr_errors(&concrete) {
        let (start, end) = err.body_span.to_absolute(content_start);
        let path_s = path.to_string_lossy().into_owned();
        report.diagnostics.push(
            ReportedDiagnostic::error(path, "vmz::template::invalid_expr")
                .with_arg("detail", err.message)
                .with_source_span(SourceSpan { path: path_s, start, end }),
        );
    }
    if report.diagnostics.iter().any(|d| d.is_error() && d.code() == "vmz::template::invalid_expr")
    {
        return Ok(());
    }

    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("component");

    // Emit path follows chunk_id (pages/index, components/Button) — including dependency
    // components discovered outside app `src/` (see `chunk_id_for`).
    let client_rel = format!("{chunk_id}.client.js");
    let program_rel = format!("{chunk_id}.program.json");
    let client_path = options.out_dir.join(client_rel.replace('/', std::path::MAIN_SEPARATOR_STR));
    let out_dir = client_path.parent().unwrap_or(options.out_dir.as_path()).to_path_buf();
    fs::create_dir_all(&out_dir)?;

    let server_id = server.as_ref().map(|_| virtual_server::id_from_src_path(src_root, path));

    let bridge = server.as_ref().zip(server_id.as_ref()).map(|(an, id)| ServerBridge {
        module_id: id.clone(),
        class_name: an.decl.name.clone(),
        methods: an.decl.methods.clone(),
    });

    // Program IR first ?emit and routes consume the same fact source.
    let server_attach = server.as_ref().zip(server_id.as_ref()).zip(parsed.server.as_ref()).map(
        |((an, id), server_block)| {
            let client_calls = crate::server_calls::collect_server_class_calls(
                &parsed.client.content,
                &an.decl.name,
            );
            let mut secret_requirements =
                crate::secrets::collect_secret_requirements(&server_block.content);
            for s in &mut secret_requirements {
                s.module_id = Some(id.clone());
            }
            vmz_types::ServerAttach {
                module_id: id.clone(),
                class_name: an.decl.name.clone(),
                methods: an.decl.methods.clone(),
                client_calls,
                secret_requirements,
            }
        },
    );
    let mut program = crate::reactive_build::build_program_module_with_server_asts(
        &path.display().to_string(),
        &client.decl,
        &semantic,
        &template_ir,
        server_attach.as_ref(),
        routes,
    );
    if let Some(unit) = program.units.first_mut() {
        let region_ids: Vec<u32> = unit.view.region_ids.iter().map(|r| r.0).collect();
        let capabilities: Vec<String> =
            unit.server.capabilities.iter().map(|c| c.method.clone()).collect();
        let client_calls: Vec<DeploymentClientCall> = unit
            .server
            .calls
            .iter()
            .map(|e| DeploymentClientCall {
                method: e.method.clone(),
                from_client_method: e.from_client_method.clone(),
            })
            .collect();
        let server_module_id = unit.server.module_id.clone();
        let resume_entries = unit.collect_resume_entries_from_view();
        let tab = routes.and_then(|table| {
            table.by_id.values().find(|e| e.chunk_id == chunk_id).and_then(|e| e.tab.clone())
        });
        unit.deployment = DeploymentView {
            status: StubStatus::Partial,
            unit_kind: Some(kind),
            chunk_id: Some(chunk_id.to_string()),
            client_entry: Some(client_rel),
            program_ir: Some(program_rel),
            region_ids,
            capabilities,
            server_module_id,
            client_calls,
            resume_entries,
            tab,
        };
    }
    let reactive_comp = program.units.first().map(|u| &u.reactive);
    let native_view = program.units.first().map(|u| &u.view);
    let exec_plan = program.units.first().map(|u| &u.plan);

    let (client_js, _) = match crate::emit::emit_client_js_with_ir_mapped(
        &parsed.client.content,
        &client,
        &template_ir,
        bridge.as_ref(),
        reactive_comp,
        native_view,
        exec_plan,
        child_ctors,
    ) {
        Ok(pair) => pair,
        Err(e) => {
            report.diagnostics.push(
                ReportedDiagnostic::error(path, "vmz::emit::client_failed")
                    .with_arg("error", e.to_string()),
            );
            return Ok(());
        }
    };
    let client_path = out_dir.join(format!("{stem}.client.js"));
    let runtime_path = options.out_dir.join("vmz-runtime.js");
    let dom_path = options.out_dir.join("dom-core.js");
    let client_js = {
        let mut js = client_js;
        if js.contains("vmz:runtime") && runtime_path.exists() {
            js = crate::emit::rewrite_virtual_import(
                &js,
                &client_path,
                "vmz:runtime",
                &runtime_path,
            );
        }
        if js.contains("vmz:dom") && dom_path.exists() {
            js = crate::emit::rewrite_virtual_import(&js, &client_path, "vmz:dom", &dom_path);
        }
        crate::emit::rewrite_ts_spec_imports(&js)
    };
    let js_name = format!("{stem}.client.js");
    let printed = match vmz_generator::print_js_source(
        &client_js,
        &js_name,
        &if options.release {
            vmz_generator::JsPrintOptions::release_mapped(&js_name)
        } else {
            vmz_generator::JsPrintOptions::mapped(&js_name)
        },
    ) {
        Ok(p) => p,
        Err(e) => {
            report.diagnostics.push(
                ReportedDiagnostic::error(path, "vmz::emit::client_js_print_failed")
                    .with_arg("error", e.to_string()),
            );
            return Ok(());
        }
    };
    fs::write(&client_path, &printed.code)?;
    report.emitted.push(client_path);
    if let Some(map) = printed.map {
        let map_path = out_dir.join(format!("{stem}.client.js.map"));
        fs::write(&map_path, map)?;
        report.emitted.push(map_path);
    }

    if let (Some(server_an), Some(server_block), Some(id)) =
        (server.as_ref(), parsed.server.as_ref(), server_id.as_ref())
    {
        let server_js = match emit_server_js(&server_block.content, server_an, id) {
            Ok(js) => {
                let name = format!("{}.js", id.trim_start_matches("#server/").replace('/', "_"));
                match vmz_generator::print_js_source(
                    &js,
                    &name,
                    &if options.release {
                        vmz_generator::JsPrintOptions::release_mapped(&name)
                    } else {
                        vmz_generator::JsPrintOptions::default()
                    },
                ) {
                    Ok(p) => p.code,
                    Err(_) => js,
                }
            }
            Err(e) => {
                report.diagnostics.push(
                    ReportedDiagnostic::error(path, "vmz::emit::server_failed")
                        .with_arg("error", e.to_string()),
                );
                return Ok(());
            }
        };
        let virtual_rel =
            id.trim_start_matches("#server/").replace('/', std::path::MAIN_SEPARATOR_STR);
        let server_out = options.out_dir.join("#server").join(virtual_rel).with_extension("js");
        if let Some(parent) = server_out.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&server_out, &server_js)?;
        report.emitted.push(server_out);
    }

    let mut method_rw = std::collections::BTreeMap::new();
    for m in client.decl.methods.iter().filter(|m| !m.reads.is_empty() || !m.writes.is_empty()) {
        method_rw.insert(
            m.name.clone(),
            MethodRwWire { reads: m.reads.clone(), writes: m.writes.clone(), async_: m.is_async },
        );
    }
    let meta = VmzMetaDocument {
        file: path.display().to_string(),
        client: client.decl.name.clone(),
        server: server.as_ref().map(|s| s.decl.name.clone()),
        server_module: server_id.clone(),
        template_roots: template_ir.roots.len(),
        method_rw,
    };
    let meta_path = out_dir.join(format!("{stem}.vmz.json"));
    fs::write(
        &meta_path,
        format!("{}\n", vmz_generator::to_pretty_json(&meta).unwrap_or_else(|_| "{}".into())),
    )?;
    report.emitted.push(meta_path);

    // Routes from Program IR Server view (single fact source for HTTP surface).
    if let Some(unit) = program.units.first() {
        if let (Some(module_id), Some(class_name)) =
            (unit.server.module_id.as_ref(), unit.server.class_name.as_ref())
        {
            for cap in &unit.server.capabilities {
                if let Some(http) = &cap.http {
                    report.routes.push(EmittedRoute {
                        verb: http.verb.clone(),
                        path: http.path.clone(),
                        module_id: module_id.clone(),
                        method: cap.method.clone(),
                        class_name: class_name.clone(),
                    });
                }
            }
        }
    }
    let reactive = program.to_reactive_module();
    let reactive_path = out_dir.join(format!("{stem}.reactive.json"));
    let reactive_json = vmz_generator::to_pretty_json(&reactive).unwrap_or_else(|_| "{}".into());
    fs::write(&reactive_path, format!("{reactive_json}\n"))?;
    report.emitted.push(reactive_path);
    let program_path = out_dir.join(format!("{stem}.program.json"));
    let program_json = vmz_generator::to_pretty_json(&program).unwrap_or_else(|_| "{}".into());
    fs::write(&program_path, format!("{program_json}\n"))?;
    report.emitted.push(program_path);

    let _ = options.release;
    Ok(())
}

fn recompute_depended_by(units: &mut [DeploymentUnitWire]) {
    use std::collections::{BTreeSet, HashMap};
    let mut rev: HashMap<String, BTreeSet<String>> = HashMap::new();
    for u in units.iter() {
        for dep in &u.depends_on {
            rev.entry(dep.clone()).or_default().insert(u.chunk_id.clone());
        }
    }
    for u in units.iter_mut() {
        u.depended_by =
            rev.get(&u.chunk_id).map(|s| s.iter().cloned().collect::<Vec<_>>()).unwrap_or_default();
    }
}

fn emit_deployment_json(
    root: &Path,
    _src_root: &Path,
    options: &CompileOptions,
    plan: &AffectedPlan,
    route_table: &crate::pipeline::link::RouteTable,
    report: &mut CompileReport,
) -> crate::Result<()> {
    let (_src, graph, catalog) = crate::affected::component_graph_for(root);

    let mut units = Vec::with_capacity(catalog.len());
    let known_chunks: std::collections::BTreeSet<String> =
        catalog.iter().map(|(_, _, chunk_id)| chunk_id.clone()).collect();
    for (source, kind, chunk_id) in &catalog {
        let client_entry = format!("{chunk_id}.client.js");
        let program_ir = format!("{chunk_id}.program.json");
        let rebuilt = plan.units.iter().any(|p| p.chunk_id == *chunk_id);
        let depends_on = graph.deps.get(chunk_id).cloned().unwrap_or_default();
        let depended_by = graph.reverse.get(chunk_id).cloned().unwrap_or_default();
        let extras = read_program_deployment_extras(&options.out_dir.join(&program_ir));
        let route = route_table.get_by_chunk(chunk_id);
        let layout_chain = if chunk_id.starts_with("pages/")
            && !crate::pipeline::link::is_route_boundary_chunk(chunk_id)
        {
            crate::pipeline::link::layout_chain_for_page(chunk_id, &known_chunks)
        } else {
            Vec::new()
        };
        let depends_on =
            crate::pipeline::link::merge_depends_on_with_layout(depends_on, &layout_chain);
        units.push(DeploymentUnitWire {
            chunk_id: chunk_id.clone(),
            kind: *kind,
            source: source.display().to_string(),
            client_entry,
            program_ir,
            depends_on,
            depended_by,
            region_ids: extras.region_ids,
            capabilities: extras.capabilities,
            server_module_id: extras.server_module_id,
            client_calls: extras
                .client_calls
                .into_iter()
                .map(|(method, from_client_method)| DeploymentCallWire {
                    method,
                    from_client_method,
                })
                .collect(),
            resume_entries: extras
                .resume_entries
                .into_iter()
                .map(|(component, strategy)| DeploymentResumeWire { component, strategy })
                .collect(),
            path_pattern: route.map(|e| e.path_pattern.clone()).unwrap_or_default(),
            route_id: route.map(|e| e.route_id.clone()).unwrap_or_default(),
            layout_chain,
            rebuilt,
        });
    }

    recompute_depended_by(&mut units);

    let doc = DeploymentDocument {
        schema: DEPLOYMENT_SCHEMA.to_string(),
        units,
        affected_chunks: plan.units.iter().map(|u| u.chunk_id.clone()).collect(),
        seed_chunks: plan.seed_chunks.clone(),
        island_hmr: plan.island_only(),
        css_entry: report.css_entry.clone(),
        style_theme: report.style_theme.clone(),
        style_bundle_hash: report.style_bundle_hash.clone(),
        full: plan.full,
    };
    let out = options.out_dir.join("vmz-deployment.json");
    fs::write(
        &out,
        format!("{}\n", vmz_generator::to_pretty_json(&doc).unwrap_or_else(|_| "{}".into())),
    )?;
    report.emitted.push(out);
    Ok(())
}

#[derive(Default)]
struct ProgramDeploymentExtras {
    region_ids: Vec<u32>,
    capabilities: Vec<String>,
    server_module_id: Option<String>,
    client_calls: Vec<(String, Option<String>)>,
    /// (component, strategy)
    resume_entries: Vec<(String, String)>,
}

/// Load deployment extras from emitted `*.program.json` via typed Program IR parse.
/// Source `.vmz` still goes through oxc; this only re-reads our own Program IR artifact
/// for incremental deployment aggregation.
fn read_program_deployment_extras(path: &Path) -> ProgramDeploymentExtras {
    let Ok(text) = fs::read_to_string(path) else {
        return ProgramDeploymentExtras::default();
    };
    let Ok(module) = serde_json::from_str::<ProgramModule>(&text) else {
        return ProgramDeploymentExtras::default();
    };
    let Some(unit) = module.units.first() else {
        return ProgramDeploymentExtras::default();
    };

    let mut extras = ProgramDeploymentExtras {
        region_ids: unit.deployment.region_ids.clone(),
        capabilities: unit.deployment.capabilities.clone(),
        server_module_id: unit.deployment.server_module_id.clone(),
        client_calls: unit
            .deployment
            .client_calls
            .iter()
            .map(|c| (c.method.clone(), c.from_client_method.clone()))
            .collect(),
        resume_entries: unit
            .deployment
            .resume_entries
            .iter()
            .map(|r| (r.component.clone(), r.strategy.as_str().to_string()))
            .collect(),
    };

    if extras.capabilities.is_empty() {
        for cap in &unit.server.capabilities {
            extras.capabilities.push(cap.method.clone());
        }
        extras.server_module_id = extras.server_module_id.or_else(|| unit.server.module_id.clone());
    }

    if extras.region_ids.is_empty() {
        extras.region_ids = unit.view.region_ids.iter().map(|id| id.0).collect();
    }

    extras
}
