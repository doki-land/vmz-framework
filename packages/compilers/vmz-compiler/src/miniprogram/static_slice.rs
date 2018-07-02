//! MP1 Static Slice — TemplateSurface lowering from Native View.
//!
//! Consumes Program IR `view` (+ binding ids from the same unit). Emits
//! [`MiniProgramArtifact`] fragments: vendor-neutral template text + logic
//! initialData. Not a WeChat WXML emitter; not a second IR.
//!
//! Supported (static): `text` / `interp` / `element` (non-event attrs).
//! Unsupported here (→ diagnostic, deferred): `if` / `each` / `component` /
//! `slot` / event wiring (MP2+) / lifecycle (MP3+).

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{Value, json};
use walkdir::WalkDir;

use vmz_protocol::{
    CheckReportStatus, DIAG_ARTIFACT_INVALID, DIAG_PLATFORM_UNSUPPORTED,
    MINI_PROGRAM_ARTIFACT_SCHEMA, MiniProgramArtifact, Severity, TargetDiagnostic, VmzModuleKind,
};
use vmz_types::{ProgramModule, ViewAttrValue, ViewNode, ViewStatus, ViewView};

/// Report schema for MP1 static-slice lowering.
pub const MINI_STATIC_SLICE_REPORT_SCHEMA: &str = "vmz.target.mini_static_slice.v0";

/// Logic fragment schema embedded inside [`MiniProgramArtifact::logic`].
pub const MINI_LOGIC_SCHEMA: &str = "vmz.mini.logic.v0";

/// Template dialect marker (vendor-neutral; not `wxml`).
pub const MINI_TEMPLATE_DIALECT: &str = "vmz.mini.template.v0";

/// One successfully lowered page unit.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MiniStaticSliceUnitResult {
    /// Deployment chunk id (posix-style).
    pub chunk_id: String,
    /// Program unit name.
    pub unit_name: String,
    /// Artifact path relative to workspace root.
    pub artifact_path: String,
    /// Lowered Mini Program artifact envelope.
    pub artifact: MiniProgramArtifact,
}

/// Aggregated static-slice lowering report for gates / N-API.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MiniStaticSliceReport {
    /// Always [`MINI_STATIC_SLICE_REPORT_SCHEMA`].
    pub schema: String,
    /// Aggregate status.
    pub status: CheckReportStatus,
    /// Template dialect id ([`MINI_TEMPLATE_DIALECT`]).
    pub dialect: String,
    /// Successfully written page artifacts.
    pub artifacts: Vec<MiniStaticSliceUnitResult>,
    /// Diagnostics collected during lowering.
    pub diagnostics: Vec<TargetDiagnostic>,
}

impl MiniStaticSliceReport {
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

/// Lower a Native View into a static MiniProgramArtifact (template + logic data).
pub fn lower_view_static_slice(
    platform_id: &str,
    view: &ViewView,
    path_for_diag: &str,
) -> Result<(MiniProgramArtifact, Vec<TargetDiagnostic>), Vec<TargetDiagnostic>> {
    let mut diagnostics = Vec::new();
    if view.status != ViewStatus::Native {
        diagnostics.push(diag(
            path_for_diag,
            Severity::Error,
            "static slice requires Native View (structural tree)",
            DIAG_ARTIFACT_INVALID,
        ));
        return Err(diagnostics);
    }
    if view.roots.is_empty() {
        diagnostics.push(diag(
            path_for_diag,
            Severity::Error,
            "static slice: empty view roots",
            DIAG_ARTIFACT_INVALID,
        ));
        return Err(diagnostics);
    }

    let mut bindings: BTreeMap<u32, ()> = BTreeMap::new();
    let mut body = String::new();
    for root in &view.roots {
        match emit_node(root, &mut bindings, path_for_diag, &mut diagnostics) {
            Ok(chunk) => body.push_str(&chunk),
            Err(()) => return Err(diagnostics),
        }
    }

    if diagnostics.iter().any(|d| d.is_error()) {
        return Err(diagnostics);
    }

    let template = if view.roots.len() == 1 {
        format!("<!-- {MINI_TEMPLATE_DIALECT} -->\n{body}")
    } else {
        format!("<!-- {MINI_TEMPLATE_DIALECT} -->\n<view class=\"vmz-root\">\n{body}</view>\n")
    };

    let mut b_obj = serde_json::Map::new();
    for id in bindings.keys() {
        b_obj.insert(format!("B_{id}"), Value::String(String::new()));
    }
    let logic = json!({
        "schema": MINI_LOGIC_SCHEMA,
        "initialData": { "b": b_obj },
    });

    let artifact = MiniProgramArtifact {
        schema: MINI_PROGRAM_ARTIFACT_SCHEMA.into(),
        platform_id: platform_id.into(),
        template: Some(template),
        style: None,
        logic: Some(crate::miniprogram::compact_json(&logic)),
        event_table: None,
        data_patch_table: None,
        manifest: None,
        plan_schema: vmz_protocol::PLAN_SCHEMA.into(),
    };
    Ok((artifact, diagnostics))
}

fn emit_node(
    node: &ViewNode,
    bindings: &mut BTreeMap<u32, ()>,
    path: &str,
    diags: &mut Vec<TargetDiagnostic>,
) -> Result<String, ()> {
    match node {
        ViewNode::Text { value } => Ok(escape_xml(value)),
        ViewNode::Interp { binding, .. } => {
            let Some(b) = binding else {
                diags.push(diag(
                    path,
                    Severity::Error,
                    "static slice: interp without BindingId",
                    DIAG_ARTIFACT_INVALID,
                ));
                return Err(());
            };
            bindings.insert(b.0, ());
            Ok(format!("{{{{b.B_{}}}}}", b.0))
        }
        ViewNode::Element { tag, attrs, children, each } => {
            if each.is_some() {
                diags.push(diag(
                    path,
                    Severity::Error,
                    format!("static slice does not lower `each` on <{tag}> (structure deferred)"),
                    DIAG_PLATFORM_UNSUPPORTED,
                ));
                return Err(());
            }
            let mut attr_s = String::new();
            for a in attrs {
                if is_event_attr(&a.name) {
                    // Event table is MP2 — omit from static template.
                    continue;
                }
                match &a.value {
                    ViewAttrValue::Static { value } => {
                        attr_s.push_str(&format!(" {}=\"{}\"", a.name, escape_xml_attr(value)));
                    }
                    ViewAttrValue::Bare => {
                        attr_s.push(' ');
                        attr_s.push_str(&a.name);
                    }
                    ViewAttrValue::Interp { .. } => {
                        if let Some(b) = a.binding {
                            bindings.insert(b.0, ());
                            attr_s.push_str(&format!(" {}=\"{{{{b.B_{}}}}}\"", a.name, b.0));
                        } else {
                            // No BindingId yet — keep opaque placeholder, do not invent expr eval.
                            attr_s.push_str(&format!(" {}=\"{{{{b.pending}}}}\"", a.name));
                        }
                    }
                }
            }
            let mut inner = String::new();
            for c in children {
                inner.push_str(&emit_node(c, bindings, path, diags)?);
            }
            if inner.is_empty() {
                Ok(format!("<{tag}{attr_s} />"))
            } else {
                Ok(format!("<{tag}{attr_s}>{inner}</{tag}>"))
            }
        }
        ViewNode::If { .. } => {
            diags.push(diag(
                path,
                Severity::Error,
                "static slice does not lower `if` (structure deferred)",
                DIAG_PLATFORM_UNSUPPORTED,
            ));
            Err(())
        }
        ViewNode::Component { tag, .. } => {
            diags.push(diag(
                path,
                Severity::Error,
                format!("static slice does not lower component <{tag}> (structure deferred)"),
                DIAG_PLATFORM_UNSUPPORTED,
            ));
            Err(())
        }
        ViewNode::Slot { .. } => {
            diags.push(diag(
                path,
                Severity::Error,
                "static slice does not lower `slot` (structure deferred)",
                DIAG_PLATFORM_UNSUPPORTED,
            ));
            Err(())
        }
    }
}

fn is_event_attr(name: &str) -> bool {
    let n = name.trim();
    n.starts_with('@') || n.starts_with("on") && n.len() > 2
}

fn escape_xml(s: &str) -> String {
    vmz_generator::escape_xml_text(s)
}

fn escape_xml_attr(s: &str) -> String {
    vmz_generator::escape_xml_attr(s)
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

/// Lower all **page** units under a workspace root; write `_vmz/mini/*.mini.json`.
pub fn lower_miniprogram_static_slices(root: &Path) -> MiniStaticSliceReport {
    let mut diagnostics = Vec::new();
    let mut artifacts = Vec::new();
    let programs = collect_program_json(root);
    if programs.is_empty() {
        diagnostics.push(diag(
            "",
            Severity::Advice,
            "no *.program.json — build workspace before mini static slice",
            "vmz::target::mini_static_slice_catalog_only",
        ));
        return MiniStaticSliceReport {
            schema: MINI_STATIC_SLICE_REPORT_SCHEMA.into(),
            status: CheckReportStatus::Incomplete,
            dialect: MINI_TEMPLATE_DIALECT.into(),
            artifacts,
            diagnostics,
        };
    }

    let out_mini = root.join("dist").join("_vmz").join("mini");
    let _ = fs::create_dir_all(&out_mini);

    for prog_path in &programs {
        let rel =
            prog_path.strip_prefix(root).unwrap_or(prog_path).to_string_lossy().replace('\\', "/");
        let text = match fs::read_to_string(prog_path) {
            Ok(t) => t,
            Err(e) => {
                diagnostics.push(diag(
                    &rel,
                    Severity::Error,
                    format!("read program.json failed: {e}"),
                    DIAG_ARTIFACT_INVALID,
                ));
                continue;
            }
        };
        let module: ProgramModule = match serde_json::from_str(&text) {
            Ok(m) => m,
            Err(e) => {
                diagnostics.push(diag(
                    &rel,
                    Severity::Error,
                    format!("parse program.json failed: {e}"),
                    DIAG_ARTIFACT_INVALID,
                ));
                continue;
            }
        };
        for unit in &module.units {
            let is_page = matches!(unit.deployment.unit_kind, Some(VmzModuleKind::Page))
                || unit
                    .deployment
                    .chunk_id
                    .as_deref()
                    .is_some_and(|c| c == "pages/index" || c.starts_with("pages/"));
            if !is_page {
                continue;
            }
            let chunk = unit.deployment.chunk_id.clone().unwrap_or_else(|| unit.name.clone());
            match lower_view_static_slice("mini-program", &unit.view, &rel) {
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
                    artifacts.push(MiniStaticSliceUnitResult {
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

    MiniStaticSliceReport {
        schema: MINI_STATIC_SLICE_REPORT_SCHEMA.into(),
        status,
        dialect: MINI_TEMPLATE_DIALECT.into(),
        artifacts,
        diagnostics,
    }
}
