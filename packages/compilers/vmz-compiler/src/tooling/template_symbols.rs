//! Template symbol / span queries over Semantic AST (`0.1.20`).
//!
//! Spans are UTF-8 offsets into the `<template>` body. Callers add
//! `content_start` for file-absolute [`vmz_protocol::SourceSpan`].
//! Identifier location uses the source slice **inside** each node's span
//! (AST-anchored), never a whole-template JSX/`{name}` rescan.

use crate::parse::template_semantic::{SemanticIr, SemanticNode, SemanticProp};
use crate::parse::template_span::TemplateSpan;

/// Collect body-local `[start, end)` spans where `name` appears as a field/expr ident.
pub fn semantic_field_spans(
    semantic: &SemanticIr,
    template: &str,
    name: &str,
) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    walk_field(&semantic.roots, template, name, &mut out);
    out.sort_unstable();
    out.dedup();
    out
}

/// Collect body-local spans where `name` appears as an event handler ident.
pub fn semantic_handler_spans(
    semantic: &SemanticIr,
    template: &str,
    name: &str,
) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    walk_handler(&semantic.roots, template, name, &mut out);
    out.sort_unstable();
    out.dedup();
    out
}

/// Collect body-local spans of component / element tag names matching `tag`.
pub fn semantic_tag_spans(semantic: &SemanticIr, template: &str, tag: &str) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    walk_tag(&semantic.roots, template, tag, &mut out);
    out.sort_unstable();
    out.dedup();
    out
}

/// PascalCase / multi-segment component tags referenced in the Semantic tree.
pub fn semantic_component_tags(semantic: &SemanticIr) -> Vec<String> {
    let mut out = Vec::new();
    walk_component_tags(&semantic.roots, &mut out);
    out.sort();
    out.dedup();
    out
}

fn walk_field(nodes: &[SemanticNode], template: &str, name: &str, out: &mut Vec<(usize, usize)>) {
    for n in nodes {
        match n {
            SemanticNode::Text { .. } => {}
            SemanticNode::Interpolation { expr, span, .. } => {
                push_ident_in_span(template, *span, expr, name, out);
            }
            SemanticNode::Element { props, children, .. } => {
                for p in props {
                    for (expr, span) in prop_exprs(p) {
                        push_ident_in_span(template, span, expr, name, out);
                    }
                }
                walk_field(children, template, name, out);
            }
            SemanticNode::IfChain { branches, .. } => {
                for b in branches {
                    if let Some(test) = &b.test {
                        push_ident_in_span(template, b.span, test, name, out);
                    }
                    walk_field(std::slice::from_ref(b.body.as_ref()), template, name, out);
                }
            }
            SemanticNode::ForNode { source, key, body, span, .. } => {
                push_ident_in_span(template, *span, source, name, out);
                if let Some(k) = key {
                    push_ident_in_span(template, *span, k, name, out);
                }
                walk_field(std::slice::from_ref(body.as_ref()), template, name, out);
            }
            SemanticNode::SlotOutlet { props, children, .. } => {
                for p in props {
                    for (expr, span) in prop_exprs(p) {
                        push_ident_in_span(template, span, expr, name, out);
                    }
                }
                walk_field(children, template, name, out);
            }
            SemanticNode::SlotTemplate { slot_props, body, span, .. } => {
                if let Some(p) = slot_props {
                    push_ident_in_span(template, *span, p, name, out);
                }
                walk_field(std::slice::from_ref(body.as_ref()), template, name, out);
            }
        }
    }
}

fn walk_handler(nodes: &[SemanticNode], template: &str, name: &str, out: &mut Vec<(usize, usize)>) {
    for n in nodes {
        match n {
            SemanticNode::Text { .. } | SemanticNode::Interpolation { .. } => {}
            SemanticNode::Element { props, children, .. } => {
                for p in props {
                    if let SemanticProp::On { handler, span, .. } = p {
                        push_handler_ident(template, *span, handler, name, out);
                    }
                }
                walk_handler(children, template, name, out);
            }
            SemanticNode::IfChain { branches, .. } => {
                for b in branches {
                    walk_handler(std::slice::from_ref(b.body.as_ref()), template, name, out);
                }
            }
            SemanticNode::ForNode { body, .. } => {
                walk_handler(std::slice::from_ref(body.as_ref()), template, name, out);
            }
            SemanticNode::SlotOutlet { children, .. } => {
                walk_handler(children, template, name, out)
            }
            SemanticNode::SlotTemplate { body, .. } => {
                walk_handler(std::slice::from_ref(body.as_ref()), template, name, out);
            }
        }
    }
}

fn walk_tag(nodes: &[SemanticNode], template: &str, tag: &str, out: &mut Vec<(usize, usize)>) {
    for n in nodes {
        match n {
            SemanticNode::Text { .. } | SemanticNode::Interpolation { .. } => {}
            SemanticNode::Element { tag: t, children, span, .. } if t == tag => {
                push_tag_name_spans(template, *span, tag, out);
                walk_tag(children, template, tag, out);
            }
            SemanticNode::Element { children, .. } => walk_tag(children, template, tag, out),
            SemanticNode::IfChain { branches, .. } => {
                for b in branches {
                    walk_tag(std::slice::from_ref(b.body.as_ref()), template, tag, out);
                }
            }
            SemanticNode::ForNode { body, .. } => {
                walk_tag(std::slice::from_ref(body.as_ref()), template, tag, out);
            }
            SemanticNode::SlotOutlet { children, .. } => walk_tag(children, template, tag, out),
            SemanticNode::SlotTemplate { body, .. } => {
                walk_tag(std::slice::from_ref(body.as_ref()), template, tag, out);
            }
        }
    }
}

fn walk_component_tags(nodes: &[SemanticNode], out: &mut Vec<String>) {
    for n in nodes {
        match n {
            SemanticNode::Text { .. } | SemanticNode::Interpolation { .. } => {}
            SemanticNode::Element { tag, children, .. } => {
                if is_component_tag(tag) {
                    out.push(tag.clone());
                }
                walk_component_tags(children, out);
            }
            SemanticNode::IfChain { branches, .. } => {
                for b in branches {
                    walk_component_tags(std::slice::from_ref(b.body.as_ref()), out);
                }
            }
            SemanticNode::ForNode { body, .. } => {
                walk_component_tags(std::slice::from_ref(body.as_ref()), out);
            }
            SemanticNode::SlotOutlet { children, .. } => walk_component_tags(children, out),
            SemanticNode::SlotTemplate { body, .. } => {
                walk_component_tags(std::slice::from_ref(body.as_ref()), out);
            }
        }
    }
}

fn prop_exprs(p: &SemanticProp) -> Vec<(&str, TemplateSpan)> {
    match p {
        SemanticProp::Static { .. } => vec![],
        SemanticProp::Bind { expr, span, .. } | SemanticProp::BindObject { expr, span } => {
            vec![(expr.as_str(), *span)]
        }
        SemanticProp::On { .. } => vec![], // handlers use walk_handler
        SemanticProp::OnObject { expr, span } => vec![(expr.as_str(), *span)],
        SemanticProp::Model { expr, span, .. } => vec![(expr.as_str(), *span)],
        SemanticProp::ClassPlan { binds, span, .. }
        | SemanticProp::StylePlan { binds, span, .. } => {
            binds.iter().map(|b| (b.as_str(), *span)).collect()
        }
        SemanticProp::Directive { dir, span } => match dir {
            crate::parse::template_concrete::Directive::Show { expr }
            | crate::parse::template_concrete::Directive::Html { expr } => {
                vec![(expr.as_str(), *span)]
            }
            crate::parse::template_concrete::Directive::Custom { expr: Some(e), .. } => {
                vec![(e.as_str(), *span)]
            }
            _ => vec![],
        },
    }
}

fn push_ident_in_span(
    template: &str,
    span: TemplateSpan,
    expr: &str,
    name: &str,
    out: &mut Vec<(usize, usize)>,
) {
    if !expr_mentions_ident(expr, name) {
        return;
    }
    let start = span.start as usize;
    let end = (span.end as usize).min(template.len());
    if start >= end || end > template.len() {
        return;
    }
    let slice = &template[start..end];
    let mut from = 0;
    while let Some(i) = slice[from..].find(name) {
        let abs = start + from + i;
        let end_i = abs + name.len();
        if is_ident_boundary(template, abs, end_i) {
            out.push((abs, end_i));
        }
        from += i + name.len();
    }
}

fn push_handler_ident(
    template: &str,
    span: TemplateSpan,
    handler: &str,
    name: &str,
    out: &mut Vec<(usize, usize)>,
) {
    let trimmed = handler.trim();
    let mentions = trimmed == name
        || trimmed.strip_prefix("this.").is_some_and(|r| {
            r == name || r.starts_with(&format!("{name}(")) || r.starts_with(&format!("{name} "))
        })
        || trimmed.starts_with(&format!("{name}("))
        || expr_mentions_ident(trimmed, name);
    if !mentions {
        return;
    }
    push_ident_in_span(template, span, handler, name, out);
}

fn push_tag_name_spans(
    template: &str,
    span: TemplateSpan,
    tag: &str,
    out: &mut Vec<(usize, usize)>,
) {
    let start = span.start as usize;
    let end = (span.end as usize).min(template.len());
    if start >= end {
        return;
    }
    let slice = &template[start..end];
    for prefix in ["<", "</"] {
        let pat = format!("{prefix}{tag}");
        let mut from = 0;
        while let Some(i) = slice[from..].find(&pat) {
            let abs = start + from + i + prefix.len();
            let end_i = abs + tag.len();
            let next = template.as_bytes().get(end_i).copied().unwrap_or(b' ');
            if matches!(next, b'>' | b'/' | b' ' | b'\n' | b'\r' | b'\t') {
                out.push((abs, end_i));
            }
            from += i + pat.len();
        }
    }
}

fn expr_mentions_ident(expr: &str, name: &str) -> bool {
    let bytes = expr.as_bytes();
    let n = name.as_bytes();
    if n.is_empty() {
        return false;
    }
    let mut i = 0;
    while i + n.len() <= bytes.len() {
        if &bytes[i..i + n.len()] == n && is_ident_boundary(expr, i, i + n.len()) {
            return true;
        }
        i += 1;
    }
    false
}

fn is_ident_boundary(src: &str, start: usize, end: usize) -> bool {
    let b = src.as_bytes();
    let before_ok = start == 0 || !is_ident_byte(b[start - 1]);
    let after_ok = end >= b.len() || !is_ident_byte(b[end]);
    before_ok && after_ok
}

fn is_ident_byte(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_' || c == b'$'
}

fn is_component_tag(tag: &str) -> bool {
    tag.starts_with(|c: char| c.is_ascii_uppercase()) || tag.contains('-')
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse::template_concrete::parse_template_concrete;
    use crate::parse::template_semantic::lower_concrete_to_semantic;

    #[test]
    fn field_span_comes_from_interpolation_not_jsx_braces() {
        let src = r#"<p>{{ count }}</p><span :title="count">x</span>"#;
        let concrete = parse_template_concrete(src).unwrap();
        let sem = lower_concrete_to_semantic(&concrete).unwrap();
        let spans = semantic_field_spans(&sem, src, "count");
        assert!(spans.len() >= 2, "{spans:?}");
        for (s, e) in &spans {
            assert_eq!(&src[*s..*e], "count");
        }
        // Must not invent JSX `{count}` hits outside Vue forms.
        assert!(!src.contains("{count}"));
    }

    #[test]
    fn handler_span_from_on_plan() {
        let src = r#"<button @click="save">ok</button>"#;
        let concrete = parse_template_concrete(src).unwrap();
        let sem = lower_concrete_to_semantic(&concrete).unwrap();
        let spans = semantic_handler_spans(&sem, src, "save");
        assert_eq!(spans.len(), 1, "{spans:?}");
        assert_eq!(&src[spans[0].0..spans[0].1], "save");
    }

    #[test]
    fn component_tag_spans_from_element_nodes() {
        let src = r#"<Card title="t"><Card /></Card>"#;
        let concrete = parse_template_concrete(src).unwrap();
        let sem = lower_concrete_to_semantic(&concrete).unwrap();
        assert_eq!(semantic_component_tags(&sem), vec!["Card".to_string()]);
        let spans = semantic_tag_spans(&sem, src, "Card");
        assert!(spans.len() >= 2, "{spans:?}");
    }
}
