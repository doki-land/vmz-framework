//! Oak AST build entry for VMZ `<template>` regions (Builder API).

use oak_core::{Builder, ParseSession, SourceText};
use oak_vue::{VueBuilder, VueRoot};

use crate::contract::{OakFrontendDiagnostic, TemplateShellInput};
use crate::oak_cst::{format_cst_diagnostics, map_oak_error, TEMPLATE_CLOSE, TEMPLATE_OPEN};

/// Result of building Oak Vue AST for a VMZ template region.
#[derive(Debug, Clone)]
pub struct TemplateAstParse {
    /// Shell text (`<template>…</template>`) passed to Oak.
    pub shell_source: String,
    /// Byte offset in `.vmz` where shell byte `0` maps.
    pub shell_base_offset: usize,
    /// Built AST when Oak reported no errors.
    pub root: Option<VueRoot>,
    /// Oak diagnostics remapped to `.vmz` when possible.
    pub diagnostics: Vec<OakFrontendDiagnostic>,
    /// `true` when AST build succeeded.
    pub ok: bool,
}

/// Parse + build Oak Vue AST for a VMZ template body.
pub fn parse_template_ast(template: &TemplateShellInput) -> TemplateAstParse {
    let shell_source = format!("{}{}{}", TEMPLATE_OPEN, template.content, TEMPLATE_CLOSE);
    let shell_base_offset = template.content_start.saturating_sub(TEMPLATE_OPEN.len());

    let source = SourceText::new(shell_source.as_str());
    let builder = VueBuilder::new();
    let mut cache = ParseSession::default();
    let built = Builder::build(&builder, &source, &[], &mut cache);

    let mut diagnostics = Vec::new();
    if let Err(err) = &built.result {
        diagnostics.push(map_oak_error(err, shell_base_offset));
    }
    for err in &built.diagnostics {
        diagnostics.push(map_oak_error(err, shell_base_offset));
    }

    let ok = built.result.is_ok() && diagnostics.is_empty();
    let root = built.result.ok();

    TemplateAstParse {
        shell_source,
        shell_base_offset,
        root,
        diagnostics,
        ok,
    }
}

/// Fail fast when Oak AST build fails.
pub fn require_template_ast(template: &TemplateShellInput) -> Result<VueRoot, String> {
    let parse = parse_template_ast(template);
    if let Some(root) = parse.root.filter(|_| parse.ok) {
        return Ok(root);
    }
    Err(format_cst_diagnostics(&parse.diagnostics))
}
