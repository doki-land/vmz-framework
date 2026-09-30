//! Oak CST parse entry for VMZ `<template>` regions.

use oak_core::{ParseSession, Parser, SourceText};
use oak_vue::{VueLanguage, VueParser};
use vmz_compiler::TemplateBlock;

use crate::contract::{ByteSpan, OakFrontendDiagnostic, TemplateCstParse};

const TEMPLATE_OPEN: &str = "<template>";
const TEMPLATE_CLOSE: &str = "</template>";

/// Parse a VMZ template body through Oak `VueParser` (CST / Green tree).
///
/// Wraps the inner template markup in a Vue `<template>` shell so Oak sees a valid SFC
/// fragment. Spans in diagnostics are remapped to the original `.vmz` file when possible.
pub fn parse_template_cst(template: &TemplateBlock) -> TemplateCstParse {
    let shell_source = format!("{}{}{}", TEMPLATE_OPEN, template.content, TEMPLATE_CLOSE);
    let shell_base_offset = template.content_start.saturating_sub(TEMPLATE_OPEN.len());

    let source = SourceText::new(shell_source.as_str());
    let language = VueLanguage::default();
    let parser = VueParser::new(&language);
    let mut session = ParseSession::default();

    let output = parser.parse(&source, &[], &mut session);
    let diagnostics = collect_oak_diagnostics(&output, shell_base_offset);
    let ok = !output.has_errors();

    TemplateCstParse {
        shell_source,
        shell_base_offset,
        diagnostics,
        ok,
    }
}

/// Fail fast when Oak CST rejects a template body (for `vmz format` preflight).
pub fn require_template_cst(template: &TemplateBlock) -> Result<(), String> {
    let parse = parse_template_cst(template);
    if parse.ok {
        return Ok(());
    }
    Err(format_cst_diagnostics(&parse.diagnostics))
}

/// Render Oak CST diagnostics for CLI / formatter surfaces.
pub fn format_cst_diagnostics(diags: &[OakFrontendDiagnostic]) -> String {
    if diags.is_empty() {
        return "Oak template CST parse failed".to_string();
    }
    diags
        .iter()
        .map(|d| match d.span {
            Some(span) => format!("{} (byte {}..{})", d.message, span.start, span.end),
            None => d.message.clone(),
        })
        .collect::<Vec<_>>()
        .join("; ")
}

fn collect_oak_diagnostics(
    output: &oak_core::parser::ParseOutput<'_, oak_vue::VueLanguage>,
    shell_base_offset: usize,
) -> Vec<OakFrontendDiagnostic> {
    let mut out = Vec::new();
    if let Err(err) = &output.result {
        out.push(map_oak_error(err, shell_base_offset));
    }
    for err in &output.diagnostics {
        out.push(map_oak_error(err, shell_base_offset));
    }
    out
}

fn map_oak_error(err: &oak_core::OakError, shell_base_offset: usize) -> OakFrontendDiagnostic {
    let message = err.to_string();
    let span = oak_error_offset(err).map(|off| vmz_span_from_shell(off, shell_base_offset));
    OakFrontendDiagnostic { message, span }
}

fn oak_error_offset(err: &oak_core::OakError) -> Option<usize> {
    use oak_core::OakErrorKind;
    match err.kind() {
        OakErrorKind::SyntaxError { offset, .. }
        | OakErrorKind::UnexpectedCharacter { offset, .. }
        | OakErrorKind::UnexpectedToken { offset, .. }
        | OakErrorKind::UnexpectedEof { offset, .. }
        | OakErrorKind::ExpectedToken { offset, .. }
        | OakErrorKind::ExpectedName { offset, .. }
        | OakErrorKind::TrailingCommaNotAllowed { offset, .. } => Some(*offset),
        _ => None,
    }
}

fn vmz_span_from_shell(shell_offset: usize, shell_base_offset: usize) -> ByteSpan {
    let start = shell_base_offset + shell_offset;
    ByteSpan {
        start,
        end: start.saturating_add(1),
    }
}
