//! Legacy emit-facing template IR (`TemplateAttr` string model). Kept for
//! structural_build / reactive_build / generator until Semantic / Execution IR lands.

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
}

/// One attribute on a [`TemplateNode::Element`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TemplateAttr {
    /// Canonical IR name (`if`, `each`, `@click`, `class`, …).
    pub name: String,
    /// Static string or expression binding.
    pub value: AttrValue,
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
