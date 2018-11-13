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
        /// Structured props (Bind / On keep modifiers; no flat TemplateAttr).
        props: Vec<SemanticProp>,
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
    /// `<slot>` outlet (provider hole; optional name + fallback children).
    SlotOutlet {
        /// Static slot name (`name` attr); `None` = default.
        name: Option<String>,
        /// Remaining props (binds that forward scoped slot data, etc.).
        props: Vec<SemanticProp>,
        /// Fallback content when the slot is not filled.
        children: Vec<SemanticNode>,
        /// Element span.
        span: TemplateSpan,
    },
    /// `#name` / `v-slot` filler (`<template #x>` fragment or component slot).
    SlotTemplate {
        /// Slot name argument (static only in this peel; dynamic → structured error).
        name: DirectiveArg,
        /// Optional slot props binding (`#default="slotProps"`).
        slot_props: Option<String>,
        /// Filler body (fragment children or host element without the slot directive).
        body: Box<SemanticNode>,
        /// Span of the slot-bearing element / template.
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

/// Event listener target classification (tag heuristic until component table lands).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventTarget {
    /// Native DOM element (lowercase tag).
    Dom,
    /// Component tag (PascalCase / uppercase start).
    Component,
}

/// Structured element prop on Semantic AST (BindPlan / EventPlan shapes).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SemanticProp {
    /// Static HTML / component attribute.
    Static {
        /// Attribute name.
        name: String,
        /// Literal value.
        value: String,
        /// Attr span.
        span: TemplateSpan,
    },
    /// `:arg` / `v-bind:arg` (BindPlan).
    Bind {
        /// Bound argument.
        arg: DirectiveArg,
        /// Value expression.
        expr: String,
        /// Modifiers (`sync`, …).
        modifiers: Vec<String>,
        /// Attr span.
        span: TemplateSpan,
    },
    /// `v-bind="obj"`.
    BindObject {
        /// Object expression.
        expr: String,
        /// Attr span.
        span: TemplateSpan,
    },
    /// `@arg` / `v-on:arg` (EventPlan).
    On {
        /// Event argument.
        arg: DirectiveArg,
        /// Handler expression.
        handler: String,
        /// Event modifiers (`stop`, `prevent`, …).
        modifiers: Vec<String>,
        /// Dom vs component callback.
        target: EventTarget,
        /// Attr span.
        span: TemplateSpan,
    },
    /// `v-on="listeners"`.
    OnObject {
        /// Listeners object expression.
        expr: String,
        /// Attr span.
        span: TemplateSpan,
    },
    /// Other directives kept structured from Concrete (slot/show/html/custom/model).
    Directive {
        /// Concrete directive payload.
        dir: Directive,
        /// Attr span.
        span: TemplateSpan,
    },
}

/// Lower Concrete → Semantic (IfChain / ForNode / Bind·On plans; comments dropped).
pub fn lower_concrete_to_semantic(concrete: &ConcreteIr) -> Result<SemanticIr, TemplateParseError> {
    Ok(SemanticIr { roots: lower_siblings(&concrete.roots)? })
}

/// Tooling / compiler shared summary over one Semantic tree (no second template scan).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SemanticAstStats {
    /// Number of [`SemanticNode::IfChain`] nodes.
    pub if_chains: usize,
    /// Total branches across all if-chains.
    pub if_branches: usize,
    /// Number of [`SemanticNode::ForNode`] nodes.
    pub for_nodes: usize,
    /// Number of [`SemanticNode::SlotOutlet`] nodes.
    pub slot_outlets: usize,
    /// Number of [`SemanticNode::SlotTemplate`] nodes.
    pub slot_templates: usize,
}

/// Walk Semantic AST for control-flow counts (LSP / check / rename can share this).
pub fn semantic_ast_stats(semantic: &SemanticIr) -> SemanticAstStats {
    let mut stats = SemanticAstStats::default();
    walk_stats(&semantic.roots, &mut stats);
    stats
}

fn walk_stats(nodes: &[SemanticNode], stats: &mut SemanticAstStats) {
    for n in nodes {
        match n {
            SemanticNode::Text { .. } | SemanticNode::Interpolation { .. } => {}
            SemanticNode::Element { children, .. } => walk_stats(children, stats),
            SemanticNode::IfChain { branches, .. } => {
                stats.if_chains += 1;
                stats.if_branches += branches.len();
                for b in branches {
                    walk_stats(std::slice::from_ref(b.body.as_ref()), stats);
                }
            }
            SemanticNode::ForNode { body, .. } => {
                stats.for_nodes += 1;
                walk_stats(std::slice::from_ref(body.as_ref()), stats);
            }
            SemanticNode::SlotOutlet { children, .. } => {
                stats.slot_outlets += 1;
                walk_stats(children, stats);
            }
            SemanticNode::SlotTemplate { body, .. } => {
                stats.slot_templates += 1;
                walk_stats(std::slice::from_ref(body.as_ref()), stats);
            }
        }
    }
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
        props: lower_props(tag, &body_attrs),
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
    if let Some((slot_name, slot_props, slot_span)) = slot_directive(&attrs) {
        return lower_slot_template(tag, &attrs, children, *span, slot_name, slot_props, slot_span);
    }
    if tag == "slot" {
        return lower_slot_outlet(&attrs, children, *span);
    }
    let children = lower_siblings(children)?;
    Ok(SemanticNode::Element {
        tag: tag.clone(),
        props: lower_props(tag, &attrs),
        children,
        span: *span,
    })
}

fn slot_directive(attrs: &[ConcreteAttr]) -> Option<(DirectiveArg, Option<String>, TemplateSpan)> {
    for a in attrs {
        if let ConcreteAttr::Directive {
            dir: Directive::Slot { name, props },
            span,
        } = a
        {
            return Some((name.clone(), props.clone(), *span));
        }
    }
    None
}

fn lower_slot_outlet(
    attrs: &[ConcreteAttr],
    children: &[ConcreteNode],
    span: TemplateSpan,
) -> Result<SemanticNode, TemplateParseError> {
    let mut name = None;
    let mut rest = Vec::new();
    for a in attrs {
        match a {
            ConcreteAttr::Static { name: n, value, .. } if n == "name" => {
                name = Some(value.clone());
            }
            other => rest.push(other.clone()),
        }
    }
    // Prefer `:name` bind as static name when literal; dynamic name stays as Bind on props.
    let props = lower_props("slot", &rest);
    let children = lower_siblings(children)?;
    Ok(SemanticNode::SlotOutlet { name, props, children, span })
}

fn lower_slot_template(
    tag: &str,
    attrs: &[ConcreteAttr],
    children: &[ConcreteNode],
    span: TemplateSpan,
    slot_name: DirectiveArg,
    slot_props: Option<String>,
    slot_span: TemplateSpan,
) -> Result<SemanticNode, TemplateParseError> {
    if matches!(slot_name, DirectiveArg::Dynamic(_)) {
        return Err(TemplateParseError {
            message: "dynamic `v-slot` / `#` argument is not supported yet (`vmz::template/unsupported-dynamic-arg`)"
                .into(),
            offset: slot_span.start as usize,
        });
    }
    let attrs_no_slot: Vec<ConcreteAttr> = attrs
        .iter()
        .filter(|a| {
            !matches!(
                a,
                ConcreteAttr::Directive {
                    dir: Directive::Slot { .. },
                    ..
                }
            )
        })
        .cloned()
        .collect();
    let body = if tag == "template" {
        // Fragment: slot filler is the lowered children only (single wrapper element).
        let kids = lower_siblings(children)?;
        SemanticNode::Element {
            tag: "template".into(),
            props: Vec::new(),
            children: kids,
            span,
        }
    } else {
        let kids = lower_siblings(children)?;
        SemanticNode::Element {
            tag: tag.to_string(),
            props: lower_props(tag, &attrs_no_slot),
            children: kids,
            span,
        }
    };
    Ok(SemanticNode::SlotTemplate {
        name: slot_name,
        slot_props,
        body: Box::new(body),
        span,
    })
}

fn event_target_for_tag(tag: &str) -> EventTarget {
    if tag.chars().next().is_some_and(|c| c.is_uppercase()) {
        EventTarget::Component
    } else {
        EventTarget::Dom
    }
}

fn lower_props(tag: &str, attrs: &[ConcreteAttr]) -> Vec<SemanticProp> {
    let target = event_target_for_tag(tag);
    let mut out = Vec::with_capacity(attrs.len());
    for a in attrs {
        match a {
            ConcreteAttr::Static { name, value, span } => {
                out.push(SemanticProp::Static {
                    name: name.clone(),
                    value: value.clone(),
                    span: *span,
                });
            }
            ConcreteAttr::Directive { dir, span } => match dir {
                Directive::Bind { arg, expr, modifiers } => {
                    out.push(SemanticProp::Bind {
                        arg: arg.clone(),
                        expr: expr.clone(),
                        modifiers: modifiers.clone(),
                        span: *span,
                    });
                }
                Directive::BindObject { expr } => {
                    out.push(SemanticProp::BindObject {
                        expr: expr.clone(),
                        span: *span,
                    });
                }
                Directive::On { arg, handler, modifiers } => {
                    out.push(SemanticProp::On {
                        arg: arg.clone(),
                        handler: handler.clone(),
                        modifiers: modifiers.clone(),
                        target,
                        span: *span,
                    });
                }
                Directive::OnObject { expr } => {
                    out.push(SemanticProp::OnObject {
                        expr: expr.clone(),
                        span: *span,
                    });
                }
                other => {
                    // Slot / Model / control-flow are lifted elsewhere; keep other dirs as opaque.
                    if matches!(
                        other,
                        Directive::Slot { .. }
                            | Directive::If { .. }
                            | Directive::ElseIf { .. }
                            | Directive::Else
                            | Directive::For { .. }
                    ) {
                        continue;
                    }
                    out.push(SemanticProp::Directive {
                        dir: other.clone(),
                        span: *span,
                    });
                }
            },
        }
    }
    out
}
