//! Lower Oak Vue AST → VMZ Concrete / Semantic Template IR (stage C primary).

use core::range::Range;

use oak_vue::{VueAttribute, VueElement, VueNode, VueRoot};
use vmz_oak_frontend_adapter::{TemplateShellInput, parse_template_ast};

use super::template_common::{TemplateParseError, decode_html_entities};
use super::template_concrete::{ConcreteAttr, ConcreteIr, ConcreteNode, classify_concrete_attr};
use super::template_semantic::{
    ControlFlowKind, IfBranch, SemanticIr, SemanticNode, SemanticProp, control_flow_kind,
    if_chain_from_branches, semantic_from_element_parts, validate_root_slot_templates,
};
use super::template_span::TemplateSpan;
use crate::sfc::TemplateBlock;

const TEMPLATE_OPEN: &str = "<template>";

/// Build VMZ [`ConcreteIr`] from a VMZ template block via Oak CST + AST.
pub fn parse_template_concrete_via_oak(
    template: &TemplateBlock,
) -> Result<ConcreteIr, TemplateParseError> {
    let shell = TemplateShellInput {
        content: template.content.clone(),
        content_start: template.content_start,
    };
    let parsed = parse_template_ast(&shell);
    let root = ast_root_or_fail(&parsed)?;
    lower_vue_root_to_concrete(root, &parsed.shell_source)
}

/// Oak Vue AST → [`SemanticIr`] **without** a [`ConcreteIr`] hop.
///
/// Attr strings are classified with [`classify_concrete_attr`] (shared algebra);
/// control flow is structured while walking Oak [`VueNode`]s.
pub fn parse_template_semantic_via_oak(
    template: &TemplateBlock,
) -> Result<SemanticIr, TemplateParseError> {
    let shell = TemplateShellInput {
        content: template.content.clone(),
        content_start: template.content_start,
    };
    let parsed = parse_template_ast(&shell);
    let root = ast_root_or_fail(&parsed)?;
    lower_vue_root_to_semantic(root, &parsed.shell_source)
}

/// Lower an Oak [`VueRoot`] straight to Semantic (no Concrete forest).
pub fn lower_vue_root_to_semantic(
    root: &VueRoot,
    shell: &str,
) -> Result<SemanticIr, TemplateParseError> {
    let block = root
        .blocks
        .iter()
        .find(|b| slice(shell, b.name) == "template")
        .ok_or_else(|| TemplateParseError::coded("vmz::template::missing_block", 0))?;
    let roots = lower_oak_siblings(shell, &block.children)?;
    validate_root_slot_templates(&roots)?;
    Ok(SemanticIr { roots })
}

/// Parse a template **body** string into [`ConcreteIr`] through Oak (body-relative spans).
pub fn parse_template_concrete_body_primary(input: &str) -> Result<ConcreteIr, TemplateParseError> {
    parse_template_concrete_primary(&TemplateBlock { content: input.to_string(), content_start: 0 })
}

/// Parse the `<template>` region of a `.vmz` file into [`ConcreteIr`] through Oak.
///
/// Concrete only — Semantic is not lowered here, so callers that inspect raw
/// directives (or report control-flow errors later) keep the two layers separate.
pub fn parse_template_concrete_primary(
    template: &TemplateBlock,
) -> Result<ConcreteIr, TemplateParseError> {
    let shell = TemplateShellInput {
        content: template.content.clone(),
        content_start: template.content_start,
    };
    let parsed = parse_template_ast(&shell);
    let root = ast_root_or_fail(&parsed)?;
    lower_vue_root_to_concrete(root, &parsed.shell_source)
}

/// Oak Vue AST → Concrete + Semantic in one parse.
///
/// Oak is the only template parser: a rejection is returned as [`TemplateParseError`],
/// there is no string-scanner fallback. Semantic is lowered **directly** from Oak (no
/// Concrete→Semantic hop). Concrete is still produced for legacy TemplateIr emit until
/// Execution IR lands.
pub fn parse_template_layers_primary(
    template: &TemplateBlock,
) -> Result<(ConcreteIr, SemanticIr), TemplateParseError> {
    let shell = TemplateShellInput {
        content: template.content.clone(),
        content_start: template.content_start,
    };
    let parsed = parse_template_ast(&shell);
    let root = ast_root_or_fail(&parsed)?;
    let concrete = lower_vue_root_to_concrete(root, &parsed.shell_source)?;
    let semantic = lower_vue_root_to_semantic(root, &parsed.shell_source)?;
    Ok((concrete, semantic))
}

/// Oak Semantic (no Concrete in the return type); Oak failure is an error.
pub fn parse_template_semantic_primary(
    template: &TemplateBlock,
) -> Result<SemanticIr, TemplateParseError> {
    let shell = TemplateShellInput {
        content: template.content.clone(),
        content_start: template.content_start,
    };
    let parsed = parse_template_ast(&shell);
    let root = ast_root_or_fail(&parsed)?;
    lower_vue_root_to_semantic(root, &parsed.shell_source)
}

fn ast_root_or_fail(
    parsed: &vmz_oak_frontend_adapter::TemplateAstParse,
) -> Result<&VueRoot, TemplateParseError> {
    match &parsed.root {
        Some(root) if parsed.ok => Ok(root),
        _ => {
            Err(TemplateParseError::parse_failed(format_oak_fail(parsed), oak_fail_offset(parsed)))
        }
    }
}

/// First Oak diagnostic remapped into a template-body-relative offset.
fn oak_fail_offset(parsed: &vmz_oak_frontend_adapter::TemplateAstParse) -> usize {
    let body_start = parsed.shell_base_offset + TEMPLATE_OPEN.len();
    parsed
        .diagnostics
        .iter()
        .filter_map(|d| d.span.as_ref().map(|s| s.start.saturating_sub(body_start)))
        .next()
        .unwrap_or(0)
}

fn format_oak_fail(parsed: &vmz_oak_frontend_adapter::TemplateAstParse) -> String {
    vmz_oak_frontend_adapter::format_cst_diagnostics(&parsed.diagnostics)
}

fn lower_vue_root_to_concrete(
    root: &VueRoot,
    shell: &str,
) -> Result<ConcreteIr, TemplateParseError> {
    let block = root
        .blocks
        .iter()
        .find(|b| slice(shell, b.name) == "template")
        .ok_or_else(|| TemplateParseError::coded("vmz::template::missing_block", 0))?;
    let roots =
        block.children.iter().map(|node| lower_node(shell, node)).collect::<Result<Vec<_>, _>>()?;
    Ok(ConcreteIr { roots })
}

fn lower_oak_siblings(
    shell: &str,
    nodes: &[VueNode],
) -> Result<Vec<SemanticNode>, TemplateParseError> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < nodes.len() {
        match &nodes[i] {
            VueNode::Comment(_) => i += 1,
            VueNode::Text(t) => {
                let value = decode_html_entities(slice(shell, t.span));
                if !value.trim().is_empty() {
                    out.push(SemanticNode::Text { value, span: to_body_span(shell, t.span) });
                }
                i += 1;
            }
            VueNode::Interpolation(interp) => {
                let expr = normalize_oak_interpolation_expr(slice(shell, interp.expression));
                out.push(SemanticNode::Interpolation {
                    expr,
                    span: to_body_span(shell, interp.span),
                });
                i += 1;
            }
            VueNode::Element(el) => {
                if oak_element_has_pre_directive(shell, el) {
                    out.push(lower_oak_element_verbatim(shell, el)?);
                    i += 1;
                    continue;
                }
                let attrs = classify_oak_attrs(shell, el)?;
                let span = to_body_span(shell, el.span);
                match control_flow_kind(&attrs) {
                    Some(ControlFlowKind::If(_)) => {
                        let (chain, consumed) = take_oak_if_chain(shell, &nodes[i..])?;
                        out.push(chain);
                        i += consumed;
                    }
                    Some(ControlFlowKind::ElseIf(_)) => {
                        return Err(TemplateParseError::coded(
                            "vmz::template::illegal_directive",
                            span.start as usize,
                        ));
                    }
                    Some(ControlFlowKind::Else) => {
                        return Err(TemplateParseError::coded(
                            "vmz::template::illegal_directive",
                            span.start as usize,
                        ));
                    }
                    None => {
                        let children = lower_oak_siblings(shell, &el.children)?;
                        let tag = slice(shell, el.tag_name);
                        out.push(semantic_from_element_parts(
                            tag,
                            &attrs,
                            children,
                            span,
                            !el.children.is_empty(),
                        )?);
                        i += 1;
                    }
                }
            }
        }
    }
    Ok(out)
}

fn take_oak_if_chain(
    shell: &str,
    nodes: &[VueNode],
) -> Result<(SemanticNode, usize), TemplateParseError> {
    let mut branches = Vec::new();
    let mut i = 0;
    let mut saw_else = false;

    while i < nodes.len() {
        while i < nodes.len() && matches!(&nodes[i], VueNode::Comment(_)) {
            i += 1;
        }
        if i >= nodes.len() {
            break;
        }
        let VueNode::Element(el) = &nodes[i] else {
            break;
        };
        let attrs = classify_oak_attrs(shell, el)?;
        let span = to_body_span(shell, el.span);
        let kind = control_flow_kind(&attrs);
        let test = match (&kind, branches.is_empty(), saw_else) {
            (Some(ControlFlowKind::If(t)), true, _) => Some(t.clone()),
            (Some(ControlFlowKind::ElseIf(t)), false, false) => Some(t.clone()),
            (Some(ControlFlowKind::Else), false, false) => {
                saw_else = true;
                None
            }
            (Some(ControlFlowKind::ElseIf(_)), false, true) => {
                return Err(TemplateParseError::coded(
                    "vmz::template::illegal_directive",
                    span.start as usize,
                ));
            }
            (Some(ControlFlowKind::If(_)), false, _) => break,
            _ => break,
        };

        let children = lower_oak_siblings(shell, &el.children)?;
        let tag = slice(shell, el.tag_name);
        let body =
            semantic_from_element_parts(tag, &attrs, children, span, !el.children.is_empty())?;
        branches.push(IfBranch { test, body: Box::new(body), span });
        i += 1;
        if saw_else {
            break;
        }
    }

    Ok((if_chain_from_branches(branches), i))
}

fn classify_oak_attrs(
    shell: &str,
    el: &VueElement,
) -> Result<Vec<ConcreteAttr>, TemplateParseError> {
    check_duplicate_attributes(shell, el)?;
    el.attributes.iter().map(|a| lower_attr(shell, a)).collect()
}

/// Vue reports repeated attribute names as a compile error (case-sensitive, `class` included).
///
/// The comparison is on the **source** spelling: `:title` and `v-bind:title` are distinct names
/// and therefore coexist, exactly like Vue. `ConcreteAttr` cannot answer this because it folds
/// both spellings into one `Bind`.
fn check_duplicate_attributes(shell: &str, el: &VueElement) -> Result<(), TemplateParseError> {
    let mut seen = std::collections::HashSet::new();
    for attr in &el.attributes {
        let name = source_attr_name(shell, attr);
        if !seen.insert(name.clone()) {
            return Err(TemplateParseError::parse_failed(
                format!("duplicate attribute `{name}`"),
                to_body_span(shell, attr_span(attr)).start as usize,
            ));
        }
    }
    Ok(())
}

fn attr_span(attr: &VueAttribute) -> Range<usize> {
    match attr {
        VueAttribute::Attribute(a) => a.span,
        VueAttribute::Directive(d) => d.span,
    }
}

/// Source spelling of one attribute (`title`, `:title`, `v-bind:title`, `@click`, …).
fn source_attr_name(shell: &str, attr: &VueAttribute) -> String {
    match attr {
        VueAttribute::Attribute(a) => slice(shell, a.name).to_string(),
        VueAttribute::Directive(d) => {
            let raw = directive_source_text(shell, d);
            raw.split_once('=')
                .map(|(name, _)| name.trim().to_string())
                .unwrap_or_else(|| raw.trim().to_string())
        }
    }
}

fn lower_node(shell: &str, node: &VueNode) -> Result<ConcreteNode, TemplateParseError> {
    match node {
        VueNode::Element(el) => {
            check_duplicate_attributes(shell, el)?;
            let tag = slice(shell, el.tag_name).to_string();
            let attrs = el
                .attributes
                .iter()
                .map(|a| lower_attr(shell, a))
                .collect::<Result<Vec<_>, _>>()?;
            let children =
                el.children.iter().map(|c| lower_node(shell, c)).collect::<Result<Vec<_>, _>>()?;
            Ok(ConcreteNode::Element { tag, attrs, children, span: to_body_span(shell, el.span) })
        }
        VueNode::Text(t) => {
            let value = decode_html_entities(slice(shell, t.span));
            Ok(ConcreteNode::Text { value, span: to_body_span(shell, t.span) })
        }
        VueNode::Interpolation(i) => {
            let expr = normalize_oak_interpolation_expr(slice(shell, i.expression));
            Ok(ConcreteNode::Interpolation { expr, span: to_body_span(shell, i.span) })
        }
        VueNode::Comment(text) => {
            Ok(ConcreteNode::Comment { value: text.clone(), span: TemplateSpan::point(0) })
        }
    }
}

fn lower_attr(shell: &str, attr: &VueAttribute) -> Result<ConcreteAttr, TemplateParseError> {
    match attr {
        VueAttribute::Attribute(a) => {
            let name = slice(shell, a.name);
            let value = a.value.as_ref().map(|v| decode_html_entities(slice(shell, v.span)));
            let span = to_body_span(shell, a.span);
            classify_concrete_attr(name, value.as_deref(), span)
        }
        VueAttribute::Directive(d) => {
            let raw = directive_source_text(shell, d);
            let (name, value) = if let Some((name, rest)) = raw.split_once('=') {
                (
                    name.trim().to_string(),
                    Some(decode_html_entities(&unquote_attr_value(rest.trim()))),
                )
            } else {
                (raw.trim().to_string(), None)
            };
            let span = to_body_span(shell, d.span);
            classify_concrete_attr(&name, value.as_deref(), span)
        }
    }
}

/// Directive text as written in the source, including argument and modifiers when the Oak span
/// does not cover them.
fn directive_source_text(shell: &str, d: &oak_vue::Directive) -> String {
    let mut raw = slice(shell, d.span).to_string();
    if let Some(arg) = &d.arg {
        let argument = slice(shell, arg.span);
        if !argument.is_empty() && !raw.contains(argument) {
            raw.push(':');
            raw.push_str(argument);
        }
    }
    for modifier in &d.modifiers {
        let name = slice(shell, modifier.name);
        if !name.is_empty() && !raw.contains(name) {
            raw.push('.');
            raw.push_str(name);
        }
    }
    raw
}

fn unquote_attr_value(raw: &str) -> String {
    if raw.len() >= 2 {
        if (raw.starts_with('"') && raw.ends_with('"'))
            || (raw.starts_with('\'') && raw.ends_with('\''))
        {
            return raw[1..raw.len() - 1].to_string();
        }
    }
    raw.to_string()
}

fn slice(shell: &str, range: Range<usize>) -> &str {
    shell.get(range.start..range.end).unwrap_or("")
}

/// Oak `VueNode::Interpolation` expression spans may include closing `}}` on multiline mustaches.
fn normalize_oak_interpolation_expr(raw: &str) -> String {
    let mut expr = raw.trim();
    while expr.ends_with('}') {
        expr = expr.trim_end_matches('}').trim_end();
    }
    expr.trim().to_string()
}

fn to_body_span(_shell: &str, range: Range<usize>) -> TemplateSpan {
    let base = TEMPLATE_OPEN.len();
    TemplateSpan::from_usize(range.start.saturating_sub(base), range.end.saturating_sub(base))
}

// ——————————————————————————————————————————————————————————————————————————
// Verbatim (`v-pre`) lowering
// ——————————————————————————————————————————————————————————————————————————

fn oak_element_has_pre_directive(shell: &str, el: &VueElement) -> bool {
    for attr in &el.attributes {
        let VueAttribute::Directive(d) = attr else { continue };
        let name_txt = slice(shell, d.name);
        if let Some(rest) = name_txt.strip_prefix("v-") {
            let base = rest.split(|c: char| c == ':' || c == '.').next().unwrap_or("");
            if base == "pre" {
                return true;
            }
        }
    }
    false
}

fn lower_oak_element_verbatim(
    shell: &str,
    el: &VueElement,
) -> Result<SemanticNode, TemplateParseError> {
    let tag = slice(shell, el.tag_name).to_string();
    let span = to_body_span(shell, el.span);
    let props = lower_oak_props_verbatim(shell, el);
    let children = lower_oak_siblings_verbatim(shell, &el.children)?;
    Ok(SemanticNode::Element { tag, props, children, span })
}

fn lower_oak_siblings_verbatim(
    shell: &str,
    nodes: &[VueNode],
) -> Result<Vec<SemanticNode>, TemplateParseError> {
    let mut out = Vec::new();
    for node in nodes {
        match node {
            VueNode::Comment(_) => {}
            VueNode::Text(t) => {
                let value = decode_html_entities(slice(shell, t.span));
                if !value.trim().is_empty() {
                    out.push(SemanticNode::Text {
                        value,
                        span: to_body_span(shell, t.span),
                    });
                }
            }
            VueNode::Interpolation(interp) => {
                let value = slice(shell, interp.span).to_string();
                out.push(SemanticNode::Text {
                    value,
                    span: to_body_span(shell, interp.span),
                });
            }
            VueNode::Element(child) => {
                out.push(lower_oak_element_verbatim(shell, child)?);
            }
        }
    }
    Ok(out)
}

fn lower_oak_props_verbatim(shell: &str, el: &VueElement) -> Vec<SemanticProp> {
    let mut out = Vec::with_capacity(el.attributes.len());
    for attr in &el.attributes {
        let (name, value, attr_span) = match attr {
            VueAttribute::Attribute(a) => {
                let name = slice(shell, a.name).to_string();
                let value = a
                    .value
                    .as_ref()
                    .map(|v| decode_html_entities(slice(shell, v.span)))
                    .unwrap_or_default();
                (name, value, a.span)
            }
            VueAttribute::Directive(d) => {
                let raw = directive_source_text(shell, d);
                let (name_part, value_str) = if let Some(eq) = raw.find('=') {
                    let lhs = raw[..eq].trim().to_string();
                    let rest = &raw[eq + 1..];
                    let unquoted = unquote_attr_value(rest.trim());
                    let decoded = decode_html_entities(&unquoted);
                    (lhs, decoded)
                } else {
                    (raw.trim().to_string(), String::new())
                };
                (name_part, value_str, d.span)
            }
        };
        let span = to_body_span(shell, attr_span);
        out.push(SemanticProp::Static { name, value, span });
    }
    out
}
