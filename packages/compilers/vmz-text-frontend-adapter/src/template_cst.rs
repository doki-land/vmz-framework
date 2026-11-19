//! `data.text` CST parse entry for VMZ `<template>` regions.

use crate::contract::{ByteSpan, FrontendDiagnostic, TemplateCstParse, TemplateShellInput};
use data_text_core::{TextError, TextErrorKind, ParseSession, Parser, SourceText};
use data_text_vue::{VueLanguage, VueParser};

pub(crate) const TEMPLATE_OPEN: &str = "<template>";
pub(crate) const TEMPLATE_CLOSE: &str = "</template>";

/// Parse a VMZ template body through `VueParser` (CST / Green tree).
pub fn parse_template_cst(template: &TemplateShellInput) -> TemplateCstParse {
    let shell_source = format!("{}{}{}", TEMPLATE_OPEN, template.content, TEMPLATE_CLOSE);
    let shell_base_offset = template.content_start.saturating_sub(TEMPLATE_OPEN.len());

    let source = SourceText::new(shell_source.as_str());
    let language = VueLanguage::default();
    let parser = VueParser::new(&language);
    let mut session = ParseSession::default();

    let output = parser.parse(&source, &[], &mut session);
    let diagnostics = collect_text_diagnostics(&output, shell_base_offset);
    let ok = !output.has_errors();

    TemplateCstParse { shell_source, shell_base_offset, diagnostics, ok }
}

/// Fail fast when `data.text` CST rejects a template body (for `vmz format` preflight).
pub fn require_template_cst(
    template: &TemplateShellInput,
) -> Result<(), Vec<FrontendDiagnostic>> {
    let parse = parse_template_cst(template);
    if parse.ok {
        return Ok(());
    }
    Err(non_empty(parse.diagnostics, "vmz::template::parse_failed"))
}

/// Render `data.text` CST diagnostics for CLI / formatter surfaces without a catalog.
pub fn format_cst_diagnostics(diags: &[FrontendDiagnostic]) -> String {
    if diags.is_empty() {
        return "`data.text` template CST parse failed".to_string();
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

fn collect_text_diagnostics(
    output: &data_text_core::parser::ParseOutput<'_, data_text_vue::VueLanguage>,
    shell_base_offset: usize,
) -> Vec<FrontendDiagnostic> {
    let mut out = Vec::new();
    if let Err(err) = &output.result {
        out.push(map_text_error(err, shell_base_offset));
    }
    for err in &output.diagnostics {
        out.push(map_text_error(err, shell_base_offset));
    }
    out
}

/// Map one `data.text` error to `code + args + span` (span remapped into the `.vmz` file).
pub(crate) fn map_text_error(err: &TextError, shell_base_offset: usize) -> FrontendDiagnostic {
    let mut diagnostic = describe(err);
    if let Some(offset) = text_error_offset(err) {
        diagnostic.span = Some(vmz_span_from_shell(offset, shell_base_offset));
    }
    diagnostic
}

/// `data.text` error kinds → stable VMZ/`data.text` diagnostic codes.
///
/// The VMZ template language maps `InterpolationEnd` to `invalid_expr`: `data.text` rejects
/// a mustache whose inner expression is incomplete before VMZ expression checks run,
/// and authors should see the same code as other invalid mustaches.
pub(crate) fn describe(err: &TextError) -> FrontendDiagnostic {
    match err.kind() {
        TextErrorKind::UnexpectedCharacter { character, .. } => {
            FrontendDiagnostic::new("text::unexpected_character")
                .with_arg("character", character.to_string())
        }
        TextErrorKind::UnexpectedToken { token, .. } => {
            if token.eq_ignore_ascii_case("InterpolationEnd") {
                FrontendDiagnostic::new("vmz::template::invalid_expr")
            } else {
                FrontendDiagnostic::new("text::unexpected_token").with_arg("token", token.clone())
            }
        }
        TextErrorKind::UnexpectedEof { .. } => FrontendDiagnostic::new("text::unexpected_eof"),
        TextErrorKind::ExpectedToken { expected, .. } => {
            FrontendDiagnostic::new("text::expected_token").with_arg("expected", expected.clone())
        }
        TextErrorKind::ExpectedName { name_kind, .. } => {
            FrontendDiagnostic::new("text::expected_name").with_arg("kind", name_kind.clone())
        }
        TextErrorKind::TrailingCommaNotAllowed { .. } => {
            FrontendDiagnostic::new("text::trailing_comma")
        }
        TextErrorKind::SyntaxError { .. } => FrontendDiagnostic::new("text::syntax"),
        _ => FrontendDiagnostic::new("text::parse_failed"),
    }
}

fn text_error_offset(err: &TextError) -> Option<usize> {
    match err.kind() {
        TextErrorKind::SyntaxError { offset, .. }
        | TextErrorKind::UnexpectedCharacter { offset, .. }
        | TextErrorKind::UnexpectedToken { offset, .. }
        | TextErrorKind::UnexpectedEof { offset, .. }
        | TextErrorKind::ExpectedToken { offset, .. }
        | TextErrorKind::ExpectedName { offset, .. }
        | TextErrorKind::TrailingCommaNotAllowed { offset, .. } => Some(*offset),
        _ => None,
    }
}

fn vmz_span_from_shell(shell_offset: usize, shell_base_offset: usize) -> ByteSpan {
    let start = shell_base_offset + shell_offset;
    ByteSpan { start, end: start.saturating_add(1) }
}

/// Never hand an empty diagnostic list to a caller that needs at least one code.
pub(crate) fn non_empty(
    diagnostics: Vec<FrontendDiagnostic>,
    fallback: &'static str,
) -> Vec<FrontendDiagnostic> {
    if diagnostics.is_empty() { vec![FrontendDiagnostic::new(fallback)] } else { diagnostics }
}
