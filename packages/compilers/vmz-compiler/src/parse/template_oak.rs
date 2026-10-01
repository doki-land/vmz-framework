//! Lower Oak Vue AST → VMZ Concrete / Semantic Template IR (stage C primary).

use core::range::Range;

use oak_vue::{VueAttribute, VueNode, VueRoot};
use vmz_oak_frontend_adapter::{TemplateShellInput, parse_template_ast};

use super::template_common::TemplateParseError;
use super::template_concrete::{ConcreteAttr, ConcreteIr, ConcreteNode, classify_concrete_attr};
use super::template_semantic::{SemanticIr, lower_concrete_to_semantic};
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

/// Oak Vue AST → Concrete → Semantic as one primary unit; legacy XML concrete on failure.
///
/// This is the stage-C entry for `check` / `compile`. Concrete remains a temporary
/// adapter toward Semantic / TemplateIr until emit consumes Semantic directly.
pub fn parse_template_layers_primary(
    template: &TemplateBlock,
) -> Result<(ConcreteIr, SemanticIr), TemplateParseError> {
    if let Ok(concrete) = parse_template_concrete_via_oak(template) {
        if let Ok(semantic) = lower_concrete_to_semantic(&concrete) {
            return Ok((concrete, semantic));
        }
    }
    let concrete = super::template_concrete::parse_template_concrete(&template.content)?;
    let semantic = lower_concrete_to_semantic(&concrete)?;
    Ok((concrete, semantic))
}

/// Prefer Oak for Semantic-only consumers (drops concrete after validation).
pub fn parse_template_semantic_primary(
    template: &TemplateBlock,
) -> Result<SemanticIr, TemplateParseError> {
    Ok(parse_template_layers_primary(template)?.1)
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
