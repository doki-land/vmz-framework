//! Vue template syntax → Concrete AST → legacy [`TemplateIr`].
//!
//! **Author syntax** aims at Vue template isomorphism. **Emit** still consumes
//! [`TemplateIr`] / [`TemplateAttr`] via [`super::template_lower`]. Layer-1 Concrete
//! is a **deprecated adapter** (see [`super::template_concrete`]); do not add new
//! string directive specials on the legacy attr model or XML scanner (P0 / stage C freeze).

use std::path::PathBuf;

use crate::diagnostic::ReportedDiagnostic;
use vmz_protocol::SourceSpan;

pub use super::template_common::{TemplateParseError, decode_html_entities};
pub use super::template_concrete::{
    ConcreteAttr, ConcreteIr, ConcreteNode, Directive, DirectiveArg, classify_concrete_attr,
    parse_template_concrete,
};
pub use super::template_ir::{AttrValue, TemplateAttr, TemplateIr, TemplateNode};
pub use super::template_lower::lower_concrete_to_ir;
pub use super::template_oak::{
    parse_template_concrete_body_primary, parse_template_concrete_primary,
    parse_template_concrete_via_oak, parse_template_layers_primary,
    parse_template_semantic_primary,
};
pub use super::template_semantic::{
    EventTarget, IfBranch, SemanticAstStats, SemanticIr, SemanticNode, SemanticProp,
    lower_concrete_to_semantic, semantic_ast_stats,
};
pub use super::template_span::TemplateSpan;

/// Parse a `<template>` body as Vue template syntax into legacy VMZ IR.
///
/// Uses Oak layers primary (Concrete + Semantic), then lowers Concrete → TemplateIr.
pub fn parse_template(input: &str) -> Result<TemplateIr, TemplateParseError> {
    let (concrete, _) = parse_template_layers_primary(&crate::sfc::TemplateBlock {
        content: input.to_string(),
        content_start: 0,
    })?;
    lower_concrete_to_ir(&concrete)
}

/// Parse once into Semantic AST + legacy TemplateIr (Oak layers primary).
pub fn parse_template_asts(input: &str) -> Result<(SemanticIr, TemplateIr), TemplateParseError> {
    let (concrete, semantic) = parse_template_layers_primary(&crate::sfc::TemplateBlock {
        content: input.to_string(),
        content_start: 0,
    })?;
    let ir = lower_concrete_to_ir(&concrete)?;
    Ok((semantic, ir))
}

/// Map a template-body-local parse error to a file-absolute [`ReportedDiagnostic`].
///
/// `content_start` is the UTF-8 byte offset of the `<template>` body in the SFC
/// file (from [`crate::sfc::ParsedVmz::template`].`content_start`).
pub fn template_parse_to_diagnostic(
    path: impl Into<PathBuf>,
    content_start: usize,
    err: &TemplateParseError,
) -> ReportedDiagnostic {
    let path = path.into();
    let (start, end) = TemplateSpan::from_usize(err.offset, err.offset.saturating_add(1))
        .to_absolute(content_start as u32);
    let code = template_error_code(&err.message).unwrap_or("vmz::template::parse_failed");
    ReportedDiagnostic::error(&path, code)
        .with_arg("detail", err.message.clone())
        .with_source_span(SourceSpan { path: path.to_string_lossy().into_owned(), start, end })
}

/// Stable diagnostic codes for structured template parse / semantic failures.
fn template_error_code(message: &str) -> Option<&'static str> {
    if message.contains("`v-else")
        || message.contains("v-else-if")
        || message.contains("dynamic `v-bind`")
        || message.contains("dynamic `v-on`")
        || message.contains("dynamic argument")
        || message.contains("dynamic `v-slot`")
    {
        return Some("vmz::template::illegal_directive");
    }
    None
}
