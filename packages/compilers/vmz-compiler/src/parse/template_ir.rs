//! Legacy emit-facing template IR (`TemplateAttr` string model). Kept for
//! structural_build / reactive_build / generator until Semantic / Execution IR lands.
//!
//! # Freeze (semantic baseline)
//!
//! **Do not** add new directive string specials on [`TemplateAttr`] (`if2`, `show`,
//! `model`, `slot2`, …). New Vue author syntax must land on Concrete
//! [`super::template_concrete::Directive`] first; the lower adapter may reject
//! unsupported forms with an explicit [`super::template_common::TemplateParseError`].
//! Emit still consumes this IR only as a temporary bridge.

/// One node in the template tree produced by [`super::template::parse_template`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TemplateNode {
    /// Element with tag name, attributes, and child nodes.
    Element {
        /// Tag name as written (`div`, `MyComp`, ...).
        tag: String,
        /// Attributes in source order (directives already lowered).
        attrs: Vec<TemplateAttr>,
        /// Nested children (empty for self-closing tags).
        children: Vec<TemplateNode>,
    },
    /// Decoded text run between tags / interpolations.
    Text(String),
    /// `{{ expr }}` mustache body (trimmed), without the braces.
    Interp(String),
    /// `v-pre` subtree: no node inside it is lowered, validated, folded, or bound.
    ///
    /// Produced only by the `v-pre` intercept in
    /// [`super::template_lower::lower_concrete_to_ir`]. Nested elements are
    /// `Verbatim` too, so every consumer decides once, on this variant, instead
    /// of re-checking attributes per node.
    Verbatim {
        /// Tag name exactly as written (`Link` stays `Link`).
        tag: String,
        /// Attributes in authored order, names kept in directive spelling
        /// (`:class`, `@click.stop`, `v-if`, `#header`).
        attrs: Vec<TemplateAttr>,
        /// Children: raw text or nested verbatim elements.
        children: Vec<VerbatimChild>,
    },
}

/// Child of a [`TemplateNode::Verbatim`] element.
///
/// A separate type keeps the subtree honest: nothing here can hold an
/// interpolation or a lowered element, so a consumer cannot accidentally hand a
/// verbatim descendant back to the normal pipeline.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VerbatimChild {
    /// Author text (entities decoded, `{{ … }}` kept literal).
    Text(String),
    /// Nested element, verbatim all the way down.
    Element {
        /// Tag name exactly as written.
        tag: String,
        /// Attributes in authored order.
        attrs: Vec<TemplateAttr>,
        /// Nested verbatim children.
        children: Vec<VerbatimChild>,
    },
}

/// One attribute on a [`TemplateNode::Element`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TemplateAttr {
    /// Canonical IR name (`if`, `each`, `@click`, `class`, …).
    pub name: String,
    /// Static string or expression binding.
    pub value: AttrValue,
    /// Optional directive modifiers retained from Concrete (`stop`, `prevent`, `lazy`, …).
    /// Downstream emit can pick them up without re-parsing the name string.
    pub modifiers: Vec<String>,
}

impl Default for TemplateAttr {
    fn default() -> Self {
        Self { name: String::new(), value: AttrValue::Static(String::new()), modifiers: Vec::new() }
    }
}

/// Attribute value form after template parse / directive lower.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AttrValue {
    /// Quoted or bare static text (HTML entities decoded).
    Static(String),
    /// Expression binding body (trimmed).
    Interp(String),
}

/// Forest of template roots for one `<template>` body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TemplateIr {
    /// Top-level nodes in document order (comments skipped).
    pub roots: Vec<TemplateNode>,
}
