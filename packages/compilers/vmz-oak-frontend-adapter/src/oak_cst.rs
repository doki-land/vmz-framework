//! Oak CST parse entry for VMZ `<template>` regions.

use crate::contract::{ByteSpan, OakFrontendDiagnostic, TemplateCstParse, TemplateShellInput};
use oak_core::{OakError, OakErrorKind, ParseSession, Parser, SourceText};
use oak_vue::{VueLanguage, VueParser};

pub(crate) const TEMPLATE_OPEN: &str = "<template>";
pub(crate) const TEMPLATE_CLOSE: &str = "</template>";

/// Parse a VMZ template body through Oak `VueParser` (CST / Green tree).
pub fn parse_template_cst(template: &TemplateShellInput) -> TemplateCstParse {
    let shell_source = format!("{}{}{}", TEMPLATE_OPEN, template.content, TEMPLATE_CLOSE);
    let shell_base_offset = template.content_start.saturating_sub(TEMPLATE_OPEN.len());

    let source = SourceText::new(shell_source.as_str());
    let language = VueLanguage::default();
    let parser = VueParser::new(&language);
    let mut session = ParseSession::default();

    let output = parser.parse(&source, &[], &mut session);
    let diagnostics = collect_oak_diagnostics(&output, shell_base_offset);
    let ok = !output.has_errors();

    TemplateCstParse { shell_source, shell_base_offset, diagnostics, ok }
}

/// Fail fast when Oak CST rejects a template body (for `vmz format` preflight).
pub fn require_template_cst(
    template: &TemplateShellInput,
) -> Result<(), Vec<OakFrontendDiagnostic>> {
    let parse = parse_template_cst(template);
    if parse.ok {
        return Ok(());
    }
    Err(non_empty(parse.diagnostics, "vmz::template::parse_failed"))
}

/// Render Oak CST diagnostics for CLI / formatter surfaces without a catalog.
pub fn format_cst_diagnostics(diags: &[OakFrontendDiagnostic]) -> String {
    if diags.is_empty() {
        return "Oak template CST parse failed".to_string();
    }
    diags
        .iter()
        .map(|d| match d.span {
            Some(span) => format!("{} (byte {}..{})", d.render_plain(), span.start, span.end),
            None => d.render_plain(),
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

/// Map one Oak error to `code + args + span` (span remapped into the `.vmz` file).
pub(crate) fn map_oak_error(err: &OakError, shell_base_offset: usize) -> OakFrontendDiagnostic {
    let mut diagnostic = describe(err);
    if let Some(offset) = oak_error_offset(err) {
        diagnostic.span = Some(vmz_span_from_shell(offset, shell_base_offset));
    }
    diagnostic
}

/// Oak error kinds → stable VMZ/Oak diagnostic codes.
///
/// The VMZ template language maps `InterpolationEnd` to `invalid_expr`: Oak rejects
/// a mustache whose inner expression is incomplete before VMZ expression checks run,
/// and authors should see the same code as other invalid mustaches.
pub(crate) fn describe(err: &OakError) -> OakFrontendDiagnostic {
    match err.kind() {
        OakErrorKind::UnexpectedCharacter { character, .. } => {
            OakFrontendDiagnostic::new("oak::unexpected_character")
                .with_arg("character", character.to_string())
        }
        OakErrorKind::UnexpectedToken { token, .. } => {
            if token.eq_ignore_ascii_case("InterpolationEnd") {
                OakFrontendDiagnostic::new("vmz::template::invalid_expr")
            } else {
                OakFrontendDiagnostic::new("oak::unexpected_token").with_arg("token", token.clone())
            }
        }
        OakErrorKind::UnexpectedEof { .. } => OakFrontendDiagnostic::new("oak::unexpected_eof"),
        OakErrorKind::ExpectedToken { expected, .. } => {
            OakFrontendDiagnostic::new("oak::expected_token").with_arg("expected", expected.clone())
        }
        OakErrorKind::ExpectedName { name_kind, .. } => {
            OakFrontendDiagnostic::new("oak::expected_name").with_arg("kind", name_kind.clone())
        }
        OakErrorKind::TrailingCommaNotAllowed { .. } => {
            OakFrontendDiagnostic::new("oak::trailing_comma")
        }
        OakErrorKind::SyntaxError { .. } => OakFrontendDiagnostic::new("oak::syntax"),
        _ => OakFrontendDiagnostic::new("oak::parse_failed"),
    }
}

fn oak_error_offset(err: &OakError) -> Option<usize> {
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
    ByteSpan { start, end: start.saturating_add(1) }
}

/// Never hand an empty diagnostic list to a caller that needs at least one code.
pub(crate) fn non_empty(
    diagnostics: Vec<OakFrontendDiagnostic>,
    fallback: &'static str,
) -> Vec<OakFrontendDiagnostic> {
    if diagnostics.is_empty() { vec![OakFrontendDiagnostic::new(fallback)] } else { diagnostics }
}
