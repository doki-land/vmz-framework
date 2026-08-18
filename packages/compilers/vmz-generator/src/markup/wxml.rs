//! Mini template dialect printer over Native View nodes.
//!
//! Prints vendor-neutral `vmz.mini.template.v0` markup. Event wiring needs a
//! [`ReactiveComponent`] when the profile enables handlers.

use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;
use vmz_types::{BindingKind, IrDepPath, ReactiveComponent, ViewAttr, ViewAttrValue, ViewNode};

use crate::core::{escape_xml_attr, escape_xml_text};

/// Template dialect marker (vendor-neutral; not WeChat `wxml`).
pub const MINI_TEMPLATE_DIALECT: &str = "vmz.mini.template.v0";

/// How much of the Native View surface this emit accepts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MiniTemplateProfile {
    /// MP1: text / interp / element (non-event). Rejects if/each/component/slot.
    Static,
    /// MP2: Static + event wiring. Rejects if/each/component/slot.
    BindingEvent,
    /// MP3: full structure (each / if / component / slot) + event wiring.
    Structure,
}

/// Stable event handler row for Mini `event_table`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MiniEventHandler {
    /// Handler id (`h0`, `h1`, …).
    pub handler_id: String,
    /// Normalized event kind (`click`, …).
    pub event_kind: String,
    /// Reactive effect / method name.
    pub method: String,
    /// Effect id.
    pub effect_id: u32,
    /// Written field ids.
    pub written_fields: Vec<u32>,
    /// Affected binding ids.
    pub affected_bindings: Vec<u32>,
    /// `setData` paths (`b.B_<id>`).
    pub patch_paths: Vec<String>,
}

/// Emit error (compiler maps to TargetDiagnostic codes).
#[derive(Debug, Clone)]
pub struct MiniEmitError {
    /// `artifact-invalid` or `unsupported`.
    pub kind: MiniEmitErrorKind,
    /// Human message.
    pub message: String,
}

/// Error kind for Mini template emit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MiniEmitErrorKind {
    /// Missing BindingId / effect / bare event, etc.
    ArtifactInvalid,
    /// Profile forbids this construct.
    Unsupported,
}

/// Successful Mini template emit.
#[derive(Debug, Clone)]
pub struct MiniTemplateEmit {
    /// Full template text including dialect comment (+ optional root wrap).
    pub template: String,
    /// Binding ids referenced by the template (for logic initialData / patch).
    pub patch_bindings: BTreeMap<u32, ()>,
    /// Wired event handlers (empty when profile omits events).
    pub handlers: Vec<MiniEventHandler>,
}

/// Emit Mini template with profile-gated capabilities.
///
/// `reactive` is required when the view contains event attrs and the profile
/// wires events (`BindingEvent` / `Structure`).
pub fn emit_mini_template_profile(
    roots: &[ViewNode],
    profile: MiniTemplateProfile,
    reactive: Option<&ReactiveComponent>,
) -> Result<MiniTemplateEmit, Vec<MiniEmitError>> {
    let mut patch_bindings = BTreeMap::new();
    let mut ctx = EmitCtx {
        profile,
        reactive,
        next_handler: 0,
        handlers: Vec::new(),
        errors: Vec::new(),
        failed: false,
    };

    let mut body = String::new();
    for root in roots {
        match emit_node(root, &mut patch_bindings, &mut ctx) {
            Ok(chunk) => body.push_str(&chunk),
            Err(()) => return Err(ctx.errors),
        }
    }
    if ctx.failed || !ctx.errors.is_empty() {
        return Err(ctx.errors);
    }

    let template = if roots.len() == 1 {
        format!("<!-- {MINI_TEMPLATE_DIALECT} -->\n{body}")
    } else {
        format!("<!-- {MINI_TEMPLATE_DIALECT} -->\n<view class=\"vmz-root\">\n{body}</view>\n")
    };

    Ok(MiniTemplateEmit { template, patch_bindings, handlers: ctx.handlers })
}

/// Convenience: Structure profile without event wiring (no reactive).
pub fn emit_mini_template(roots: &[ViewNode]) -> String {
    match emit_mini_template_profile(roots, MiniTemplateProfile::Structure, None) {
        Ok(e) => e.template,
        Err(_) => String::new(),
    }
}

struct EmitCtx<'a> {
    profile: MiniTemplateProfile,
    reactive: Option<&'a ReactiveComponent>,
    next_handler: u32,
    handlers: Vec<MiniEventHandler>,
    errors: Vec<MiniEmitError>,
    failed: bool,
}

fn push_err(ctx: &mut EmitCtx<'_>, kind: MiniEmitErrorKind, message: impl Into<String>) {
    ctx.errors.push(MiniEmitError { kind, message: message.into() });
    ctx.failed = true;
}

fn emit_node(
    node: &ViewNode,
    patch_bindings: &mut BTreeMap<u32, ()>,
    ctx: &mut EmitCtx<'_>,
) -> Result<String, ()> {
    match node {
        ViewNode::Text { value } => Ok(escape_xml_text(value)),
        ViewNode::Interp { binding, .. } => {
            let Some(b) = binding else {
                push_err(
                    ctx,
                    MiniEmitErrorKind::ArtifactInvalid,
                    "mini template: interp without BindingId",
                );
                return Err(());
            };
            patch_bindings.insert(b.0, ());
            Ok(format!("{{{{b.B_{}}}}}", b.0))
        }
        ViewNode::Element { tag, attrs, children, each } => {
            if each.is_some() && ctx.profile != MiniTemplateProfile::Structure {
                push_err(
                    ctx,
                    MiniEmitErrorKind::Unsupported,
                    format!("mini template does not lower `each` on <{tag}> for this profile"),
                );
                return Err(());
            }
            let mut attr_s = String::new();
            if let Some(e) = each {
                if let Some(list_b) = e.list_binding {
                    patch_bindings.insert(list_b.0, ());
                    attr_s.push_str(&format!(" data-vmz-each=\"b.B_{}\"", list_b.0));
                } else {
                    attr_s
                        .push_str(&format!(" data-vmz-each=\"{}\"", escape_xml_attr(&e.list_expr)));
                }
                attr_s.push_str(&format!(" data-vmz-as=\"{}\"", escape_xml_attr(&e.as_name)));
                if let Some(key_b) = e.key_binding {
                    patch_bindings.insert(key_b.0, ());
                    attr_s.push_str(&format!(" data-vmz-key=\"b.B_{}\"", key_b.0));
                } else if let Some(key_expr) = &e.key_expr {
                    attr_s
                        .push_str(&format!(" data-vmz-key-expr=\"{}\"", escape_xml_attr(key_expr)));
                }
                if let Some(r) = e.region {
                    attr_s.push_str(&format!(" data-vmz-region=\"{}\"", r.0));
                }
            }
            for a in attrs {
                if is_event_attr(&a.name) {
                    match ctx.profile {
                        MiniTemplateProfile::Static => continue,
                        MiniTemplateProfile::BindingEvent | MiniTemplateProfile::Structure => {
                            wire_event(a, &mut attr_s, ctx)?;
                        }
                    }
                    continue;
                }
                emit_plain_attr(a, &mut attr_s, patch_bindings);
            }
            let mut inner = String::new();
            for c in children {
                inner.push_str(&emit_node(c, patch_bindings, ctx)?);
            }
            if inner.is_empty() {
                Ok(format!("<{tag}{attr_s} />"))
            } else {
                Ok(format!("<{tag}{attr_s}>{inner}</{tag}>"))
            }
        }
        ViewNode::If { region, binding, branches } => {
            if ctx.profile != MiniTemplateProfile::Structure {
                push_err(
                    ctx,
                    MiniEmitErrorKind::Unsupported,
                    "mini template does not lower `if` for this profile",
                );
                return Err(());
            }
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
                let body = emit_node(&br.body, patch_bindings, ctx)?;
                out.push_str(&open);
                out.push_str(&body);
                out.push_str("</block>");
            }
            Ok(out)
        }
        ViewNode::Component { tag, attrs, children } => {
            if ctx.profile != MiniTemplateProfile::Structure {
                push_err(
                    ctx,
                    MiniEmitErrorKind::Unsupported,
                    format!("mini template does not lower component <{tag}> for this profile"),
                );
                return Err(());
            }
            let mut attr_s = format!(" name=\"{}\"", escape_xml_attr(tag));
            for a in attrs {
                if is_event_attr(&a.name) {
                    wire_event(a, &mut attr_s, ctx)?;
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
                inner.push_str(&emit_node(c, patch_bindings, ctx)?);
            }
            if inner.is_empty() {
                Ok(format!("<vmz-component{attr_s} />"))
            } else {
                Ok(format!("<vmz-component{attr_s}>{inner}</vmz-component>"))
            }
        }
        ViewNode::Slot { name, attrs, children } => {
            if ctx.profile != MiniTemplateProfile::Structure {
                push_err(
                    ctx,
                    MiniEmitErrorKind::Unsupported,
                    "mini template does not lower `slot` for this profile",
                );
                return Err(());
            }
            let mut attr_s = String::new();
            if let Some(n) = name
                && !n.is_empty()
                && n != "slot"
            {
                attr_s.push_str(&format!(" name=\"{}\"", escape_xml_attr(n)));
            }
            for a in attrs {
                if is_event_attr(&a.name) {
                    continue;
                }
                emit_plain_attr(a, &mut attr_s, patch_bindings);
            }
            let mut inner = String::new();
            for c in children {
                inner.push_str(&emit_node(c, patch_bindings, ctx)?);
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

fn emit_plain_attr(a: &ViewAttr, attr_s: &mut String, patch_bindings: &mut BTreeMap<u32, ()>) {
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

fn wire_event(a: &ViewAttr, attr_s: &mut String, ctx: &mut EmitCtx<'_>) -> Result<(), ()> {
    let Some(reactive) = ctx.reactive else {
        push_err(
            ctx,
            MiniEmitErrorKind::ArtifactInvalid,
            format!("mini template: event attr {} needs ReactiveComponent", a.name),
        );
        return Err(());
    };
    match wire_event_handler(a, reactive, &mut ctx.next_handler, &mut ctx.handlers) {
        Ok(h) => {
            attr_s.push_str(&format!(" data-vmz-on=\"{}\"", h.handler_id));
            Ok(())
        }
        Err(e) => {
            ctx.errors.push(e);
            ctx.failed = true;
            Err(())
        }
    }
}

/// Resolve an event attr to a handler row (shared by Mini dialect and WeChat print).
pub(crate) fn wire_event_handler(
    a: &ViewAttr,
    reactive: &ReactiveComponent,
    next_handler: &mut u32,
    handlers: &mut Vec<MiniEventHandler>,
) -> Result<MiniEventHandler, MiniEmitError> {
    let method = match &a.value {
        ViewAttrValue::Interp { expr } => expr.trim(),
        ViewAttrValue::Static { value } => value.trim(),
        ViewAttrValue::Bare => {
            return Err(MiniEmitError {
                kind: MiniEmitErrorKind::ArtifactInvalid,
                message: format!("mini template: bare event attr {}", a.name),
            });
        }
    };
    if method.is_empty() {
        return Err(MiniEmitError {
            kind: MiniEmitErrorKind::ArtifactInvalid,
            message: format!("mini template: empty handler on {}", a.name),
        });
    }
    let Some((effect_id, written)) = written_field_ids(reactive, method) else {
        return Err(MiniEmitError {
            kind: MiniEmitErrorKind::ArtifactInvalid,
            message: format!("mini template: no Reactive effect for method `{method}`"),
        });
    };
    let affected = affected_binding_ids(reactive, &written);
    let handler_id = format!("h{}", *next_handler);
    *next_handler += 1;
    let patch_paths: Vec<String> = affected.iter().map(|id| format!("b.B_{id}")).collect();
    let row = MiniEventHandler {
        handler_id,
        event_kind: normalize_event_kind(&a.name),
        method: method.to_string(),
        effect_id,
        written_fields: written,
        affected_bindings: affected,
        patch_paths,
    };
    handlers.push(row.clone());
    Ok(row)
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

pub(crate) fn normalize_event_kind(attr: &str) -> String {
    let n = attr.trim();
    if let Some(rest) = n.strip_prefix('@') {
        return rest.to_ascii_lowercase();
    }
    if let Some(rest) = n.strip_prefix("on")
        && !rest.is_empty()
    {
        return rest.to_ascii_lowercase();
    }
    n.to_ascii_lowercase()
}

pub(crate) fn is_event_attr(name: &str) -> bool {
    let n = name.trim();
    n.starts_with('@') || (n.starts_with("on") && n.len() > 2)
}

#[cfg(test)]
mod tests {
    use super::*;
    use vmz_types::{BindingId, ViewEach, ViewIfBranch, ViewNode};

    #[test]
    fn static_rejects_each() {
        let roots = [ViewNode::Element {
            tag: "li".into(),
            attrs: vec![],
            children: vec![],
            each: Some(ViewEach {
                list_expr: "items".into(),
                as_name: "it".into(),
                key_expr: None,
                list_binding: Some(BindingId(0)),
                key_binding: None,
                region: None,
            }),
        }];
        let err =
            emit_mini_template_profile(&roots, MiniTemplateProfile::Static, None).unwrap_err();
        assert!(err.iter().any(|e| e.kind == MiniEmitErrorKind::Unsupported));
    }

    #[test]
    fn structure_emits_each_and_if() {
        let roots = [
            ViewNode::Element {
                tag: "li".into(),
                attrs: vec![],
                children: vec![ViewNode::Interp {
                    expr: "it.name".into(),
                    binding: Some(BindingId(1)),
                }],
                each: Some(ViewEach {
                    list_expr: "items".into(),
                    as_name: "it".into(),
                    key_expr: Some("it.id".into()),
                    list_binding: Some(BindingId(0)),
                    key_binding: None,
                    region: None,
                }),
            },
            ViewNode::If {
                region: None,
                binding: Some(BindingId(3)),
                branches: vec![ViewIfBranch {
                    cond: Some("show".into()),
                    body: Box::new(ViewNode::Text { value: "hi".into() }),
                }],
            },
        ];
        let emit =
            emit_mini_template_profile(&roots, MiniTemplateProfile::Structure, None).expect("ok");
        assert!(emit.template.contains("data-vmz-each=\"b.B_0\""));
        assert!(emit.template.contains("data-vmz-if=\"b.B_3\""));
        assert!(emit.template.contains(MINI_TEMPLATE_DIALECT));
    }
}
