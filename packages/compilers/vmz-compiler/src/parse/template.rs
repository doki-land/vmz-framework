//! Vue template syntax → Concrete AST → legacy [`TemplateIr`].
//!
//! **Author syntax** aims at Vue template isomorphism. **Emit** still consumes
//! [`TemplateIr`] / [`TemplateAttr`] via [`super::template_lower`]. Layer-1 Concrete
//! types live in [`super::template_concrete`]; do not add new string directive
//! specials on the legacy attr model (P0 freeze).

use std::path::PathBuf;

use crate::diagnostic::ReportedDiagnostic;
use vmz_protocol::SourceSpan;

pub use super::template_common::{TemplateParseError, decode_html_entities};
pub use super::template_concrete::{
    ConcreteAttr, ConcreteIr, ConcreteNode, Directive, DirectiveArg, parse_template_concrete,
};
pub use super::template_ir::{AttrValue, TemplateAttr, TemplateIr, TemplateNode};
pub use super::template_lower::lower_concrete_to_ir;
pub use super::template_span::TemplateSpan;

/// Parse a `<template>` body as Vue template syntax into legacy VMZ IR.
///
/// Pipeline: [`parse_template_concrete`] → [`lower_concrete_to_ir`].
pub fn parse_template(input: &str) -> Result<TemplateIr, TemplateParseError> {
    let concrete = parse_template_concrete(input)?;
    lower_concrete_to_ir(&concrete)
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
    ReportedDiagnostic::error(&path, format!("template: {}", err.message))
        .with_source_span(SourceSpan { path: path.to_string_lossy().into_owned(), start, end })
}
