//! `data.text` TypeScript AST build entry for VMZ `<script client|server>` blocks.

use data_text_core::{Builder, ParseSession, SourceText};
use data_text_typescript::ast::Statement;
use data_text_typescript::{TypeScriptBuilder, TypeScriptLanguage, TypeScriptRoot};

use crate::contract::{FrontendDiagnostic, ScriptShellInput};
use crate::template_cst::{map_text_error, non_empty};

/// Result of building `data.text` TypeScript AST for a VMZ script region.
#[derive(Debug, Clone)]
pub struct ScriptAstParse {
    /// Built AST when `data.text` reported no errors.
    pub root: Option<TypeScriptRoot>,
    /// Default-exported class name when present.
    pub default_export_class: Option<String>,
    /// `data.text` diagnostics remapped to `.vmz` when possible.
    pub diagnostics: Vec<FrontendDiagnostic>,
    /// `true` when AST build succeeded.
    pub ok: bool,
}

/// VMZ script blocks are plain TypeScript, and VMZ forbids JSX.
///
/// With JSX enabled, `<T extends object>() => …` is read as a JSX element and
/// the parser stalls on the attributes, so generic arrows never build.
fn script_language() -> TypeScriptLanguage {
    TypeScriptLanguage { jsx: false, ..TypeScriptLanguage::standard() }
}

/// Parse + build `data.text` TypeScript AST for a VMZ script body.
pub fn parse_script_ast(script: &ScriptShellInput) -> ScriptAstParse {
    let source = SourceText::new(script.content.as_str());
    let language = script_language();
    let builder = TypeScriptBuilder::new(&language);
    let mut cache = ParseSession::default();
    let built = Builder::build(&builder, &source, &[], &mut cache);

    let mut diagnostics = Vec::new();
    if let Err(err) = &built.result {
        diagnostics.push(map_text_error(err, script.content_start));
    }
    for err in &built.diagnostics {
        diagnostics.push(map_text_error(err, script.content_start));
    }

    let ok = built.result.is_ok() && diagnostics.is_empty();
    let root = built.result.ok();
    let default_export_class = root.as_ref().and_then(default_export_class_name);

    ScriptAstParse { root, default_export_class, diagnostics, ok }
}

/// Fail fast when `data.text` script AST build fails.
pub fn require_script_ast(
    script: &ScriptShellInput,
) -> Result<TypeScriptRoot, Vec<FrontendDiagnostic>> {
    let parse = parse_script_ast(script);
    if let Some(root) = parse.root.filter(|_| parse.ok) {
        return Ok(root);
    }
    Err(non_empty(parse.diagnostics, "vmz::script::parse_failed"))
}

fn default_export_class_name(root: &TypeScriptRoot) -> Option<String> {
    for stmt in &root.statements {
        let Statement::ExportDeclaration(exp) = stmt else {
            continue;
        };
        if !exp.is_default() {
            continue;
        }
        let Some(decl) = exp.declaration.as_ref() else {
            continue;
        };
        if let Statement::ClassDeclaration(class) = decl.as_ref() {
            if class.name.is_empty() {
                return Some("Default".to_string());
            }
            return Some(class.name.clone());
        }
    }
    None
}
