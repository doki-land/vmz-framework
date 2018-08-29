//! Seed WeChat `Page({ data: { b: { B_*: ... } } })` from BindingId + field literals.
//!
//! WXML interpolations read `data.b.B_<id>` (same paths as `data_patch_table`).
//! Pack maps class field initializer text onto those BindingIds. This is not a
//! `setData` authoring API. Inits that mention `this` stay out (not JSON-shaped).
//! Event BindingIds are never seeded into `data`.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use vmz_types::{BindingKind, IrDepPath, ProgramUnit, ViewEach, ViewNode};

use crate::analyze::analyze_script;
use crate::parse::sfc::{ScriptKind, parse_vmz};

fn resolve_source(root: &Path, source: &str) -> Option<PathBuf> {
    let source = source.trim();
    if source.is_empty() {
        return None;
    }
    let direct = PathBuf::from(source);
    if direct.is_file() {
        return Some(direct);
    }
    let rel = root.join(source);
    rel.is_file().then_some(rel)
}

fn is_ident(name: &str) -> bool {
    let mut chars = name.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn is_packable_init(text: &str) -> bool {
    !text.contains("this.") && !text.contains("this[")
}

fn field_root_id(path: &IrDepPath) -> Option<u32> {
    match path {
        IrDepPath::Field(f) | IrDepPath::Unknown(f) => Some(f.0),
        IrDepPath::StaticPath { root, .. } | IrDepPath::DynamicPath { root, .. } => Some(root.0),
        IrDepPath::ListItem { list, .. } => Some(list.0),
    }
}

/// Field name + initializer text safe to embed in Page data (pre-BindingId map).
pub fn page_data_fields(root: &Path, module_source: &str) -> Vec<(String, String)> {
    let Some(path) = resolve_source(root, module_source) else {
        return Vec::new();
    };
    let Ok(text) = fs::read_to_string(&path) else {
        return Vec::new();
    };
    let Ok(parsed) = parse_vmz(&path, text) else {
        return Vec::new();
    };
    let analyzed = analyze_script(ScriptKind::Client, &parsed.client.content);
    let mut out = Vec::new();
    for field in &analyzed.decl.fields {
        if !is_ident(&field.name) {
            continue;
        }
        let Some(init) = field.init_text.as_deref().map(str::trim).filter(|s| !s.is_empty()) else {
            continue;
        };
        if !is_packable_init(init) {
            continue;
        }
        out.push((field.name.clone(), init.to_string()));
    }
    out
}

fn view_binding_field_name(nodes: &[ViewNode], binding_id: u32) -> Option<String> {
    for node in nodes {
        match node {
            ViewNode::Interp { expr, binding } => {
                if binding.map(|b| b.0) == Some(binding_id) && is_ident(expr.trim()) {
                    return Some(expr.trim().to_string());
                }
            }
            ViewNode::Element { children, each, attrs, .. } => {
                if let Some(ViewEach { list_expr, list_binding, .. }) = each {
                    if list_binding.map(|b| b.0) == Some(binding_id) && is_ident(list_expr.trim()) {
                        return Some(list_expr.trim().to_string());
                    }
                }
                for a in attrs {
                    if a.binding.map(|b| b.0) == Some(binding_id) {
                        if let vmz_types::ViewAttrValue::Interp { expr } = &a.value {
                            if is_ident(expr.trim()) {
                                return Some(expr.trim().to_string());
                            }
                        }
                    }
                }
                if let Some(name) = view_binding_field_name(children, binding_id) {
                    return Some(name);
                }
            }
            ViewNode::If { binding, branches, .. } => {
                if binding.map(|b| b.0) == Some(binding_id) {
                    if let Some(cond) = branches.iter().find_map(|br| br.cond.as_deref()) {
                        if is_ident(cond.trim()) {
                            return Some(cond.trim().to_string());
                        }
                    }
                }
                for br in branches {
                    if let Some(name) =
                        view_binding_field_name(std::slice::from_ref(&br.body), binding_id)
                    {
                        return Some(name);
                    }
                }
            }
            ViewNode::Component { children, .. } => {
                if let Some(name) = view_binding_field_name(children, binding_id) {
                    return Some(name);
                }
            }
            _ => {}
        }
    }
    None
}

fn resolve_binding_init(
    unit: &ProgramUnit,
    binding_id: u32,
    init_by_name: &BTreeMap<&str, &str>,
) -> Option<String> {
    if let Some(b) = unit.reactive.bindings.iter().find(|b| b.id().0 == binding_id) {
        for read in b.reads() {
            let Some(fid) = field_root_id(read) else {
                continue;
            };
            let Some(slot) = unit.reactive.state_slots.iter().find(|s| s.id.0 == fid) else {
                continue;
            };
            if let Some(init) = init_by_name.get(slot.name.as_str()) {
                return Some((*init).to_string());
            }
        }
    }
    let name = view_binding_field_name(&unit.view.roots, binding_id)?;
    init_by_name.get(name.as_str()).map(|s| (*s).to_string())
}

/// BindingId-shaped seeds: `(B_<id>, initializer)` for `data.b`.
///
/// `patch_bindings` comes from the WeChat WXML printer (same ids as mustache paths).
pub fn page_binding_data_fields(
    unit: &ProgramUnit,
    field_inits: &[(String, String)],
    patch_bindings: &BTreeMap<u32, ()>,
) -> Vec<(String, String)> {
    let init_by_name: BTreeMap<&str, &str> =
        field_inits.iter().map(|(n, v)| (n.as_str(), v.as_str())).collect();
    let mut out = Vec::new();
    for &id in patch_bindings.keys() {
        if unit.reactive.bindings.iter().any(|b| b.id().0 == id && b.kind() == BindingKind::Event) {
            continue;
        }
        let init = resolve_binding_init(unit, id, &init_by_name).unwrap_or_else(|| "null".into());
        out.push((format!("B_{id}"), init));
    }
    out
}

/// Chrome `Page({...})` source: optional BindingId `data.b`, tab `onShow`, share menu.
pub fn format_page_js(
    share_title_json: &str,
    binding_fields: &[(String, String)],
    tab_selected: Option<u32>,
) -> String {
    let mut body = String::from("Page({\n");
    if !binding_fields.is_empty() {
        body.push_str("  data: {\n");
        body.push_str("    b: {\n");
        for (i, (name, init)) in binding_fields.iter().enumerate() {
            body.push_str("      ");
            body.push_str(name);
            body.push_str(": ");
            body.push_str(init);
            if i + 1 != binding_fields.len() {
                body.push(',');
            }
            body.push('\n');
        }
        body.push_str("    }\n");
        body.push_str("  },\n");
    }
    if let Some(index) = tab_selected {
        body.push_str("  onShow() {\n");
        body.push_str(
            "    const bar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;\n",
        );
        body.push_str("    if (bar) {\n");
        body.push_str("      bar.setData({ selected: ");
        body.push_str(&index.to_string());
        body.push_str(" });\n");
        body.push_str("    }\n");
        body.push_str("  },\n");
    }
    body.push_str("  onShareAppMessage() { return { title: ");
    body.push_str(share_title_json);
    body.push_str(" }; }\n});\n");
    body
}
