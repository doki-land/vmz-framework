//! Layer-2 Vue Semantic AST (Structured Template Semantics).
//!
//! **Primary ingress**: [`super::template_oak::parse_template_semantic_primary`]
//! (Oak Vue AST → Semantic; attr classify may use [`ConcreteAttr`] algebra).
//!
//! [`lower_concrete_to_semantic`] is the Concrete adapter used by
//! [`super::template_oak::parse_template_layers_primary`] and layer tests. Oak direct
//! Semantic must not route through [`super::template_concrete::ConcreteIr`].
//!
//! Pipeline emit still goes through the legacy [`super::template_ir::TemplateIr`]
//! adapter until Execution IR lands.

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
    /// `v-model` / `v-model:arg` (ModelBinding plan).
    Model {
        /// Optional model argument (`title` in `v-model:title`); `None` → `modelValue`.
        arg: Option<String>,
        /// Model target expression.
        expr: String,
        /// Modifiers (`lazy`, `number`, …).
        modifiers: Vec<String>,
        /// Attr span.
        span: TemplateSpan,
    },
    /// Merged `class` + `:class` (static tokens + bind exprs, author order).
    ClassPlan {
        /// Tokens from static `class="…"`.
        static_classes: Vec<String>,
        /// `:class` / `v-bind:class` expressions (object/array/string still text).
        binds: Vec<String>,
        /// Span covering the first contributing attr through the last.
        span: TemplateSpan,
    },
    /// Merged `style` + `:style`.
    StylePlan {
        /// Literal `style="…"` when present.
        static_style: Option<String>,
        /// `:style` bind expressions.
        binds: Vec<String>,
        /// Span covering contributing attrs.
        span: TemplateSpan,
    },
    /// Other directives kept structured from Concrete (show/html/custom).
    Directive {
        /// Concrete directive payload.
        dir: Directive,
        /// Attr span.
        span: TemplateSpan,
    },
}

/// Lower Concrete → Semantic (IfChain / ForNode / Bind·On plans; comments dropped).
///
/// Concrete comes from Oak via [`super::template_oak::parse_template_concrete_primary`].
/// [`super::template_oak::parse_template_semantic_primary`] walks Oak directly and must agree.
pub fn lower_concrete_to_semantic(concrete: &ConcreteIr) -> Result<SemanticIr, TemplateParseError> {
    Ok(SemanticIr { roots: lower_siblings(&concrete.roots)? })
}

/// Control-flow kind on classified attrs (shared by Oak direct lower + Concrete adapter).
#[derive(Debug, Clone)]
pub(crate) enum ControlFlowKind {
    /// `v-if`.
    If(String),
    /// `v-else-if`.
    ElseIf(String),
    /// `v-else`.
    Else,
}

/// Read `v-if` / `v-else-if` / `v-else` from classified attrs.
pub(crate) fn control_flow_kind(attrs: &[ConcreteAttr]) -> Option<ControlFlowKind> {
    for a in attrs {
        if let ConcreteAttr::Directive { dir, .. } = a {
            return match dir {
                Directive::If { test } => Some(ControlFlowKind::If(test.clone())),
                Directive::ElseIf { test } => Some(ControlFlowKind::ElseIf(test.clone())),
                Directive::Else => Some(ControlFlowKind::Else),
                _ => continue,
            };
        }
    }
    None
}

/// Structure one element after children are already Semantic (Oak direct path).
pub(crate) fn semantic_from_element_parts(
    tag: &str,
    attrs: &[ConcreteAttr],
    children: Vec<SemanticNode>,
    span: TemplateSpan,
) -> Result<SemanticNode, TemplateParseError> {
    validate_vue_element_syntax(tag, attrs, &children)?;
    let attrs: Vec<ConcreteAttr> = attrs
        .iter()
        .filter(|a| {
            !matches!(
                a,
                ConcreteAttr::Directive {
                    dir: Directive::If { .. } | Directive::ElseIf { .. } | Directive::Else { .. },
                    ..
                }
            )
        })
        .cloned()
        .collect();
    if for_directive(&attrs).is_some() {
        return for_node_from_lowered(tag, &attrs, children, span);
    }
    if let Some((slot_name, slot_props, slot_span)) = slot_directive(&attrs) {
        return slot_template_from_lowered(
            tag, &attrs, children, span, slot_name, slot_props, slot_span,
        );
    }
    if tag == "slot" {
        return slot_outlet_from_lowered(&attrs, children, span);
    }
    Ok(SemanticNode::Element {
        tag: tag.to_string(),
        props: lower_props(tag, &attrs),
        children,
        span,
    })
}

/// HTML / SVG / MathML element names, mirroring Vue `isNativeTag` (`@vue/shared` 3.5).
const NATIVE_TAGS: &str = "html,body,base,head,link,meta,style,title,address,article,aside,footer,\
header,hgroup,h1,h2,h3,h4,h5,h6,nav,section,div,dd,dl,dt,figcaption,figure,picture,hr,img,li,\
main,ol,p,pre,ul,a,b,abbr,bdi,bdo,br,cite,code,data,dfn,em,i,kbd,mark,q,rp,rt,ruby,s,samp,small,\
span,strong,sub,sup,time,u,var,wbr,area,audio,map,track,video,embed,object,param,source,canvas,\
script,noscript,del,ins,caption,col,colgroup,table,thead,tbody,td,th,tr,button,datalist,fieldset,\
form,input,label,legend,meter,optgroup,option,output,progress,select,textarea,details,dialog,menu,\
summary,template,blockquote,iframe,tfoot,svg,animate,animateMotion,animateTransform,circle,\
clipPath,color-profile,defs,desc,discard,ellipse,feBlend,feColorMatrix,feComponentTransfer,\
feComposite,feConvolveMatrix,feDiffuseLighting,feDisplacementMap,feDistantLight,feDropShadow,\
feFlood,feFuncA,feFuncB,feFuncG,feFuncR,feGaussianBlur,feImage,feMerge,feMergeNode,feMorphology,\
feOffset,fePointLight,feSpecularLighting,feSpotLight,feTile,feTurbulence,filter,foreignObject,g,\
hatch,hatchpath,image,line,linearGradient,marker,mask,mesh,meshgradient,meshpatch,meshrow,\
metadata,mpath,path,pattern,polygon,polyline,radialGradient,rect,set,solidcolor,stop,switch,\
symbol,text,textPath,tspan,unknown,use,view,annotation,annotation-xml,maction,maligngroup,\
malignmark,math,menclose,merror,mfenced,mfrac,mfraction,mglyph,mi,mlabeledtr,mlongdiv,\
mmultiscripts,mn,mo,mover,mpadded,mphantom,mprescripts,mroot,mrow,ms,mscarries,mscarry,msgroup,\
msline,mspace,msqrt,msrow,mstack,mstyle,msub,msubsup,msup,mtable,mtd,mtext,mtr,munder,munderover,\
none,semantics";

/// `true` for tags Vue renders as plain elements (native HTML / SVG / MathML, plus `<slot>`).
fn is_non_component_tag(tag: &str) -> bool {
    tag == "slot" || NATIVE_TAGS.split(',').any(|t| t == tag)
}

/// Reject element syntax that Vue's compiler rejects.
///
/// VMZ semantics are reinterpreted, but the authoring surface must stay inside Vue: accepting a
/// template Vue errors on would make `.vmz` a superset dialect instead of a compatible one.
fn validate_vue_element_syntax(
    tag: &str,
    attrs: &[ConcreteAttr],
    children: &[SemanticNode],
) -> Result<(), TemplateParseError> {
    check_duplicate_attrs(attrs)?;
    let non_component = is_non_component_tag(tag);
    for attr in attrs {
        let ConcreteAttr::Directive { dir, span } = attr else {
            continue;
        };
        let fail = |message: &str| TemplateParseError {
            message: message.to_string(),
            offset: span.start as usize,
        };
        match dir {
            Directive::Slot { .. } if non_component && tag != "template" => {
                return Err(fail("`v-slot` can only be used on components or `<template>` tags"));
            }
            Directive::Html { .. } if !children.is_empty() => {
                return Err(fail("`v-html` will override element children"));
            }
            Directive::Custom { name, arg: None, .. } if name == "text" && !children.is_empty() => {
                return Err(fail("`v-text` will override element children"));
            }
            Directive::Model { .. }
                if non_component && !matches!(tag, "input" | "textarea" | "select") =>
            {
                return Err(fail(
                    "`v-model` can only be used on `<input>`, `<textarea>` and `<select>` elements",
                ));
            }
            _ => {}
        }
    }
    Ok(())
}

/// Vue reports repeated attribute names as a compile error (case-sensitive, `class` included).
fn check_duplicate_attrs(attrs: &[ConcreteAttr]) -> Result<(), TemplateParseError> {
    let mut seen = std::collections::HashSet::new();
    for attr in attrs {
        let Some(name) = attr_source_name(attr) else {
            continue;
        };
        if !seen.insert(name.clone()) {
            return Err(TemplateParseError {
                message: format!("duplicate attribute `{name}`"),
                offset: concrete_attr_span(attr).start as usize,
            });
        }
    }
    Ok(())
}

/// Source spelling of an attribute, used only for duplicate detection.
fn attr_source_name(attr: &ConcreteAttr) -> Option<String> {
    let dir = match attr {
        ConcreteAttr::Static { name, .. } => return Some(name.clone()),
        ConcreteAttr::Directive { dir, .. } => dir,
    };
    Some(match dir {
        Directive::If { .. } => "v-if".to_string(),
        Directive::ElseIf { .. } => "v-else-if".to_string(),
        Directive::Else => "v-else".to_string(),
        Directive::Html { .. } => "v-html".to_string(),
        Directive::Show { .. } => "v-show".to_string(),
        Directive::For { .. } => "v-for".to_string(),
        Directive::BindObject { .. } => "v-bind".to_string(),
        Directive::OnObject { .. } => "v-on".to_string(),
        Directive::Bind { arg, .. } => format!(":{}", directive_arg_key(arg)),
        Directive::On { arg, .. } => format!("@{}", directive_arg_key(arg)),
        Directive::Model { arg: Some(arg), .. } => format!("v-model:{arg}"),
        Directive::Model { arg: None, .. } => "v-model".to_string(),
        // Vue reports repeated slot names through a separate diagnostic.
        Directive::Slot { .. } => return None,
        Directive::Custom { name, arg, .. } => match arg {
            Some(arg) => format!("v-{name}:{}", directive_arg_key(arg)),
            None => format!("v-{name}"),
        },
    })
}

fn directive_arg_key(arg: &DirectiveArg) -> String {
    match arg {
        DirectiveArg::Static(name) => name.clone(),
        DirectiveArg::Dynamic(expr) => format!("[{expr}]"),
    }
}

fn concrete_attr_span(attr: &ConcreteAttr) -> TemplateSpan {
    match attr {
        ConcreteAttr::Static { span, .. } | ConcreteAttr::Directive { span, .. } => *span,
    }
}

/// Build [`SemanticNode::IfChain`] from already-lowered branch bodies.
pub(crate) fn if_chain_from_branches(branches: Vec<IfBranch>) -> SemanticNode {
    let span =
        TemplateSpan { start: branches[0].span.start, end: branches.last().unwrap().span.end };
    SemanticNode::IfChain { branches, span }
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
                    out.push(SemanticNode::Text { value: value.clone(), span: *span });
                }
                i += 1;
            }
            ConcreteNode::Interpolation { expr, span } => {
                out.push(SemanticNode::Interpolation { expr: expr.clone(), span: *span });
                i += 1;
            }
            ConcreteNode::Element { attrs, span, .. } => match control_flow_kind(attrs) {
                Some(ControlFlowKind::If(_)) => {
                    let (chain, consumed) = take_if_chain(&nodes[i..])?;
                    out.push(chain);
                    i += consumed;
                }
                Some(ControlFlowKind::ElseIf(_)) => {
                    return Err(TemplateParseError {
                        message: "`v-else-if` requires a preceding `v-if` / `v-else-if`".into(),
                        offset: span.start as usize,
                    });
                }
                Some(ControlFlowKind::Else) => {
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

        let body = lower_element_strip_control_flow(&nodes[i])?;
        branches.push(IfBranch { test, body: Box::new(body), span: *span });
        i += 1;
        if saw_else {
            break;
        }
    }

    Ok((if_chain_from_branches(branches), i))
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
            dir: Directive::Bind { arg: DirectiveArg::Static(name), expr, .. },
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
    let ConcreteNode::Element { tag, attrs, children, span } = node else {
        return Err(TemplateParseError { message: "internal: expected element".into(), offset: 0 });
    };
    lower_for_from_parts(tag, attrs, children, *span)
}

fn for_node_from_lowered(
    tag: &str,
    attrs: &[ConcreteAttr],
    children: Vec<SemanticNode>,
    span: TemplateSpan,
) -> Result<SemanticNode, TemplateParseError> {
    let Some(Directive::For { source, value_alias, key_alias, index_alias }) =
        for_directive(attrs).cloned()
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
            !matches!(a, ConcreteAttr::Directive { dir: Directive::For { .. }, .. })
                && !matches!(
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

fn lower_for_from_parts(
    tag: &str,
    attrs: &[ConcreteAttr],
    children: &[ConcreteNode],
    span: TemplateSpan,
) -> Result<SemanticNode, TemplateParseError> {
    for_node_from_lowered(tag, attrs, lower_siblings(children)?, span)
}

fn lower_element_strip_control_flow(
    node: &ConcreteNode,
) -> Result<SemanticNode, TemplateParseError> {
    let ConcreteNode::Element { tag, attrs, children, span } = node else {
        return Err(TemplateParseError { message: "internal: expected element".into(), offset: 0 });
    };
    semantic_from_element_parts(tag, attrs, lower_siblings(children)?, *span)
}

fn slot_directive(attrs: &[ConcreteAttr]) -> Option<(DirectiveArg, Option<String>, TemplateSpan)> {
    for a in attrs {
        if let ConcreteAttr::Directive { dir: Directive::Slot { name, props }, span } = a {
            return Some((name.clone(), props.clone(), *span));
        }
    }
    None
}

fn slot_outlet_from_lowered(
    attrs: &[ConcreteAttr],
    children: Vec<SemanticNode>,
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
    let props = lower_props("slot", &rest);
    Ok(SemanticNode::SlotOutlet { name, props, children, span })
}

fn slot_template_from_lowered(
    tag: &str,
    attrs: &[ConcreteAttr],
    children: Vec<SemanticNode>,
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
        .filter(|a| !matches!(a, ConcreteAttr::Directive { dir: Directive::Slot { .. }, .. }))
        .cloned()
        .collect();
    let body = if tag == "template" {
        SemanticNode::Element { tag: "template".into(), props: Vec::new(), children, span }
    } else {
        SemanticNode::Element {
            tag: tag.to_string(),
            props: lower_props(tag, &attrs_no_slot),
            children,
            span,
        }
    };
    Ok(SemanticNode::SlotTemplate { name: slot_name, slot_props, body: Box::new(body), span })
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
    let mut class_static: Vec<String> = Vec::new();
    let mut class_binds: Vec<String> = Vec::new();
    let mut class_span: Option<TemplateSpan> = None;
    let mut style_static: Option<String> = None;
    let mut style_binds: Vec<String> = Vec::new();
    let mut style_span: Option<TemplateSpan> = None;

    for a in attrs {
        match a {
            ConcreteAttr::Static { name, value, span } if name == "class" => {
                for tok in value.split_whitespace() {
                    class_static.push(tok.to_string());
                }
                class_span = Some(merge_span(class_span, *span));
            }
            ConcreteAttr::Static { name, value, span } if name == "style" => {
                style_static = Some(value.clone());
                style_span = Some(merge_span(style_span, *span));
            }
            ConcreteAttr::Static { name, value, span } => {
                out.push(SemanticProp::Static {
                    name: name.clone(),
                    value: value.clone(),
                    span: *span,
                });
            }
            ConcreteAttr::Directive { dir, span } => match dir {
                Directive::Bind { arg: DirectiveArg::Static(n), expr, modifiers, .. }
                    if n == "class" =>
                {
                    let _ = modifiers;
                    class_binds.push(expr.clone());
                    class_span = Some(merge_span(class_span, *span));
                }
                Directive::Bind { arg: DirectiveArg::Static(n), expr, modifiers, .. }
                    if n == "style" =>
                {
                    let _ = modifiers;
                    style_binds.push(expr.clone());
                    style_span = Some(merge_span(style_span, *span));
                }
                Directive::Bind { arg, expr, modifiers } => {
                    out.push(SemanticProp::Bind {
                        arg: arg.clone(),
                        expr: expr.clone(),
                        modifiers: modifiers.clone(),
                        span: *span,
                    });
                }
                Directive::BindObject { expr } => {
                    out.push(SemanticProp::BindObject { expr: expr.clone(), span: *span });
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
                    out.push(SemanticProp::OnObject { expr: expr.clone(), span: *span });
                }
                Directive::Model { arg, expr, modifiers } => {
                    out.push(SemanticProp::Model {
                        arg: arg.clone(),
                        expr: expr.clone(),
                        modifiers: modifiers.clone(),
                        span: *span,
                    });
                }
                other => {
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
                    out.push(SemanticProp::Directive { dir: other.clone(), span: *span });
                }
            },
        }
    }

    if !class_static.is_empty() || !class_binds.is_empty() {
        out.push(SemanticProp::ClassPlan {
            static_classes: class_static,
            binds: class_binds,
            span: class_span.unwrap_or_default(),
        });
    }
    if style_static.is_some() || !style_binds.is_empty() {
        out.push(SemanticProp::StylePlan {
            static_style: style_static,
            binds: style_binds,
            span: style_span.unwrap_or_default(),
        });
    }
    out
}

fn merge_span(prev: Option<TemplateSpan>, next: TemplateSpan) -> TemplateSpan {
    match prev {
        None => next,
        Some(p) => TemplateSpan { start: p.start.min(next.start), end: p.end.max(next.end) },
    }
}
