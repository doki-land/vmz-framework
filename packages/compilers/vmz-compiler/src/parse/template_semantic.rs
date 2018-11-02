//! Layer-2 Vue Semantic AST (Structured Template Semantics).
//!
//! Concrete keeps author form; Semantic structures control flow (`IfChain`) so
//! generators stop guessing flat `if` / `else-if` attrs. Pipeline emit still
//! goes through the legacy [`super::template_ir::TemplateIr`] adapter until
//! Execution IR lands.

use super::template_common::TemplateParseError;
use super::template_concrete::{ConcreteAttr, ConcreteIr, ConcreteNode, Directive, DirectiveArg};
use super::template_span::TemplateSpan;

/// Root of a Semantic template tree.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SemanticIr {
    /// Top-level semantic nodes (may include [`SemanticNode::IfChain`]).
    pub roots: Vec<SemanticNode>,
}

/// One Semantic node (≠ Vue runtime AST).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SemanticNode {
    /// Decoded text run.
    Text {
        /// Text content.
        value: String,
        /// Body-local span.
        span: TemplateSpan,
    },
    /// `{{ expr }}` (expression still text until ExprPlan).
    Interpolation {
        /// Expression body.
        expr: String,
        /// Span covering `{{ … }}`.
        span: TemplateSpan,
    },
    /// Element / component without control-flow directives on the tag.
    Element {
        /// Tag name.
        tag: String,
        /// Non-control-flow attributes (Concrete order).
        attrs: Vec<ConcreteAttr>,
        /// Nested semantic children.
        children: Vec<SemanticNode>,
        /// Element span.
        span: TemplateSpan,
    },
    /// Adjacent `v-if` / `v-else-if` / `v-else` chain.
    IfChain {
        /// Branches in source order; last may be `else` (`test == None`).
        branches: Vec<IfBranch>,
        /// Span covering the whole chain (first start .. last end).
        span: TemplateSpan,
    },
    /// `v-for` iteration with full aliases and optional `:key` (not flat attrs).
    ForNode {
        /// Iterable / source expression.
        source: String,
        /// First alias (`item` in `(item, index) in items`).
        value_alias: String,
        /// Second alias when present (Vue key/index slot).
        key_alias: Option<String>,
        /// Third alias when present.
        index_alias: Option<String>,
        /// `:key` expression when present on the same element.
        key: Option<String>,
        /// Loop body (element with `v-for` / `:key` stripped).
        body: Box<SemanticNode>,
        /// Span of the `v-for` element.
        span: TemplateSpan,
    },
}

/// One branch of an [`SemanticNode::IfChain`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IfBranch {
    /// Condition expression; `None` for `v-else`.
    pub test: Option<String>,
    /// Branch body (the element with control-flow attrs stripped, children lowered).
    pub body: Box<SemanticNode>,
    /// Span of the branch root element.
    pub span: TemplateSpan,
}

/// Lower Concrete → Semantic (IfChain grouping; comments dropped).
pub fn lower_concrete_to_semantic(concrete: &ConcreteIr) -> Result<SemanticIr, TemplateParseError> {
    Ok(SemanticIr { roots: lower_siblings(&concrete.roots)? })
}

fn lower_siblings(nodes: &[ConcreteNode]) -> Result<Vec<SemanticNode>, TemplateParseError> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < nodes.len() {
        match &nodes[i] {
            ConcreteNode::Comment { .. } => i += 1,
            ConcreteNode::Text { value, span } => {
                if !value.trim().is_empty() {
                    out.push(SemanticNode::Text {
                        value: value.clone(),
                        span: *span,
                    });
                }
                i += 1;
            }
            ConcreteNode::Interpolation { expr, span } => {
                out.push(SemanticNode::Interpolation {
                    expr: expr.clone(),
                    span: *span,
                });
                i += 1;
            }
            ConcreteNode::Element { attrs, span, .. } => match control_flow_kind(attrs) {
                Some(ControlFlow::If(_)) => {
                    let (chain, consumed) = take_if_chain(&nodes[i..])?;
                    out.push(chain);
                    i += consumed;
                }
                Some(ControlFlow::ElseIf(_)) => {
                    return Err(TemplateParseError {
                        message: "`v-else-if` requires a preceding `v-if` / `v-else-if`".into(),
                        offset: span.start as usize,
                    });
                }
                Some(ControlFlow::Else) => {
                    return Err(TemplateParseError {
                        message: "`v-else` requires a preceding `v-if` / `v-else-if`".into(),
                        offset: span.start as usize,
                    });
                }
                None if for_directive(attrs).is_some() => {
                    out.push(lower_for_element(&nodes[i])?);
                    i += 1;
                }
                None => {
                    out.push(lower_element_strip_control_flow(&nodes[i])?);
                    i += 1;
                }
            },
        }
    }
    Ok(out)
}

enum ControlFlow {
    If(String),
    ElseIf(String),
    Else,
}

fn control_flow_kind(attrs: &[ConcreteAttr]) -> Option<ControlFlow> {
    for a in attrs {
        if let ConcreteAttr::Directive { dir, .. } = a {
            return match dir {
                Directive::If { test } => Some(ControlFlow::If(test.clone())),
                Directive::ElseIf { test } => Some(ControlFlow::ElseIf(test.clone())),
                Directive::Else => Some(ControlFlow::Else),
                _ => continue,
            };
        }
    }
    None
}

fn take_if_chain(nodes: &[ConcreteNode]) -> Result<(SemanticNode, usize), TemplateParseError> {
    let mut branches = Vec::new();
    let mut i = 0;
    let mut saw_else = false;

    while i < nodes.len() {
        // Comments between chain members are allowed (Vue-compatible).
        while i < nodes.len() && matches!(&nodes[i], ConcreteNode::Comment { .. }) {
            i += 1;
        }
        if i >= nodes.len() {
            break;
        }
        let ConcreteNode::Element { attrs, span, .. } = &nodes[i] else {
            break;
        };
        let kind = control_flow_kind(attrs);
        let test = match (&kind, branches.is_empty(), saw_else) {
            (Some(ControlFlow::If(t)), true, _) => Some(t.clone()),
            (Some(ControlFlow::ElseIf(t)), false, false) => Some(t.clone()),
            (Some(ControlFlow::Else), false, false) => {
                saw_else = true;
                None
            }
            (Some(ControlFlow::ElseIf(_)), false, true) => {
                return Err(TemplateParseError {
                    message: "`v-else-if` cannot follow `v-else`".into(),
                    offset: span.start as usize,
                });
            }
            (Some(ControlFlow::If(_)), false, _) => break,
            _ => break,
        };

        let body = lower_element_strip_control_flow(&nodes[i])?;
        branches.push(IfBranch {
            test,
            body: Box::new(body),
            span: *span,
        });
        i += 1;
        if saw_else {
            break;
        }
    }

    let span = TemplateSpan {
        start: branches[0].span.start,
        end: branches.last().unwrap().span.end,
    };
    Ok((SemanticNode::IfChain { branches, span }, i))
}

fn for_directive(attrs: &[ConcreteAttr]) -> Option<&Directive> {
    for a in attrs {
        if let ConcreteAttr::Directive { dir: Directive::For { .. }, .. } = a {
            return match a {
                ConcreteAttr::Directive { dir, .. } => Some(dir),
                _ => None,
            };
        }
    }
    None
}

fn bind_key_expr(attrs: &[ConcreteAttr]) -> Option<String> {
    for a in attrs {
        if let ConcreteAttr::Directive {
            dir: Directive::Bind {
                arg: DirectiveArg::Static(name),
                expr,
                ..
            },
            ..
        } = a
        {
            if name == "key" {
                return Some(expr.clone());
            }
        }
    }
    None
}

fn lower_for_element(node: &ConcreteNode) -> Result<SemanticNode, TemplateParseError> {
    let ConcreteNode::Element {
        tag,
        attrs,
        children,
        span,
    } = node
    else {
        return Err(TemplateParseError {
            message: "internal: expected element".into(),
            offset: 0,
        });
    };
    lower_for_from_parts(tag, attrs, children, *span)
}

fn lower_for_from_parts(
    tag: &str,
    attrs: &[ConcreteAttr],
    children: &[ConcreteNode],
    span: TemplateSpan,
) -> Result<SemanticNode, TemplateParseError> {
    let Some(Directive::For {
        source,
        value_alias,
        key_alias,
        index_alias,
    }) = for_directive(attrs).cloned()
    else {
        return Err(TemplateParseError {
            message: "internal: expected `v-for`".into(),
            offset: span.start as usize,
        });
    };
    let key = bind_key_expr(attrs);
    let body_attrs: Vec<ConcreteAttr> = attrs
        .iter()
        .filter(|a| {
            !matches!(
                a,
                ConcreteAttr::Directive {
                    dir: Directive::For { .. },
                    ..
                }
            ) && !matches!(
                a,
                ConcreteAttr::Directive {
                    dir: Directive::Bind {
                        arg: DirectiveArg::Static(name),
                        ..
                    },
                    ..
                } if name == "key"
            )
        })
        .cloned()
        .collect();
    let children = lower_siblings(children)?;
    let body = SemanticNode::Element {
        tag: tag.to_string(),
        attrs: body_attrs,
        children,
        span,
    };
    Ok(SemanticNode::ForNode {
        source,
        value_alias,
        key_alias,
        index_alias,
        key,
        body: Box::new(body),
        span,
    })
}

fn lower_element_strip_control_flow(node: &ConcreteNode) -> Result<SemanticNode, TemplateParseError> {
    let ConcreteNode::Element {
        tag,
        attrs,
        children,
        span,
    } = node
    else {
        return Err(TemplateParseError {
            message: "internal: expected element".into(),
            offset: 0,
        });
    };
    let attrs: Vec<ConcreteAttr> = attrs
        .iter()
        .filter(|a| {
            !matches!(
                a,
                ConcreteAttr::Directive {
                    dir: Directive::If { .. } | Directive::ElseIf { .. } | Directive::Else,
                    ..
                }
            )
        })
        .cloned()
        .collect();
    if for_directive(&attrs).is_some() {
        return lower_for_from_parts(tag, &attrs, children, *span);
    }
    let children = lower_siblings(children)?;
    Ok(SemanticNode::Element {
        tag: tag.clone(),
        attrs,
        children,
        span: *span,
    })
}
