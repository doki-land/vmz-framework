use std::fs;
use std::path::{Path, PathBuf};

use crate::affected::{AffectedPlan, chunk_id_for, plan_affected};
use crate::analyze::analyze_script;
use crate::check::{CheckOptions, check_path};
use crate::diagnostic::ReportedDiagnostic;
use crate::emit::{ServerBridge, emit_client_js_with_ir, emit_server_js};
use crate::project::{VmzModuleKind, discover_vmz_files};
use crate::reactive_build::build_program_module_with_server;
use crate::scss::{ScssCompilerHandle, ScssEmitRequest};
use crate::sfc::{ScriptKind, parse_vmz};
use crate::template::parse_template;
use crate::transpile::transpile_ts;
use crate::tw::{TwCompilerHandle, TwEmitRequest, register_tw_from_parsed};
use crate::virtual_server;
use vmz_types::{DeploymentView, StubStatus};
use walkdir::WalkDir;

#[derive(Clone)]
pub struct CompileOptions {
    pub out_dir: PathBuf,
    pub release: bool,
    /// TW style plugin. `None` skips TW emit.
    pub tw: Option<TwCompilerHandle>,
    /// SCSS style plugin. `None` skips `<style>` emit.
    pub scss: Option<ScssCompilerHandle>,
}

impl Default for CompileOptions {
    fn default() -> Self {
        Self { out_dir: PathBuf::from("dist"), release: false, tw: None, scss: None }
    }
}

impl std::fmt::Debug for CompileOptions {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CompileOptions")
            .field("out_dir", &self.out_dir)
            .field("release", &self.release)
            .field("tw", &self.tw.as_ref().map(|_| "Some(TwCompiler)"))
            .field("scss", &self.scss.as_ref().map(|_| "Some(ScssCompiler)"))
            .finish()
    }
}

#[derive(Debug, Clone)]
pub struct EmittedRoute {
    pub verb: String,
    pub path: String,
    pub module_id: String,
    pub method: String,
    pub class_name: String,
}

#[derive(Debug, Default)]
pub struct CompileReport {
    pub diagnostics: Vec<ReportedDiagnostic>,
    pub emitted: Vec<PathBuf>,
    pub routes: Vec<EmittedRoute>,
    /// N4: whether this was a full project emit.
    pub full: bool,
    /// N4: source `.vmz` paths rebuilt this round.
    pub affected_sources: Vec<PathBuf>,
    /// N4: deployment chunk ids rebuilt this round.
    pub affected_chunks: Vec<String>,
    /// N4.1: dirty seeds before reverse-edge expansion.
    pub seed_chunks: Vec<String>,
    /// N4.1: all affected units are components (island HMR eligible).
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
}

pub fn compile_path(
    path: impl AsRef<Path>,
    options: &CompileOptions,
) -> anyhow::Result<CompileReport> {
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
        emit_file(path, src_root, options, &mut report, kind, &chunk)?;
        emit_routes_json(options, &mut report)?;
        let project_root =
            path.parent().and_then(|p| p.parent()).unwrap_or_else(|| path.parent().unwrap_or(path));
        emit_stylesheets(project_root, options, &mut report)?;
        return Ok(report);
    }
    compile_project(path, options)
}

pub fn compile_project(
    root: impl AsRef<Path>,
    options: &CompileOptions,
) -> anyhow::Result<CompileReport> {
    compile_project_with_dirty(root, options, &[])
}

/// N4: when `dirty` is non-empty, re-emit only VPG-affected deployment units.
pub fn compile_project_with_dirty(
    root: impl AsRef<Path>,
    options: &CompileOptions,
    dirty: &[PathBuf],
) -> anyhow::Result<CompileReport> {
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
    for unit in &plan.units {
        emit_file(&unit.source, &src_root, options, &mut report, unit.kind, &unit.chunk_id)?;
    }
    if plan.full {
        emit_routes_json(options, &mut report)?;
    } else if !report.routes.is_empty() {
        merge_routes_json(options, &mut report)?;
    }
    emit_stylesheets(root, options, &mut report)?;
    emit_deployment_json(root, &src_root, options, &plan, &mut report)?;
    Ok(report)
}

fn emit_stylesheets(
    root: &Path,
    options: &CompileOptions,
    report: &mut CompileReport,
) -> anyhow::Result<()> {
    use crate::designs::{emit_style_theme_css, load_designs};
    use crate::style_emit::{StyleContribution, StyleLayer, emit_style_bundle};

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

    let emitted = emit_style_bundle(&options.out_dir, &contributions)?;
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
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else {
        return PrevStyleDeployment::default();
    };
    let mut prev = PrevStyleDeployment::default();
    if let Some(s) = v.get("cssEntry").and_then(|x| x.as_str()) {
        prev.css_entry = Some(s.to_string());
    }
    if let Some(h) = v.get("styleBundleHash").and_then(|x| x.as_str()) {
        prev.style_bundle_hash = Some(h.to_string());
    }
    if let Some(st) = v.get("styleTheme").and_then(|x| x.as_object()) {
        let mut prefers = std::collections::BTreeMap::new();
        if let Some(obj) = st.get("prefersColorScheme").and_then(|x| x.as_object()) {
            for (k, val) in obj {
                if let Some(id) = val.as_str() {
                    prefers.insert(k.clone(), id.to_string());
                }
            }
        }
        prev.style_theme = Some(crate::designs::StyleThemeSummary {
            default_theme_id: st
                .get("defaultThemeId")
                .and_then(|x| x.as_str())
                .unwrap_or("default")
                .to_string(),
            theme_ids: st
                .get("themeIds")
                .and_then(|x| x.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
                .unwrap_or_default(),
            activation_attr: st
                .get("activationAttr")
                .and_then(|x| x.as_str())
                .unwrap_or("data-theme")
                .to_string(),
            prefers_color_scheme: prefers,
            content_hash: st.get("contentHash").and_then(|x| x.as_str()).unwrap_or("").to_string(),
        });
    }
    prev
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

    let style_paths: Vec<PathBuf> = if let Some(entry) = &designs.style_entry {
        vec![entry.clone()]
    } else {
        designs.style_files.clone()
    };
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
fn emit_routes_json(options: &CompileOptions, report: &mut CompileReport) -> anyhow::Result<()> {
    let mut json = String::from("[\n");
    for (i, r) in report.routes.iter().enumerate() {
        if i > 0 {
            json.push_str(",\n");
        }
        json.push_str(&format!(
            "  {{\"verb\":{:?},\"path\":{:?},\"moduleId\":{:?},\"method\":{:?},\"className\":{:?}}}",
            r.verb, r.path, r.module_id, r.method, r.class_name
        ));
    }
    json.push_str("\n]\n");
    let out = options.out_dir.join("vmz-routes.json");
    fs::write(&out, &json)?;
    report.emitted.push(out);
    Ok(())
}

fn merge_routes_json(options: &CompileOptions, report: &mut CompileReport) -> anyhow::Result<()> {
    let out = options.out_dir.join("vmz-routes.json");
    let mut existing: Vec<EmittedRoute> = Vec::new();
    if out.is_file() {
        let text = fs::read_to_string(&out)?;
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
            if let Some(arr) = value.as_array() {
                for item in arr {
                    let Some(obj) = item.as_object() else { continue };
                    let verb = obj.get("verb").and_then(|v| v.as_str());
                    let path = obj.get("path").and_then(|v| v.as_str());
                    let module_id = obj.get("moduleId").and_then(|v| v.as_str());
                    let method = obj.get("method").and_then(|v| v.as_str());
                    let class_name = obj.get("className").and_then(|v| v.as_str());
                    if let (
                        Some(verb),
                        Some(path),
                        Some(module_id),
                        Some(method),
                        Some(class_name),
                    ) = (verb, path, module_id, method, class_name)
                    {
                        existing.push(EmittedRoute {
                            verb: verb.to_string(),
                            path: path.to_string(),
                            module_id: module_id.to_string(),
                            method: method.to_string(),
                            class_name: class_name.to_string(),
                        });
                    }
                }
            }
        }
    }
    let touched: std::collections::HashSet<String> =
        report.routes.iter().map(|r| r.module_id.clone()).collect();
    existing.retain(|r| !touched.contains(&r.module_id));
    existing.extend(report.routes.iter().cloned());
    report.routes = existing;
    emit_routes_json(options, report)
}

fn emit_runtime_js(options: &CompileOptions, report: &mut CompileReport) -> anyhow::Result<()> {
    let runtime_root =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../runtimes/vmz-runtime/dist");
    let copies = [
        ("server.js", "vmz-runtime.js"),
        ("dom.js", "vmz-dom.js"),
        ("http.js", "vmz-http.js"),
        ("serve-host.mjs", "vmz-serve-host.mjs"),
    ];
    for (src_name, out_name) in copies {
        let runtime_src = runtime_root.join(src_name);
        if !runtime_src.is_file() {
            report.diagnostics.push(ReportedDiagnostic::error(
                &runtime_src,
                format!("vmz runtime missing ({src_name})"),
            ));
            continue;
        }
        let out = options.out_dir.join(out_name);
        fs::copy(&runtime_src, &out)?;
        report.emitted.push(out);
    }
    Ok(())
}

/// Transpile `src/server/**/*.ts` `dist/#server/**/*.js`.
fn emit_server_tree(
    src_root: &Path,
    options: &CompileOptions,
    report: &mut CompileReport,
) -> anyhow::Result<()> {
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
        match transpile_ts(&source, &path.display().to_string()) {
            Ok(js) => {
                let rel = id.trim_start_matches("#server/");
                let out = options
                    .out_dir
                    .join("#server")
                    .join(rel.replace('/', std::path::MAIN_SEPARATOR_STR))
                    .with_extension("js");
                if let Some(parent) = out.parent() {
                    fs::create_dir_all(parent)?;
                }
                let js = format!("// virtual: {id}\n{js}");
                let js = virtual_server::rewrite_imports_to_relative(&js, &id);
                fs::write(&out, js)?;
                report.emitted.push(out);
            }
            Err(e) => {
                report
                    .diagnostics
                    .push(ReportedDiagnostic::error(path, format!("#server emit failed: {e}")));
            }
        }
    }
    Ok(())
}

fn emit_file(
    path: &Path,
    src_root: &Path,
    options: &CompileOptions,
    report: &mut CompileReport,
    kind: VmzModuleKind,
    chunk_id: &str,
) -> anyhow::Result<()> {
    let source = fs::read_to_string(path)?;
    let parsed = parse_vmz(path, source)?;
    register_tw_from_parsed(&parsed, &mut report.tw_registrations);
    let client = analyze_script(ScriptKind::Client, &parsed.client.content);
    let server = parsed.server.as_ref().map(|s| analyze_script(ScriptKind::Server, &s.content));
    let template_ir = parse_template(&parsed.template.content);

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
    let server_attach = server.as_ref().zip(server_id.as_ref()).map(|(an, id)| {
        let client_calls =
            crate::server_calls::collect_server_class_calls(&parsed.client.content, &an.decl.name);
        vmz_types::ServerAttach {
            module_id: id.clone(),
            class_name: an.decl.name.clone(),
            methods: an.decl.methods.clone(),
            client_calls,
        }
    });
    let mut program = build_program_module_with_server(
        &path.display().to_string(),
        &client.decl,
        &template_ir,
        server_attach.as_ref(),
    );
    if let Some(unit) = program.units.first_mut() {
        let region_ids: Vec<u32> = unit.view.region_ids.iter().map(|r| r.0).collect();
        let capabilities: Vec<String> =
            unit.server.capabilities.iter().map(|c| c.method.clone()).collect();
        let client_calls: Vec<(String, Option<String>)> = unit
            .server
            .calls
            .iter()
            .map(|e| (e.method.clone(), e.from_client_method.clone()))
            .collect();
        let server_module_id = unit.server.module_id.clone();
        let resume_entries = unit.collect_resume_entries_from_view();
        unit.deployment = DeploymentView {
            status: StubStatus::Partial,
            unit_kind: Some(
                match kind {
                    VmzModuleKind::App => "app",
                    VmzModuleKind::Page => "page",
                    VmzModuleKind::Component => "component",
                    VmzModuleKind::Other => "other",
                }
                .into(),
            ),
            chunk_id: Some(chunk_id.to_string()),
            client_entry: Some(client_rel),
            program_ir: Some(program_rel),
            region_ids,
            capabilities,
            server_module_id,
            client_calls,
            resume_entries,
        };
    }
    let reactive_comp = program.units.first().map(|u| &u.reactive);
    let native_view = program.units.first().map(|u| &u.view);
    let exec_plan = program.units.first().map(|u| &u.plan);

    let client_js = match emit_client_js_with_ir(
        &parsed.client.content,
        &client,
        &template_ir,
        bridge.as_ref(),
        reactive_comp,
        native_view,
        exec_plan,
    ) {
        Ok(js) => js,
        Err(e) => {
            report
                .diagnostics
                .push(ReportedDiagnostic::error(path, format!("client emit failed: {e}")));
            return Ok(());
        }
    };
    let client_path = out_dir.join(format!("{stem}.client.js"));
    let runtime_path = options.out_dir.join("vmz-runtime.js");
    let dom_path = options.out_dir.join("vmz-dom.js");
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
        js
    };
    fs::write(&client_path, &client_js)?;
    report.emitted.push(client_path);

    if let (Some(server_an), Some(server_block), Some(id)) =
        (server.as_ref(), parsed.server.as_ref(), server_id.as_ref())
    {
        let server_js = match emit_server_js(&server_block.content, server_an, id) {
            Ok(js) => js,
            Err(e) => {
                report
                    .diagnostics
                    .push(ReportedDiagnostic::error(path, format!("server emit failed: {e}")));
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

    let method_rw = client
        .decl
        .methods
        .iter()
        .filter(|m| !m.reads.is_empty() || !m.writes.is_empty())
        .map(|m| {
            let reads = m.reads.iter().map(|r| format!("{r:?}")).collect::<Vec<_>>().join(", ");
            let writes = m.writes.iter().map(|w| format!("{w:?}")).collect::<Vec<_>>().join(", ");
            format!("    {:?}: {{ \"reads\": [{reads}], \"writes\": [{writes}] }}", m.name)
        })
        .collect::<Vec<_>>()
        .join(",\n");
    let server_name = server
        .as_ref()
        .map(|s| format!("{:?}", s.decl.name.as_str()))
        .unwrap_or_else(|| "null".into());
    let server_mod =
        server_id.as_ref().map(|id| format!("{id:?}")).unwrap_or_else(|| "null".into());
    let meta = format!(
        "{{\n  \"file\": {:?},\n  \"client\": {:?},\n  \"server\": {server_name},\n  \"serverModule\": {server_mod},\n  \"templateRoots\": {},\n  \"methodRw\": {{\n{method_rw}\n  }}\n}}\n",
        path.display().to_string(),
        client.decl.name,
        template_ir.roots.len(),
    );
    let meta_path = out_dir.join(format!("{stem}.vmz.json"));
    fs::write(&meta_path, meta)?;
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
    fs::write(&reactive_path, reactive.to_json())?;
    report.emitted.push(reactive_path);
    let program_path = out_dir.join(format!("{stem}.program.json"));
    fs::write(&program_path, program.to_json())?;
    report.emitted.push(program_path);

    let _ = options.release;
    Ok(())
}

fn emit_deployment_json(
    root: &Path,
    src_root: &Path,
    options: &CompileOptions,
    plan: &AffectedPlan,
    report: &mut CompileReport,
) -> anyhow::Result<()> {
    let (_src, graph, catalog) = crate::affected::component_graph_for(root);
    let _ = src_root;

    let mut json = String::from("{\n  \"schema\": \"vmz.deployment.v0\",\n  \"units\": [\n");
    for (i, (source, kind, chunk_id)) in catalog.iter().enumerate() {
        if i > 0 {
            json.push_str(",\n");
        }
        let kind_s = match kind {
            VmzModuleKind::App => "app",
            VmzModuleKind::Page => "page",
            VmzModuleKind::Component => "component",
            VmzModuleKind::Other => "other",
        };
        let client = format!("{chunk_id}.client.js");
        let program = format!("{chunk_id}.program.json");
        let rebuilt = plan.units.iter().any(|p| p.chunk_id == *chunk_id);
        let depends = graph
            .deps
            .get(chunk_id)
            .map(|v| v.iter().map(|c| format!("{c:?}")).collect::<Vec<_>>().join(", "))
            .unwrap_or_default();
        let depended = graph
            .reverse
            .get(chunk_id)
            .map(|v| v.iter().map(|c| format!("{c:?}")).collect::<Vec<_>>().join(", "))
            .unwrap_or_default();
        let extras = read_program_deployment_extras(&options.out_dir.join(&program));
        let caps =
            extras.capabilities.iter().map(|c| format!("{c:?}")).collect::<Vec<_>>().join(", ");
        let regions =
            extras.region_ids.iter().map(|id| id.to_string()).collect::<Vec<_>>().join(", ");
        let calls = extras
            .client_calls
            .iter()
            .map(|(m, from)| {
                let from_s = match from {
                    Some(f) => format!("{f:?}"),
                    None => "null".into(),
                };
                format!("{{\"method\":{m:?},\"fromClientMethod\":{from_s}}}")
            })
            .collect::<Vec<_>>()
            .join(", ");
        let server_mod = match &extras.server_module_id {
            Some(id) => format!("{id:?}"),
            None => "null".into(),
        };
        let resumes = extras
            .resume_entries
            .iter()
            .map(|(comp, strat)| format!("{{\"component\":{comp:?},\"strategy\":{strat:?}}}"))
            .collect::<Vec<_>>()
            .join(", ");
        json.push_str(&format!(
            "    {{\"chunkId\":{chunk_id:?},\"kind\":{kind_s:?},\"source\":{:?},\"clientEntry\":{client:?},\"programIr\":{program:?},\"dependsOn\":[{depends}],\"dependedBy\":[{depended}],\"regionIds\":[{regions}],\"capabilities\":[{caps}],\"serverModuleId\":{server_mod},\"clientCalls\":[{calls}],\"resumeEntries\":[{resumes}],\"rebuilt\":{rebuilt}}}",
            source.display().to_string(),
        ));
    }
    json.push_str("\n  ],\n");
    json.push_str(&format!(
        "  \"affectedChunks\": [{}],\n",
        plan.units.iter().map(|u| format!("{:?}", u.chunk_id)).collect::<Vec<_>>().join(", ")
    ));
    json.push_str(&format!(
        "  \"seedChunks\": [{}],\n",
        plan.seed_chunks.iter().map(|c| format!("{c:?}")).collect::<Vec<_>>().join(", ")
    ));
    json.push_str(&format!("  \"islandHmr\": {},\n", plan.island_only()));
    match &report.css_entry {
        Some(css) => json.push_str(&format!("  \"cssEntry\": {css:?},\n")),
        None => json.push_str("  \"cssEntry\": null,\n"),
    }
    match &report.style_theme {
        Some(t) => {
            let ids = t.theme_ids.iter().map(|id| format!("{id:?}")).collect::<Vec<_>>().join(", ");
            let prefers = t
                .prefers_color_scheme
                .iter()
                .map(|(k, v)| format!("{k:?}:{v:?}"))
                .collect::<Vec<_>>()
                .join(", ");
            json.push_str(&format!(
                "  \"styleTheme\": {{\"defaultThemeId\":{:?},\"themeIds\":[{ids}],\"activationAttr\":{:?},\"prefersColorScheme\":{{{prefers}}},\"contentHash\":{:?}}},\n",
                t.default_theme_id, t.activation_attr, t.content_hash
            ));
        }
        None => json.push_str("  \"styleTheme\": null,\n"),
    }
    match &report.style_bundle_hash {
        Some(h) => json.push_str(&format!("  \"styleBundleHash\": {h:?},\n")),
        None => json.push_str("  \"styleBundleHash\": null,\n"),
    }
    json.push_str(&format!("  \"full\": {}\n}}\n", plan.full));
    let out = options.out_dir.join("vmz-deployment.json");
    fs::write(&out, json)?;
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

/// Load deployment extras from emitted `*.program.json` via JSON parse (not string scrape).
/// Source `.vmz` still goes through oxc; this only re-reads our own Program IR artifact
/// for incremental deployment aggregation.
fn read_program_deployment_extras(path: &Path) -> ProgramDeploymentExtras {
    let Ok(text) = fs::read_to_string(path) else {
        return ProgramDeploymentExtras::default();
    };
    let Ok(root) = serde_json::from_str::<serde_json::Value>(&text) else {
        return ProgramDeploymentExtras::default();
    };
    let unit = root
        .get("units")
        .and_then(|u| u.as_array())
        .and_then(|arr| arr.first())
        .cloned()
        .unwrap_or(serde_json::Value::Null);

    let mut extras = ProgramDeploymentExtras::default();
    if let Some(dep) = unit.get("deployment") {
        if let Some(arr) = dep.get("regionIds").and_then(|v| v.as_array()) {
            extras.region_ids = arr.iter().filter_map(|v| v.as_u64().map(|n| n as u32)).collect();
        }
        if let Some(arr) = dep.get("capabilities").and_then(|v| v.as_array()) {
            extras.capabilities =
                arr.iter().filter_map(|v| v.as_str().map(str::to_string)).collect();
        }
        extras.server_module_id =
            dep.get("serverModuleId").and_then(|v| v.as_str()).map(str::to_string);
        if let Some(arr) = dep.get("clientCalls").and_then(|v| v.as_array()) {
            for item in arr {
                let method = item.get("method").and_then(|v| v.as_str());
                let from = item
                    .get("fromClientMethod")
                    .and_then(|v| if v.is_null() { None } else { v.as_str().map(str::to_string) });
                if let Some(method) = method {
                    extras.client_calls.push((method.to_string(), from));
                }
            }
        }
        if let Some(arr) = dep.get("resumeEntries").and_then(|v| v.as_array()) {
            for item in arr {
                let component = item.get("component").and_then(|v| v.as_str());
                let strategy = item.get("strategy").and_then(|v| v.as_str());
                if let (Some(component), Some(strategy)) = (component, strategy) {
                    extras.resume_entries.push((component.to_string(), strategy.to_string()));
                }
            }
        }
    }

    if extras.capabilities.is_empty() {
        if let Some(server) = unit.get("server") {
            if let Some(arr) = server.get("capabilities").and_then(|v| v.as_array()) {
                for cap in arr {
                    if let Some(m) = cap.get("method").and_then(|v| v.as_str()) {
                        extras.capabilities.push(m.to_string());
                    }
                }
            }
            extras.server_module_id = extras
                .server_module_id
                .or_else(|| server.get("module_id").and_then(|v| v.as_str()).map(str::to_string));
        }
    }

    if extras.region_ids.is_empty() {
        if let Some(arr) =
            unit.get("view").and_then(|v| v.get("region_ids")).and_then(|v| v.as_array())
        {
            extras.region_ids = arr.iter().filter_map(|v| v.as_u64().map(|n| n as u32)).collect();
        }
    }

    extras
}
