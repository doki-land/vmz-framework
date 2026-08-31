//! Route / `#server` / Canonical Style lowering (TemplateSurface).
//!
//! Composes on structure slice: wraps lifecycle manifest with route realization
//! and server transport stubs; fills `style` with vendor-neutral class/CSS tokens.
//! Not a WeChat WXML/WXSS emitter; does not ship `#server` implementation bodies.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{Value, json};
use walkdir::WalkDir;

use vmz_protocol::{
    CheckReportStatus, DIAG_ARTIFACT_INVALID, MiniProgramArtifact, Severity, TargetDiagnostic,
    VmzModuleKind,
};
use vmz_types::{ProgramModule, ProgramUnit, ViewAttrValue, ViewNode, ViewStatus};

use super::static_slice::MINI_TEMPLATE_DIALECT;
use super::structure::{MINI_LIFECYCLE_TABLE_SCHEMA, lower_unit_structure};

/// Report schema for route/server/style lowering.
pub const MINI_ROUTE_SERVER_STYLE_REPORT_SCHEMA: &str = "vmz.target.mini_route_server_style.v0";

/// Wrapped MP4 manifest schema (lifecycle + routes + server).
pub const MINI_MP4_MANIFEST_SCHEMA: &str = "vmz.mini.mp4_manifest.v0";

/// Route realization table schema.
pub const MINI_ROUTE_TABLE_SCHEMA: &str = "vmz.mini.route_table.v0";

/// `#server` client transport stub table schema.
pub const MINI_SERVER_TRANSPORT_SCHEMA: &str = "vmz.mini.server_transport.v0";

/// Canonical Style fragment schema (stored in [`MiniProgramArtifact::style`]).
pub const MINI_CANONICAL_STYLE_SCHEMA: &str = "vmz.mini.canonical_style.v0";

/// One lowered unit result.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MiniRouteServerStyleUnitResult {
    /// Deployment chunk id.
    pub chunk_id: String,
    /// Program unit name.
    pub unit_name: String,
    /// Artifact path relative to workspace root.
    pub artifact_path: String,
    /// Lowered artifact.
    pub artifact: MiniProgramArtifact,
}

/// Aggregated route/server/style report.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MiniRouteServerStyleReport {
    /// Always [`MINI_ROUTE_SERVER_STYLE_REPORT_SCHEMA`].
    pub schema: String,
    /// Aggregate status.
    pub status: CheckReportStatus,
    /// Template dialect id.
    pub dialect: String,
    /// Written artifacts.
    pub artifacts: Vec<MiniRouteServerStyleUnitResult>,
    /// Workspace-level route table (all pages).
    pub route_table: Value,
    /// Diagnostics.
    pub diagnostics: Vec<TargetDiagnostic>,
}

impl MiniRouteServerStyleReport {
    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        vmz_generator::to_pretty_json(self).unwrap_or_else(|_| "{}".into())
    }
}

fn diag(
    path: &str,
    severity: Severity,
    message: impl Into<String>,
    code: &str,
) -> TargetDiagnostic {
    TargetDiagnostic::with_severity(path, severity, message).with_code(code)
}

/// Lower one unit: structure base + route/server/style overlays.
pub fn lower_unit_route_server_style(
    platform_id: &str,
    unit: &ProgramUnit,
    workspace_routes: &Value,
    css_bundle: Option<&str>,
    path_for_diag: &str,
) -> Result<(MiniProgramArtifact, Vec<TargetDiagnostic>), Vec<TargetDiagnostic>> {
    let (mut artifact, mut diagnostics) = lower_unit_structure(platform_id, unit, path_for_diag)?;

    let lifecycle = artifact
        .manifest
        .as_ref()
        .and_then(|s| serde_json::from_str::<Value>(s).ok())
        .unwrap_or_else(|| {
            json!({
                "schema": MINI_LIFECYCLE_TABLE_SCHEMA,
                "regions": [],
                "dispose": [],
            })
        });

    let server = build_server_transport(unit);
    let unit_links = collect_route_links(&unit.view.roots);
    let style = build_canonical_style(unit, css_bundle);

    let manifest = json!({
        "schema": MINI_MP4_MANIFEST_SCHEMA,
        "lifecycle": lifecycle,
        "routes": {
            "schema": MINI_ROUTE_TABLE_SCHEMA,
            "self": {
                "routeId": unit.name,
                "chunkId": unit.deployment.chunk_id,
                "unitKind": unit.deployment.unit_kind.map(|k| k.as_str()),
            },
            "links": unit_links,
            "workspace": workspace_routes,
        },
        "serverTransport": server,
    });

    artifact.manifest = Some(crate::miniprogram::compact_json(&manifest));
    artifact.style = Some(crate::miniprogram::compact_json(&style));

    if artifact.template.as_deref().is_some_and(|t| t.contains("wx:") || t.contains("wxss")) {
        diagnostics.push(diag(
            path_for_diag,
            Severity::Error,
            "route/server/style slice must stay vendor-neutral (no wx:/wxss)",
            DIAG_ARTIFACT_INVALID,
        ));
        return Err(diagnostics);
    }

    Ok((artifact, diagnostics))
}

fn build_server_transport(unit: &ProgramUnit) -> Value {
    let capabilities: Vec<Value> = unit
        .server
        .capabilities
        .iter()
        .map(|c| {
            json!({
                "capabilityId": c.id.0,
                "method": c.method,
                "moduleId": unit.server.module_id,
                "callableFromClient": c.callable_from_client,
                "asyncBoundary": c.async_boundary,
                "transport": "mini-request",
                "scheme": "#server",
            })
        })
        .collect();

    let client_calls: Vec<Value> = {
        let from_server: Vec<Value> = unit
            .server
            .calls
            .iter()
            .map(|c| {
                json!({
                    "fromClientMethod": c.from_client_method,
                    "serverMethod": c.method,
                    "capabilityId": c.capability.0,
                })
            })
            .collect();
        if !from_server.is_empty() {
            from_server
        } else {
            unit.deployment
                .client_calls
                .iter()
                .map(|c| {
                    json!({
                        "fromClientMethod": c.from_client_method,
                        "serverMethod": c.method,
                    })
                })
                .collect()
        }
    };

    json!({
        "schema": MINI_SERVER_TRANSPORT_SCHEMA,
        "scheme": "#server",
        "transport": "mini-request",
        "moduleId": unit.server.module_id,
        "className": unit.server.class_name,
        "capabilities": capabilities,
        "clientCalls": client_calls,
        "implInMiniPackage": false,
    })
}

fn collect_route_links(roots: &[ViewNode]) -> Vec<Value> {
    let mut out = Vec::new();
    fn walk(node: &ViewNode, out: &mut Vec<Value>) {
        match node {
            ViewNode::Element { attrs, children, .. } => {
                let mut route_id = None;
                let mut href = None;
                for a in attrs {
                    let val = match &a.value {
                        ViewAttrValue::Static { value } => Some(value.as_str()),
                        _ => None,
                    };
                    if a.name == "data-vmz-route" {
                        route_id = val.map(str::to_string);
                    }
                    if a.name == "href" {
                        href = val.map(str::to_string);
                    }
                }
                if let Some(route_id) = route_id {
                    out.push(json!({
                        "routeId": route_id,
                        "href": href,
                    }));
                }
                for c in children {
                    walk(c, out);
                }
            }
            ViewNode::If { branches, .. } => {
                for b in branches {
                    walk(&b.body, out);
                }
            }
            ViewNode::Component { children, .. } | ViewNode::Slot { children, .. } => {
                for c in children {
                    walk(c, out);
                }
            }
            ViewNode::Text { .. } | ViewNode::Interp { .. } => {}
        }
    }
    for r in roots {
        walk(r, &mut out);
    }
    out
}

fn collect_class_tokens(roots: &[ViewNode]) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    fn walk(node: &ViewNode, out: &mut BTreeSet<String>) {
        match node {
            ViewNode::Element { attrs, children, .. } => {
                for a in attrs {
                    if a.name == "class" {
                        if let ViewAttrValue::Static { value } = &a.value {
                            for tok in value.split_whitespace() {
                                if !tok.is_empty() {
                                    out.insert(tok.to_string());
                                }
                            }
                        }
                    }
                }
                for c in children {
                    walk(c, out);
                }
            }
            ViewNode::If { branches, .. } => {
                for b in branches {
                    walk(&b.body, out);
                }
            }
            ViewNode::Component { children, attrs, .. } => {
                for a in attrs {
                    if a.name == "class" {
                        if let ViewAttrValue::Static { value } = &a.value {
                            for tok in value.split_whitespace() {
                                if !tok.is_empty() {
                                    out.insert(tok.to_string());
                                }
                            }
                        }
                    }
                }
                for c in children {
                    walk(c, out);
                }
            }
            ViewNode::Slot { children, .. } => {
                for c in children {
                    walk(c, out);
                }
            }
            ViewNode::Text { .. } | ViewNode::Interp { .. } => {}
        }
    }
    for r in roots {
        walk(r, &mut out);
    }
    out
}

fn build_canonical_style(unit: &ProgramUnit, css_bundle: Option<&str>) -> Value {
    let class_tokens: Vec<String> = collect_class_tokens(&unit.view.roots).into_iter().collect();
    let css = css_bundle.unwrap_or("").to_string();
    json!({
        "schema": MINI_CANONICAL_STYLE_SCHEMA,
        "classTokens": class_tokens,
        "css": css,
        "dialect": "vmz.canonical-style.v0",
        "wxss": false,
    })
}

fn build_workspace_route_table(modules: &[ProgramModule]) -> Value {
    let mut pages = Vec::new();
    for m in modules {
        for unit in &m.units {
            let is_page = matches!(unit.deployment.unit_kind, Some(VmzModuleKind::Page))
                || unit.deployment.chunk_id.as_deref().is_some_and(|c| c.starts_with("pages/"));
            if !is_page {
                continue;
            }
            pages.push(json!({
                "routeId": unit.name,
                "chunkId": unit.deployment.chunk_id,
                "pathHint": unit.deployment.chunk_id.as_ref().map(|c| {
                    format!("/{}", c.trim_start_matches("pages/").trim_end_matches("/index"))
                }),
            }));
        }
    }
    json!({
        "schema": MINI_ROUTE_TABLE_SCHEMA,
        "pages": pages,
    })
}

fn read_css_bundle(root: &Path) -> Option<String> {
    let dist = root.join("dist");
    let mut parts = Vec::new();
    for name in ["vmz.css", "vmz-tw.css", "vmz-designs.css"] {
        let p = dist.join(name);
        if let Ok(text) = fs::read_to_string(&p) {
            if !text.trim().is_empty() {
                parts.push(format!("/* {name} */\n{text}"));
            }
        }
    }
    if parts.is_empty() { None } else { Some(parts.join("\n")) }
}

fn collect_program_json(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let candidates = [root.join("dist"), root.to_path_buf()];
    for search in &candidates {
        if !search.exists() {
            continue;
        }
        for entry in WalkDir::new(search).into_iter().filter_map(|e| e.ok()) {
            let p = entry.path();
            let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
            if p.is_file() && name.ends_with(".program.json") {
                out.push(p.to_path_buf());
            }
        }
    }
    out.sort();
    out.dedup();
    out
}

fn is_page_or_app(unit: &ProgramUnit) -> bool {
    matches!(
        unit.deployment.unit_kind,
        Some(VmzModuleKind::Page) | Some(VmzModuleKind::Application)
    ) || unit
        .deployment
        .chunk_id
        .as_deref()
        .is_some_and(|c| c.starts_with("pages/") || c == "Application")
}

/// Lower page/app units with route + `#server` stubs + Canonical Style.
pub fn lower_miniprogram_route_server_style_slices(root: &Path) -> MiniRouteServerStyleReport {
    let mut diagnostics = Vec::new();
    let mut artifacts = Vec::new();
    let programs = collect_program_json(root);
    if programs.is_empty() {
        diagnostics.push(diag(
            "",
            Severity::Advice,
            "no *.program.json — build workspace before mini route/server/style slice",
            "vmz::target::mini_route_server_style_catalog_only",
        ));
        return MiniRouteServerStyleReport {
            schema: MINI_ROUTE_SERVER_STYLE_REPORT_SCHEMA.into(),
            status: CheckReportStatus::Incomplete,
            dialect: MINI_TEMPLATE_DIALECT.into(),
            artifacts,
            route_table: json!({ "schema": MINI_ROUTE_TABLE_SCHEMA, "pages": [] }),
            diagnostics,
        };
    }

    let mut modules = Vec::new();
    for prog_path in &programs {
        let rel =
            prog_path.strip_prefix(root).unwrap_or(prog_path).to_string_lossy().replace('\\', "/");
        match fs::read_to_string(prog_path).and_then(|t| {
            serde_json::from_str::<ProgramModule>(&t)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
        }) {
            Ok(m) => modules.push(m),
            Err(e) => {
                diagnostics.push(diag(
                    &rel,
                    Severity::Error,
                    format!("read/parse program.json failed: {e}"),
                    DIAG_ARTIFACT_INVALID,
                ));
            }
        }
    }

    let workspace_routes = build_workspace_route_table(&modules);
    let css_bundle = read_css_bundle(root);
    let out_mini = root.join("dist").join("_vmz").join("mini");
    let _ = fs::create_dir_all(&out_mini);

    for (prog_path, module) in programs.iter().zip(modules.iter()) {
        let rel =
            prog_path.strip_prefix(root).unwrap_or(prog_path).to_string_lossy().replace('\\', "/");
        for unit in &module.units {
            if !is_page_or_app(unit) {
                continue;
            }
            if unit.view.status != ViewStatus::Native {
                continue;
            }
            let chunk = unit.deployment.chunk_id.clone().unwrap_or_else(|| unit.name.clone());
            match lower_unit_route_server_style(
                "mini-program",
                unit,
                &workspace_routes,
                css_bundle.as_deref(),
                &rel,
            ) {
                Ok((artifact, mut unit_diags)) => {
                    diagnostics.append(&mut unit_diags);
                    let file_name = format!("{}.mini.json", chunk.replace('/', "__"));
                    let abs = out_mini.join(&file_name);
                    let body =
                        vmz_generator::to_pretty_json(&artifact).unwrap_or_else(|_| "{}".into());
                    if let Err(e) = fs::write(&abs, format!("{body}\n")) {
                        diagnostics.push(diag(
                            &rel,
                            Severity::Error,
                            format!("write mini artifact failed: {e}"),
                            DIAG_ARTIFACT_INVALID,
                        ));
                        continue;
                    }
                    let artifact_rel =
                        abs.strip_prefix(root).unwrap_or(&abs).to_string_lossy().replace('\\', "/");
                    artifacts.push(MiniRouteServerStyleUnitResult {
                        chunk_id: chunk,
                        unit_name: unit.name.clone(),
                        artifact_path: artifact_rel,
                        artifact,
                    });
                }
                Err(mut unit_diags) => diagnostics.append(&mut unit_diags),
            }
        }
    }

    let failed = diagnostics.iter().any(|d| d.is_error());
    let status = if failed {
        CheckReportStatus::Failed
    } else if artifacts.is_empty() {
        CheckReportStatus::Incomplete
    } else {
        CheckReportStatus::Ready
    };

    MiniRouteServerStyleReport {
        schema: MINI_ROUTE_SERVER_STYLE_REPORT_SCHEMA.into(),
        status,
        dialect: MINI_TEMPLATE_DIALECT.into(),
        artifacts,
        route_table: workspace_routes,
        diagnostics,
    }
}
