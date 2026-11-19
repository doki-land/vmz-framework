//! `data.text` AST build entry for VMZ `<template>` regions (Builder API).

use data_text_core::{Builder, ParseSession, SourceText};
use data_text_vue::{VueBuilder, VueRoot};

use crate::contract::{FrontendDiagnostic, TemplateShellInput};
use crate::template_cst::{TEMPLATE_CLOSE, TEMPLATE_OPEN, map_text_error, non_empty};

/// Result of building `data.text` Vue AST for a VMZ template region.
#[derive(Debug, Clone)]
pub struct TemplateAstParse {
    /// Shell text (`<template>…</template>`) passed to `data.text`.
    pub shell_source: String,
    /// Byte offset in `.vmz` where shell byte `0` maps.
    pub shell_base_offset: usize,
    /// Built AST when `data.text` reported no errors.
    pub root: Option<VueRoot>,
    /// `data.text` diagnostics remapped to `.vmz` when possible.
    pub diagnostics: Vec<FrontendDiagnostic>,
    /// `true` when AST build succeeded.
    pub ok: bool,
}

/// Parse + build `data.text` Vue AST for a VMZ template body.
pub fn parse_template_ast(template: &TemplateShellInput) -> TemplateAstParse {
    let shell_source = format!("{}{}{}", TEMPLATE_OPEN, template.content, TEMPLATE_CLOSE);
    let shell_base_offset = template.content_start.saturating_sub(TEMPLATE_OPEN.len());

    let source = SourceText::new(shell_source.as_str());
    let builder = VueBuilder::new();
    let mut cache = ParseSession::default();
    let built = Builder::build(&builder, &source, &[], &mut cache);

    let mut diagnostics = Vec::new();
    if let Err(err) = &built.result {
        diagnostics.push(map_text_error(err, shell_base_offset));
    }
    for err in &built.diagnostics {
        diagnostics.push(map_text_error(err, shell_base_offset));
    }

    let ok = built.result.is_ok() && diagnostics.is_empty();
    let root = built.result.ok();

    TemplateAstParse { shell_source, shell_base_offset, root, diagnostics, ok }
}

/// Fail fast when `data.text` AST build fails.
pub fn require_template_ast(
    template: &TemplateShellInput,
) -> Result<VueRoot, Vec<FrontendDiagnostic>> {
    let parse = parse_template_ast(template);
    if let Some(root) = parse.root.filter(|_| parse.ok) {
        return Ok(root);
    }
    Err(non_empty(parse.diagnostics, "vmz::template::parse_failed"))
}
