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
    let roots = lower_siblings(&concrete.roots)?;
    validate_root_slot_templates(&roots)?;
    Ok(SemanticIr { roots })
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
///
/// `has_author_children` mirrors Vue's `children.length`: whitespace-only text is not a child,
/// while comments and interpolations are. The lowered `children` list cannot answer that itself
/// because comments are dropped before Semantic.
pub(crate) fn semantic_from_element_parts(
    tag: &str,
    attrs: &[ConcreteAttr],
    children: Vec<SemanticNode>,
    span: TemplateSpan,
    has_author_children: bool,
) -> Result<SemanticNode, TemplateParseError> {
    // Vue rejects side-effect tags in a template (`X_...SIDE_EFFECT`). Accepting them would
    // let a `.vmz` template ship `<script>` / `<style>` the compiler never accounted for.
    if tag.eq_ignore_ascii_case("script") || tag.eq_ignore_ascii_case("style") {
        return Err(TemplateParseError::parse_failed(
            format!("`<{tag}>` is ignored in client component templates"),
            span.start as usize,
        ));
    }
    validate_vue_element_syntax(tag, attrs, has_author_children)?;
    validate_slot_usage(tag, attrs, &children)?;
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
    has_author_children: bool,
) -> Result<(), TemplateParseError> {
    let non_component = is_non_component_tag(tag);
    for attr in attrs {
        let ConcreteAttr::Directive { dir, span } = attr else {
            continue;
        };
        let fail = |message: &str| {
            TemplateParseError::parse_failed(message.to_string(), span.start as usize)
        };
        match dir {
            Directive::Slot { .. } if non_component && tag != "template" => {
                return Err(fail("`v-slot` can only be used on components or `<template>` tags"));
            }
            Directive::Html { .. } if has_author_children => {
                return Err(fail("`v-html` will override element children"));
            }
            Directive::Text { .. } if has_author_children => {
                return Err(fail("`v-text` will override element children"));
            }
            Directive::Model { .. }
                if non_component && !matches!(tag, "input" | "textarea" | "select") =>
            {
                return Err(fail(
                    "`v-model` can only be used on `<input>`, `<textarea>` and `<select>` elements",
                ));
            }
            Directive::Model { arg: Some(_), .. } if non_component => {
                return Err(fail("`v-model` argument is not supported on plain elements"));
            }
            _ => {}
        }
    }
    Ok(())
}

/// Reject slot syntax Vue rejects: misplaced `v-slot`, duplicate names, mixed forms and
/// extraneous children next to an explicit default slot.
///
/// `children` is already lowered, so only direct slot templates are visible. That matches Vue:
/// its slot analysis ignores slot templates wrapped by `v-if` / `v-for`, and comments or
/// whitespace-only text are not "extraneous" children.
fn validate_slot_usage(
    tag: &str,
    attrs: &[ConcreteAttr],
    children: &[SemanticNode],
) -> Result<(), TemplateParseError> {
    let non_component = is_non_component_tag(tag);
    let mut slots: Vec<(&DirectiveArg, TemplateSpan)> = Vec::new();
    let mut template_slots: Vec<TemplateSpan> = Vec::new();
    for child in children {
        let SemanticNode::SlotTemplate { name, body, span, .. } = child else {
            continue;
        };
        // Only a `<template #x>` filler produces a `template` body; `<Comp v-slot>` keeps the
        // component as its body, so the two forms stay distinguishable here.
        if matches!(body.as_ref(), SemanticNode::Element { tag, .. } if tag == "template") {
            template_slots.push(*span);
        }
        slots.push((name, *span));
    }

    // A `<template v-slot>` filler is only meaningful directly inside a component. Vue reports
    // `X_V_SLOT_MISPLACED` for elements and crashes in codegen for the remaining placements.
    if non_component {
        if let Some(span) = template_slots.first() {
            return Err(TemplateParseError::parse_failed(
                "`v-slot` can only be used on a `<template>` inside a component",
                span.start as usize,
            ));
        }
    }

    // `X_V_SLOT_MIXED_SLOT_USAGE`: `<Comp v-slot>` plus nested `<template #x>` children.
    if tag != "template" && slot_directive(attrs).is_some() {
        if let Some((_, span)) = slots.first() {
            return Err(TemplateParseError::parse_failed(
                "mixed `v-slot` usage on both the component and nested `<template>`",
                span.start as usize,
            ));
        }
    }

    // `X_V_SLOT_DUPLICATE_SLOT_NAMES` (static names only; dynamic slots are rejected earlier).
    let mut seen = std::collections::HashSet::new();
    for (name, span) in &slots {
        let DirectiveArg::Static(name) = name else {
            continue;
        };
        if !seen.insert(name.clone()) {
            return Err(TemplateParseError::parse_failed(
                format!("duplicate slot name `{name}`"),
                span.start as usize,
            ));
        }
    }

    // `X_V_SLOT_EXTRANEOUS_DEFAULT_SLOT_CHILDREN`: an explicit `#default` makes siblings dead.
    if !non_component {
        let default_span = slots
            .iter()
            .find(|(name, _)| matches!(name, DirectiveArg::Static(n) if n == "default"))
            .map(|(_, span)| *span);
        if let Some(span) = default_span {
            if children.iter().any(|c| !matches!(c, SemanticNode::SlotTemplate { .. })) {
                return Err(TemplateParseError::parse_failed(
                    "extraneous children found next to an explicit default slot",
                    span.start as usize,
                ));
            }
        }
    }

    Ok(())
}

/// Root `<template v-slot>` fills no component slot; Vue fails in codegen instead.
pub(crate) fn validate_root_slot_templates(
    roots: &[SemanticNode],
) -> Result<(), TemplateParseError> {
    for node in roots {
        let SemanticNode::SlotTemplate { body, span, .. } = node else {
            continue;
        };
        if matches!(body.as_ref(), SemanticNode::Element { tag, .. } if tag == "template") {
            return Err(TemplateParseError::parse_failed(
                "`v-slot` can only be used on a `<template>` inside a component",
                span.start as usize,
            ));
        }
    }
    Ok(())
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
            ConcreteNode::Element { attrs, span, .. } => {
                if concrete_has_pre_directive(attrs) {
                    out.push(lower_element_verbatim(&nodes[i])?);
                    i += 1;
                    continue;
                }
                // Vue 3 rejects mixing `v-for` with any `v-if`-family directive on
                // the same element — the author must wrap one in `<template>`.
                if for_directive(attrs).is_some() && control_flow_kind(attrs).is_some() {
                    return Err(TemplateParseError::coded(
                        "vmz::template::v_for_v_if_conflict",
                        span.start as usize,
                    )
                    .with_arg(
                        "detail",
                        "cannot use `v-for` together with `v-if` / `v-else-if` / \
                         `v-else` on the same element; wrap one side in `<template>`",
                    ));
                }
                match control_flow_kind(attrs) {
                    Some(ControlFlowKind::If(_)) => {
                        let (chain, consumed) = take_if_chain(&nodes[i..])?;
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
                    None if for_directive(attrs).is_some() => {
                        out.push(lower_for_element(&nodes[i])?);
                        i += 1;
                    }
                    None => {
                        out.push(lower_element_strip_control_flow(&nodes[i])?);
                        i += 1;
                    }
                }
            }
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
                return Err(TemplateParseError::coded(
                    "vmz::template::illegal_directive",
                    span.start as usize,
                ));
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

pub(crate) fn for_directive(attrs: &[ConcreteAttr]) -> Option<&Directive> {
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
        return Err(TemplateParseError::parse_failed("internal: expected element", 0));
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
        return Err(TemplateParseError::parse_failed(
            "internal: expected `v-for`",
            span.start as usize,
        ));
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
        return Err(TemplateParseError::parse_failed("internal: expected element", 0));
    };
    semantic_from_element_parts(
        tag,
        attrs,
        lower_siblings(children)?,
        *span,
        concrete_has_author_children(children),
    )
}

/// Vue counts comments and interpolations as children and drops whitespace-only text.
fn concrete_has_author_children(children: &[ConcreteNode]) -> bool {
    children.iter().any(|child| match child {
        ConcreteNode::Text { value, .. } => !value.trim().is_empty(),
        _ => true,
    })
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
        return Err(TemplateParseError::coded(
            "vmz::template::illegal_directive",
            slot_span.start as usize,
        )
        .with_arg("detail", "dynamic `v-slot` / `#` argument"));
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
                // `v-once` is a region marker, not a prop: keep it as a Static marker
                // (same shape as the verbatim `v-pre` marker) so it survives printing
                // and reaches emit, while the subtree stays fully structured.
                Directive::Once => {
                    out.push(SemanticProp::Static {
                        name: "v-once".into(),
                        value: String::new(),
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

// ——————————————————————————————————————————————————————————————————————————
// Concrete → Semantic verbatim (`v-pre`) lowering
// ——————————————————————————————————————————————————————————————————————————

fn concrete_has_pre_directive(attrs: &[ConcreteAttr]) -> bool {
    attrs.iter().any(|a| matches!(a, ConcreteAttr::Directive { dir: Directive::Pre, .. }))
}

fn lower_element_verbatim(node: &ConcreteNode) -> Result<SemanticNode, TemplateParseError> {
    let ConcreteNode::Element { tag, attrs, children, span } = node else {
        return Err(TemplateParseError::parse_failed(
            "internal: expected element for v-pre lowering",
            0,
        ));
    };
    let props = lower_attrs_verbatim(attrs);
    let kids = lower_siblings_verbatim(children)?;
    Ok(SemanticNode::Element { tag: tag.clone(), props, children: kids, span: *span })
}

fn lower_siblings_verbatim(
    nodes: &[ConcreteNode],
) -> Result<Vec<SemanticNode>, TemplateParseError> {
    let mut out = Vec::new();
    for node in nodes {
        match node {
            ConcreteNode::Comment { .. } => {}
            ConcreteNode::Text { value, span } => {
                if !value.trim().is_empty() {
                    out.push(SemanticNode::Text { value: value.clone(), span: *span });
                }
            }
            // Verbatim: `{{ x }}` must be kept as literal text including the mustache
            // delimiters. Oak AST had the full source span here; Concrete only has
            // the expression body, so we reconstruct `{{ expr }}`.
            ConcreteNode::Interpolation { expr, span } => {
                let value = format!("{{{{ {} }}}}", expr);
                out.push(SemanticNode::Text { value, span: *span });
            }
            ConcreteNode::Element { .. } => {
                out.push(lower_element_verbatim(node)?);
            }
        }
    }
    Ok(out)
}

/// Turn every ConcreteAttr on a verbatim element back into a `SemanticProp::Static`.
///
/// The Concrete layer already folds source spellings (`:title`, `v-bind:title`) into
/// structured variants, so we rebuild the common spellings on a best-effort basis
/// rather than inventing a source span round-trip. For the `v-pre` use case the
/// exact author spelling does not affect runtime behavior — verbatim still renders
/// a plain attribute — but keeping close to Vue's authoring surface aids parity.
fn lower_attrs_verbatim(attrs: &[ConcreteAttr]) -> Vec<SemanticProp> {
    let mut out = Vec::with_capacity(attrs.len());
    for attr in attrs {
        let (name, value, span) = match attr {
            ConcreteAttr::Static { name, value, span } => (name.clone(), value.clone(), *span),
            ConcreteAttr::Directive { dir, span } => match dir {
                Directive::Pre => ("v-pre".into(), String::new(), *span),
                Directive::Once => ("v-once".into(), String::new(), *span),
                Directive::If { test } => ("v-if".into(), test.clone(), *span),
                Directive::ElseIf { test } => ("v-else-if".into(), test.clone(), *span),
                Directive::Else => ("v-else".into(), String::new(), *span),
                Directive::For { source, .. } => ("v-for".into(), source.clone(), *span),
                Directive::Html { expr } => ("v-html".into(), expr.clone(), *span),
                Directive::Text { expr } => ("v-text".into(), expr.clone(), *span),
                Directive::Show { expr } => ("v-show".into(), expr.clone(), *span),
                Directive::Model { arg, expr, .. } => (
                    match arg {
                        Some(a) => format!("v-model:{a}"),
                        None => "v-model".into(),
                    },
                    expr.clone(),
                    *span,
                ),
                Directive::Bind { arg, expr, .. } => {
                    let n = match arg {
                        DirectiveArg::Static(s) => format!(":{s}"),
                        DirectiveArg::Dynamic(e) => format!(":[{e}]"),
                    };
                    (n, expr.clone(), *span)
                }
                Directive::BindObject { expr } => ("v-bind".into(), expr.clone(), *span),
                Directive::On { arg, handler, .. } => {
                    let n = match arg {
                        DirectiveArg::Static(s) => format!("@{s}"),
                        DirectiveArg::Dynamic(e) => format!("@[{e}]"),
                    };
                    (n, handler.clone(), *span)
                }
                Directive::OnObject { expr } => ("v-on".into(), expr.clone(), *span),
                Directive::Slot { name, props } => {
                    let n = match name {
                        DirectiveArg::Static(s) => format!("#{s}"),
                        DirectiveArg::Dynamic(e) => format!("#[{e}]"),
                    };
                    (n, props.clone().unwrap_or_default(), *span)
                }
                Directive::Custom { name, arg, expr, .. } => {
                    let n = match arg {
                        Some(DirectiveArg::Static(a)) => format!("v-{name}:{a}"),
                        Some(DirectiveArg::Dynamic(e)) => format!("v-{name}:[{e}]"),
                        None => format!("v-{name}"),
                    };
                    (n, expr.clone().unwrap_or_default(), *span)
                }
            },
        };
        out.push(SemanticProp::Static { name, value, span });
    }
    out
}
