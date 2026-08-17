//! Structure / lifecycle lowering (TemplateSurface).
//!
//! Extends binding/event: `if` / keyed `each` / `component` / `slot` become
//! vendor-neutral template markers; LifetimeRegion + Plan `dispose-region`
//! become lifecycle/dispose tables in `manifest`. Not a WXML emitter.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{json, Value};
use walkdir::WalkDir;

use vmz_protocol::{
    CheckReportStatus, DIAG_ARTIFACT_INVALID, MiniProgramArtifact, MINI_PROGRAM_ARTIFACT_SCHEMA,
    PLAN_SCHEMA, Severity, TargetDiagnostic, VmzModuleKind,
};
use vmz_types::{
    BindingKind, IrDepPath, PlanNode, ProgramModule, ProgramUnit, ReactiveComponent, ViewAttrValue,
    ViewNode, ViewStatus,
};

use super::binding_event::{MINI_DATA_PATCH_TABLE_SCHEMA, MINI_EVENT_TABLE_SCHEMA};
use super::static_slice::{MINI_LOGIC_SCHEMA, MINI_TEMPLATE_DIALECT};

/// Report schema for structure/lifecycle lowering.
pub const MINI_STRUCTURE_REPORT_SCHEMA: &str = "vmz.target.mini_structure.v0";

/// Lifecycle + dispose table schema (stored in [`MiniProgramArtifact::manifest`]).
pub const MINI_LIFECYCLE_TABLE_SCHEMA: &str = "vmz.mini.lifecycle_table.v0";

/// One successfully lowered unit (page or app shell).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MiniStructureUnitResult {
    /// Deployment chunk id.
    pub chunk_id: String,
    /// Program unit name.
    pub unit_name: String,
    /// Artifact path relative to workspace root.
    pub artifact_path: String,
    /// Lowered artifact envelope.
    pub artifact: MiniProgramArtifact,
}

/// Aggregated structure/lifecycle report.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MiniStructureReport {
    /// Always [`MINI_STRUCTURE_REPORT_SCHEMA`].
    pub schema: String,
    /// Aggregate status.
    pub status: CheckReportStatus,
    /// Template dialect id.
    pub dialect: String,
    /// Written artifacts.
    pub artifacts: Vec<MiniStructureUnitResult>,
    /// Diagnostics.
    pub diagnostics: Vec<TargetDiagnostic>,
}

impl MiniStructureReport {
    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

fn diag(path: &str, severity: Severity, message: impl Into<String>, code: &str) -> TargetDiagnostic {
    TargetDiagnostic::with_severity(path, severity, message).with_code(code)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EventHandlerRow {
    handler_id: String,
    event_kind: String,
    method: String,
    effect_id: u32,
    written_fields: Vec<u32>,
    affected_bindings: Vec<u32>,
    patch_paths: Vec<String>,
}

#[derive(Debug)]
struct EmitCtx<'a> {
    reactive: &'a ReactiveComponent,
    next_handler: u32,
    handlers: Vec<EventHandlerRow>,
    path: &'a str,
    diags: Vec<TargetDiagnostic>,
    failed: bool,
}

/// Lower one ProgramUnit (page or app) with structure + lifecycle.
pub fn lower_unit_structure(
    platform_id: &str,
    unit: &ProgramUnit,
    path_for_diag: &str,
) -> Result<(MiniProgramArtifact, Vec<TargetDiagnostic>), Vec<TargetDiagnostic>> {
    let mut diagnostics = Vec::new();
    if unit.view.status != ViewStatus::Native {
        diagnostics.push(diag(
            path_for_diag,
            Severity::Error,
            "structure slice requires Native View",
            DIAG_ARTIFACT_INVALID,
        ));
        return Err(diagnostics);
    }
    if unit.view.roots.is_empty() {
        diagnostics.push(diag(
            path_for_diag,
            Severity::Error,
            "structure slice: empty view roots",
            DIAG_ARTIFACT_INVALID,
        ));
        return Err(diagnostics);
    }

    let mut patch_bindings: BTreeMap<u32, ()> = BTreeMap::new();
    let mut ev = EmitCtx {
        reactive: &unit.reactive,
        next_handler: 0,
        handlers: Vec::new(),
        path: path_for_diag,
        diags: Vec::new(),
        failed: false,
    };

    let mut body = String::new();
    for root in &unit.view.roots {
        match emit_node(root, &mut patch_bindings, &mut ev) {
            Ok(chunk) => body.push_str(&chunk),
            Err(()) => {
                diagnostics.append(&mut ev.diags);
                return Err(diagnostics);
            }
        }
    }
    diagnostics.append(&mut ev.diags);
    if ev.failed || diagnostics.iter().any(|d| d.is_error()) {
        return Err(diagnostics);
    }

    let template = if unit.view.roots.len() == 1 {
        format!("<!-- {MINI_TEMPLATE_DIALECT} -->\n{body}")
    } else {
        format!("<!-- {MINI_TEMPLATE_DIALECT} -->\n<view class=\"vmz-root\">\n{body}</view>\n")
    };

    let mut b_obj = serde_json::Map::new();
    for id in patch_bindings.keys() {
        b_obj.insert(format!("B_{id}"), Value::String(String::new()));
    }
    let logic = json!({
        "schema": MINI_LOGIC_SCHEMA,
        "initialData": { "b": b_obj },
    });

    let data_patch = build_data_patch_table(&unit.reactive, &patch_bindings);
    let event_table = if ev.handlers.is_empty() {
        None
    } else {
        Some(
            json!({
                "schema": MINI_EVENT_TABLE_SCHEMA,
                "handlers": ev.handlers,
            })
            .to_string(),
        )
    };

    let lifecycle = build_lifecycle_table(unit);

    let artifact = MiniProgramArtifact {
        schema: MINI_PROGRAM_ARTIFACT_SCHEMA.into(),
        platform_id: platform_id.into(),
        template: Some(template),
        style: None,
        logic: Some(logic.to_string()),
        event_table,
        data_patch_table: Some(data_patch.to_string()),
        manifest: Some(lifecycle.to_string()),
        plan_schema: PLAN_SCHEMA.into(),
    };
    Ok((artifact, diagnostics))
}

fn build_lifecycle_table(unit: &ProgramUnit) -> Value {
    let is_page = matches!(unit.deployment.unit_kind, Some(VmzModuleKind::Page))
        || unit.deployment.chunk_id.as_deref().is_some_and(|c| c.starts_with("pages/"));

    let page_hooks = if is_page {
        json!({
            "onLoad": "activate",
            "onShow": "visible",
            "onHide": "hidden",
            "onUnload": "dispose",
        })
    } else {
        Value::Null
    };

    let regions: Vec<Value> = unit
        .lifetime
        .regions
        .iter()
        .map(|r| {
            json!({
                "regionId": r.id,
                "kind": r.kind.as_str(),
                "ownerUnit": r.owner_unit,
            })
        })
        .collect();

    let dispose: Vec<Value> = unit
        .plan
        .nodes
        .iter()
        .filter_map(|n| match n {
            PlanNode::DisposeRegion { id, region, source } => Some(json!({
                "planNodeId": id,
                "regionId": region,
                "source": source.map(|s| s.as_str()),
            })),
            _ => None,
        })
        .collect();

    json!({
        "schema": MINI_LIFECYCLE_TABLE_SCHEMA,
        "chunkId": unit.deployment.chunk_id,
        "unitKind": unit.deployment.unit_kind.map(|k| k.as_str()),
        "pageHooks": page_hooks,
        "regions": regions,
        "dispose": dispose,
    })
}

fn build_data_patch_table(reactive: &ReactiveComponent, patch_bindings: &BTreeMap<u32, ()>) -> Value {
    let mut bindings_out = Vec::new();
    let mut field_affects: BTreeMap<u32, BTreeSet<u32>> = BTreeMap::new();

    for b in &reactive.bindings {
        if !patch_bindings.contains_key(&b.id().0) {
            continue;
        }
        if b.kind() == BindingKind::Event {
            continue;
        }
        let reads: Vec<u32> = b.reads().iter().filter_map(field_root_id).collect();
        for f in &reads {
            field_affects.entry(*f).or_default().insert(b.id().0);
        }
        bindings_out.push(json!({
            "bindingId": b.id().0,
            "kind": b.kind().as_str(),
            "dataPath": format!("b.B_{}", b.id().0),
            "reads": reads,
        }));
    }

    let fields: Vec<Value> = field_affects
        .into_iter()
        .map(|(field_id, affects)| {
            let name = reactive
                .state_slots
                .iter()
                .find(|s| s.id.0 == field_id)
                .map(|s| s.name.clone())
                .unwrap_or_default();
            json!({
                "fieldId": field_id,
                "name": name,
                "affects": affects.into_iter().collect::<Vec<_>>(),
            })
        })
        .collect();

    json!({
        "schema": MINI_DATA_PATCH_TABLE_SCHEMA,
        "bindings": bindings_out,
        "fields": fields,
    })
}

fn field_root_id(path: &IrDepPath) -> Option<u32> {
    match path {
        IrDepPath::Field(f) | IrDepPath::Unknown(f) => Some(f.0),
        IrDepPath::StaticPath { root, .. } | IrDepPath::DynamicPath { root, .. } => Some(root.0),
        IrDepPath::ListItem { list, .. } => Some(list.0),
    }
}

fn written_field_ids(reactive: &ReactiveComponent, method: &str) -> Option<(u32, Vec<u32>)> {
    let effect = reactive.effects.iter().find(|e| e.name == method)?;
    let fields: Vec<u32> = effect.writes.iter().filter_map(|w| field_root_id(&w.path)).collect();
    Some((effect.id.0, fields))
}

fn affected_binding_ids(reactive: &ReactiveComponent, written: &[u32]) -> Vec<u32> {
    let written: BTreeSet<u32> = written.iter().copied().collect();
    let mut out = Vec::new();
    for b in &reactive.bindings {
        if b.kind() == BindingKind::Event {
            continue;
        }
        let hits = b.reads().iter().any(|r| field_root_id(r).is_some_and(|f| written.contains(&f)));
        if hits {
            out.push(b.id().0);
        }
    }
    out.sort_unstable();
    out.dedup();
    out
}

fn normalize_event_kind(attr: &str) -> String {
    let n = attr.trim();
    if let Some(rest) = n.strip_prefix('@') {
        return rest.to_ascii_lowercase();
    }
    if let Some(rest) = n.strip_prefix("on") {
        if !rest.is_empty() {
            return rest.to_ascii_lowercase();
        }
    }
    n.to_ascii_lowercase()
}

fn is_event_attr(name: &str) -> bool {
    let n = name.trim();
    n.starts_with('@') || (n.starts_with("on") && n.len() > 2)
}

fn emit_node(
    node: &ViewNode,
    patch_bindings: &mut BTreeMap<u32, ()>,
    ev: &mut EmitCtx<'_>,
) -> Result<String, ()> {
    match node {
        ViewNode::Text { value } => Ok(escape_xml(value)),
        ViewNode::Interp { binding, .. } => {
            let Some(b) = binding else {
                push_err(ev, "structure: interp without BindingId");
                return Err(());
            };
            patch_bindings.insert(b.0, ());
            Ok(format!("{{{{b.B_{}}}}}", b.0))
        }
        ViewNode::Element { tag, attrs, children, each } => {
            let mut attr_s = String::new();
            if let Some(e) = each {
                if let Some(list_b) = e.list_binding {
                    patch_bindings.insert(list_b.0, ());
                    attr_s.push_str(&format!(" data-vmz-each=\"b.B_{}\"", list_b.0));
                } else {
                    attr_s.push_str(&format!(
                        " data-vmz-each=\"{}\"",
                        escape_xml_attr(&e.list_expr)
                    ));
                }
                attr_s.push_str(&format!(" data-vmz-as=\"{}\"", escape_xml_attr(&e.as_name)));
                if let Some(key_b) = e.key_binding {
                    patch_bindings.insert(key_b.0, ());
                    attr_s.push_str(&format!(" data-vmz-key=\"b.B_{}\"", key_b.0));
                } else if let Some(key_expr) = &e.key_expr {
                    attr_s.push_str(&format!(" data-vmz-key-expr=\"{}\"", escape_xml_attr(key_expr)));
                }
                if let Some(r) = e.region {
                    attr_s.push_str(&format!(" data-vmz-region=\"{}\"", r.0));
                }
            }
            for a in attrs {
                if is_event_attr(&a.name) {
                    wire_event(a, &mut attr_s, ev)?;
                    continue;
                }
                emit_plain_attr(a, &mut attr_s, patch_bindings);
            }
            let mut inner = String::new();
            for c in children {
                inner.push_str(&emit_node(c, patch_bindings, ev)?);
            }
            if inner.is_empty() {
                Ok(format!("<{tag}{attr_s} />"))
            } else {
                Ok(format!("<{tag}{attr_s}>{inner}</{tag}>"))
            }
        }
        ViewNode::If { region, binding, branches } => {
            if let Some(b) = binding {
                patch_bindings.insert(b.0, ());
            }
            let mut out = String::new();
            for (i, br) in branches.iter().enumerate() {
                let mut open = String::from("<block");
                if i == 0 {
                    if let Some(b) = binding {
                        open.push_str(&format!(" data-vmz-if=\"b.B_{}\"", b.0));
                    } else if let Some(cond) = &br.cond {
                        open.push_str(&format!(" data-vmz-if-expr=\"{}\"", escape_xml_attr(cond)));
                    }
                } else if br.cond.is_none() {
                    open.push_str(" data-vmz-else");
                } else if let Some(cond) = &br.cond {
                    open.push_str(&format!(" data-vmz-elif-expr=\"{}\"", escape_xml_attr(cond)));
                }
                if let Some(r) = region {
                    open.push_str(&format!(" data-vmz-region=\"{}\"", r.0));
                }
                open.push('>');
                let body = emit_node(&br.body, patch_bindings, ev)?;
                out.push_str(&open);
                out.push_str(&body);
                out.push_str("</block>");
            }
            Ok(out)
        }
        ViewNode::Component { tag, attrs, children } => {
            let mut attr_s = format!(" name=\"{}\"", escape_xml_attr(tag));
            for a in attrs {
                if is_event_attr(&a.name) {
                    wire_event(a, &mut attr_s, ev)?;
                    continue;
                }
                match &a.value {
                    ViewAttrValue::Static { value } => {
                        attr_s.push_str(&format!(
                            " data-vmz-prop-{}=\"{}\"",
                            sanitize_prop(&a.name),
                            escape_xml_attr(value)
                        ));
                    }
                    ViewAttrValue::Bare => {
                        attr_s.push_str(&format!(" data-vmz-prop-{}", sanitize_prop(&a.name)));
                    }
                    ViewAttrValue::Interp { .. } => {
                        if let Some(b) = a.binding {
                            patch_bindings.insert(b.0, ());
                            attr_s.push_str(&format!(
                                " data-vmz-prop-{}=\"{{{{b.B_{}}}}}\"",
                                sanitize_prop(&a.name),
                                b.0
                            ));
                        }
                    }
                }
            }
            let mut inner = String::new();
            for c in children {
                inner.push_str(&emit_node(c, patch_bindings, ev)?);
            }
            if inner.is_empty() {
                Ok(format!("<vmz-component{attr_s} />"))
            } else {
                Ok(format!("<vmz-component{attr_s}>{inner}</vmz-component>"))
            }
        }
        ViewNode::Slot { name, attrs, children } => {
            let mut attr_s = String::new();
            if let Some(n) = name {
                if !n.is_empty() && n != "slot" {
                    attr_s.push_str(&format!(" name=\"{}\"", escape_xml_attr(n)));
                }
            }
            for a in attrs {
                if is_event_attr(&a.name) {
                    continue;
                }
                emit_plain_attr(a, &mut attr_s, patch_bindings);
            }
            let mut inner = String::new();
            for c in children {
                inner.push_str(&emit_node(c, patch_bindings, ev)?);
            }
            if inner.is_empty() {
                Ok(format!("<slot{attr_s} />"))
            } else {
                Ok(format!("<slot{attr_s}>{inner}</slot>"))
            }
        }
    }
}

fn sanitize_prop(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '-' })
        .collect()
}

fn emit_plain_attr(
    a: &vmz_types::ViewAttr,
    attr_s: &mut String,
    patch_bindings: &mut BTreeMap<u32, ()>,
) {
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
                patch_bindings.insert(b.0, ());
                attr_s.push_str(&format!(" {}=\"{{{{b.B_{}}}}}\"", a.name, b.0));
            } else {
                attr_s.push_str(&format!(" {}=\"{{{{b.pending}}}}\"", a.name));
            }
        }
    }
}

fn wire_event(
    a: &vmz_types::ViewAttr,
    attr_s: &mut String,
    ev: &mut EmitCtx<'_>,
) -> Result<(), ()> {
    let method = match &a.value {
        ViewAttrValue::Interp { expr } => expr.trim(),
        ViewAttrValue::Static { value } => value.trim(),
        ViewAttrValue::Bare => {
            push_err(ev, &format!("structure: bare event attr {}", a.name));
            return Err(());
        }
    };
    if method.is_empty() {
        push_err(ev, &format!("structure: empty handler on {}", a.name));
        return Err(());
    }
    let Some((effect_id, written)) = written_field_ids(ev.reactive, method) else {
        push_err(ev, &format!("structure: no Reactive effect for method `{method}`"));
        return Err(());
    };
    let affected = affected_binding_ids(ev.reactive, &written);
    let handler_id = format!("h{}", ev.next_handler);
    ev.next_handler += 1;
    let patch_paths: Vec<String> = affected.iter().map(|id| format!("b.B_{id}")).collect();
    attr_s.push_str(&format!(" data-vmz-on=\"{handler_id}\""));
    ev.handlers.push(EventHandlerRow {
        handler_id,
        event_kind: normalize_event_kind(&a.name),
        method: method.to_string(),
        effect_id,
        written_fields: written,
        affected_bindings: affected,
        patch_paths,
    });
    Ok(())
}

fn push_err(ev: &mut EmitCtx<'_>, message: &str) {
    ev.diags.push(diag(ev.path, Severity::Error, message, DIAG_ARTIFACT_INVALID));
    ev.failed = true;
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

fn is_page_or_app(unit: &ProgramUnit) -> bool {
    matches!(
        unit.deployment.unit_kind,
        Some(VmzModuleKind::Page) | Some(VmzModuleKind::App)
    ) || unit
        .deployment
        .chunk_id
        .as_deref()
        .is_some_and(|c| c.starts_with("pages/") || c == "Application")
}

/// Lower page + app units with structure/lifecycle; write `_vmz/mini/*.mini.json`.
pub fn lower_miniprogram_structure_slices(root: &Path) -> MiniStructureReport {
    let mut diagnostics = Vec::new();
    let mut artifacts = Vec::new();
    let programs = collect_program_json(root);
    if programs.is_empty() {
        diagnostics.push(diag(
            "",
            Severity::Advice,
            "no *.program.json — build workspace before mini structure slice",
            "vmz::target::mini_structure_catalog_only",
        ));
        return MiniStructureReport {
            schema: MINI_STRUCTURE_REPORT_SCHEMA.into(),
            status: CheckReportStatus::Incomplete,
            dialect: MINI_TEMPLATE_DIALECT.into(),
            artifacts,
            diagnostics,
        };
    }

    let out_mini = root.join("dist").join("_vmz").join("mini");
    let _ = fs::create_dir_all(&out_mini);

    for prog_path in &programs {
        let rel = prog_path
            .strip_prefix(root)
            .unwrap_or(prog_path)
            .to_string_lossy()
            .replace('\\', "/");
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
            if !is_page_or_app(unit) {
                continue;
            }
            let chunk = unit
                .deployment
                .chunk_id
                .clone()
                .unwrap_or_else(|| unit.name.clone());
            match lower_unit_structure("mini-program", unit, &rel) {
                Ok((artifact, mut unit_diags)) => {
                    diagnostics.append(&mut unit_diags);
                    let file_name = format!("{}.mini.json", chunk.replace('/', "__"));
                    let abs = out_mini.join(&file_name);
                    let body = serde_json::to_string_pretty(&artifact).unwrap_or_else(|_| "{}".into());
                    if let Err(e) = fs::write(&abs, format!("{body}\n")) {
                        diagnostics.push(diag(
                            &rel,
                            Severity::Error,
                            format!("write mini artifact failed: {e}"),
                            DIAG_ARTIFACT_INVALID,
                        ));
                        continue;
                    }
                    let artifact_rel = abs
                        .strip_prefix(root)
                        .unwrap_or(&abs)
                        .to_string_lossy()
                        .replace('\\', "/");
                    artifacts.push(MiniStructureUnitResult {
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

    MiniStructureReport {
        schema: MINI_STRUCTURE_REPORT_SCHEMA.into(),
        status,
        dialect: MINI_TEMPLATE_DIALECT.into(),
        artifacts,
        diagnostics,
    }
}
