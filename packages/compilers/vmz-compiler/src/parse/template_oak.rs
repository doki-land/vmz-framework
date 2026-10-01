//! Lower Oak Vue AST → VMZ Concrete / Semantic Template IR (stage C primary).

use core::range::Range;

use oak_vue::{VueAttribute, VueElement, VueNode, VueRoot};
use vmz_oak_frontend_adapter::{TemplateShellInput, parse_template_ast};

use super::template_common::TemplateParseError;
use super::template_concrete::{ConcreteAttr, ConcreteIr, ConcreteNode, classify_concrete_attr};
use super::template_semantic::{
    ControlFlowKind, IfBranch, SemanticIr, SemanticNode, control_flow_kind, if_chain_from_branches,
    lower_concrete_to_semantic, semantic_from_element_parts,
};
use super::template_span::TemplateSpan;
use crate::sfc::TemplateBlock;

const TEMPLATE_OPEN: &str = "<template>";

/// Build VMZ [`ConcreteIr`] from a VMZ template block via Oak CST + AST.
pub fn parse_template_concrete_via_oak(template: &TemplateBlock) -> Result<ConcreteIr, String> {
    let shell = TemplateShellInput {
        content: template.content.clone(),
        content_start: template.content_start,
    };
    let parsed = parse_template_ast(&shell);
    if !parsed.ok {
        return Err(format_oak_fail(&parsed));
    }
    let root = parsed.root.as_ref().ok_or_else(|| format_oak_fail(&parsed))?;
    lower_vue_root_to_concrete(root, &parsed.shell_source)
}

/// Oak Vue AST → [`SemanticIr`] **without** a [`ConcreteIr`] hop.
///
/// Attr strings are classified with [`classify_concrete_attr`] (shared algebra);
/// control flow is structured while walking Oak [`VueNode`]s.
pub fn parse_template_semantic_via_oak(template: &TemplateBlock) -> Result<SemanticIr, String> {
    let shell = TemplateShellInput {
        content: template.content.clone(),
        content_start: template.content_start,
    };
    let parsed = parse_template_ast(&shell);
    if !parsed.ok {
        return Err(format_oak_fail(&parsed));
    }
    let root = parsed.root.as_ref().ok_or_else(|| format_oak_fail(&parsed))?;
    lower_vue_root_to_semantic(root, &parsed.shell_source)
}

/// Lower an Oak [`VueRoot`] straight to Semantic (no Concrete forest).
pub fn lower_vue_root_to_semantic(root: &VueRoot, shell: &str) -> Result<SemanticIr, String> {
    let block = root
        .blocks
        .iter()
        .find(|b| slice(shell, b.name) == "template")
        .ok_or_else(|| "Oak AST missing <template> block".to_string())?;
    let roots = lower_oak_siblings(shell, &block.children).map_err(|e| e.message)?;
    Ok(SemanticIr { roots })
}

/// Prefer Oak concrete + semantic for a template body string, fall back to legacy.
pub fn parse_template_concrete_body_primary(
    input: &str,
) -> Result<ConcreteIr, TemplateParseError> {
    Ok(parse_template_layers_primary(&TemplateBlock {
        content: input.to_string(),
        content_start: 0,
    })?
    .0)
}

/// Prefer Oak concrete lowering for `check` / `compile`, fall back to legacy when Oak
/// fails or the Oak IR cannot lower to Semantic (keeps production builds unblocked).
pub fn parse_template_concrete_primary(
    template: &TemplateBlock,
) -> Result<ConcreteIr, TemplateParseError> {
    Ok(parse_template_layers_primary(template)?.0)
}

/// Oak Vue AST → Concrete + Semantic as one primary unit; legacy XML on failure.
///
/// Semantic is lowered **directly** from Oak (no Concrete→Semantic hop). Concrete
/// is still produced for legacy TemplateIr emit until Execution IR lands.
pub fn parse_template_layers_primary(
    template: &TemplateBlock,
) -> Result<(ConcreteIr, SemanticIr), TemplateParseError> {
    let shell = TemplateShellInput {
        content: template.content.clone(),
        content_start: template.content_start,
    };
    let parsed = parse_template_ast(&shell);
    if parsed.ok {
        if let Some(root) = parsed.root.as_ref() {
            if let (Ok(concrete), Ok(semantic)) = (
                lower_vue_root_to_concrete(root, &parsed.shell_source),
                lower_vue_root_to_semantic(root, &parsed.shell_source),
            ) {
                return Ok((concrete, semantic));
            }
        }
    }
    let concrete = super::template_concrete::parse_template_concrete(&template.content)?;
    let semantic = lower_concrete_to_semantic(&concrete)?;
    Ok((concrete, semantic))
}

/// Prefer Oak Semantic (no Concrete in the return type); legacy XML fallback.
pub fn parse_template_semantic_primary(
    template: &TemplateBlock,
) -> Result<SemanticIr, TemplateParseError> {
    if let Ok(semantic) = parse_template_semantic_via_oak(template) {
        return Ok(semantic);
    }
    let concrete = super::template_concrete::parse_template_concrete(&template.content)?;
    lower_concrete_to_semantic(&concrete)
}

fn format_oak_fail(parsed: &vmz_oak_frontend_adapter::TemplateAstParse) -> String {
    vmz_oak_frontend_adapter::format_cst_diagnostics(&parsed.diagnostics)
}

fn lower_vue_root_to_concrete(root: &VueRoot, shell: &str) -> Result<ConcreteIr, String> {
    let block = root
        .blocks
        .iter()
        .find(|b| slice(shell, b.name) == "template")
        .ok_or_else(|| "Oak AST missing <template> block".to_string())?;
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
                let value = slice(shell, t.span).to_string();
                if !value.trim().is_empty() {
                    out.push(SemanticNode::Text {
                        value,
                        span: to_body_span(shell, t.span),
                    });
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
                let attrs = classify_oak_attrs(shell, el)?;
                let span = to_body_span(shell, el.span);
                match control_flow_kind(&attrs) {
                    Some(ControlFlowKind::If(_)) => {
                        let (chain, consumed) = take_oak_if_chain(shell, &nodes[i..])?;
                        out.push(chain);
                        i += consumed;
                    }
                    Some(ControlFlowKind::ElseIf(_)) => {
                        return Err(TemplateParseError {
                            message: "`v-else-if` requires a preceding `v-if` / `v-else-if`"
                                .into(),
                            offset: span.start as usize,
                        });
                    }
                    Some(ControlFlowKind::Else) => {
                        return Err(TemplateParseError {
                            message: "`v-else` requires a preceding `v-if` / `v-else-if`".into(),
                            offset: span.start as usize,
                        });
                    }
                    None => {
                        let children = lower_oak_siblings(shell, &el.children)?;
                        let tag = slice(shell, el.tag_name);
                        out.push(semantic_from_element_parts(tag, &attrs, children, span)?);
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
                return Err(TemplateParseError {
                    message: "`v-else-if` cannot follow `v-else`".into(),
                    offset: span.start as usize,
                });
            }
            (Some(ControlFlowKind::If(_)), false, _) => break,
            _ => break,
        };

        let children = lower_oak_siblings(shell, &el.children)?;
        let tag = slice(shell, el.tag_name);
        let body = semantic_from_element_parts(tag, &attrs, children, span)?;
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
    el.attributes
        .iter()
        .map(|a| lower_attr(shell, a).map_err(|message| TemplateParseError { message, offset: 0 }))
        .collect()
}

fn lower_node(shell: &str, node: &VueNode) -> Result<ConcreteNode, String> {
    match node {
        VueNode::Element(el) => {
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
            let value = slice(shell, t.span).to_string();
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

fn lower_attr(shell: &str, attr: &VueAttribute) -> Result<ConcreteAttr, String> {
    match attr {
        VueAttribute::Attribute(a) => {
            let name = slice(shell, a.name);
            let value = a.value.as_ref().map(|v| slice(shell, v.span));
            let span = to_body_span(shell, a.span);
            classify_concrete_attr(name, value, span).map_err(|e| e.message)
        }
        VueAttribute::Directive(d) => {
            let raw = slice(shell, d.span);
            let (name, value) = if let Some((name, rest)) = raw.split_once('=') {
                (name.trim().to_string(), Some(unquote_attr_value(rest.trim())))
            } else {
                (raw.trim().to_string(), None)
            };
            let span = to_body_span(shell, d.span);
            classify_concrete_attr(&name, value.as_deref(), span).map_err(|e| e.message)
        }
    }
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
