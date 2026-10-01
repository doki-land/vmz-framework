//! Oak TypeScript parse for VMZ template expression snippets.

use oak_core::{Builder, ParseSession, SourceText};
use oak_typescript::ast::{Expression, Statement};
use oak_typescript::{TypeScriptBuilder, TypeScriptLanguage};

use crate::contract::{ByteSpan, OakFrontendDiagnostic};
use crate::oak_cst::map_oak_error;

/// Result of parsing a trimmed template expression via Oak TypeScript AST.
#[derive(Debug, Clone)]
pub struct ExpressionSnippetParse {
    /// Root expression when lowered (snippet-local spans).
    pub expression: Option<Expression>,
    /// Root expression span in the trimmed snippet when lowered.
    pub root_span: Option<ByteSpan>,
    /// Oak diagnostics (snippet-local offsets).
    pub diagnostics: Vec<OakFrontendDiagnostic>,
    /// `true` when Oak built exactly one expression statement with no errors.
    pub ok: bool,
}

/// Parse a template expression snippet with Oak TypeScript (no `(…)` wrap).
///
/// Empty / whitespace-only input is `ok` with no span. Non-empty input that does
/// not lower to an [`Statement::ExpressionStatement`] is treated as failure even
/// when Oak reports no diagnostics (incomplete binary ops currently silent).
pub fn parse_expression_snippet(expr: &str) -> ExpressionSnippetParse {
    let trimmed = expr.trim();
    if trimmed.is_empty() {
        return ExpressionSnippetParse {
            expression: None,
            root_span: None,
            diagnostics: Vec::new(),
            ok: true,
        };
    }

    let source = SourceText::new(trimmed);
    let language = TypeScriptLanguage::default();
    let builder = TypeScriptBuilder::new(&language);
    let mut cache = ParseSession::default();
    let built = Builder::build(&builder, &source, &[], &mut cache);

    let mut diagnostics = Vec::new();
    if let Err(err) = &built.result {
        diagnostics.push(map_oak_error(err, 0));
    }
    for err in &built.diagnostics {
        diagnostics.push(map_oak_error(err, 0));
    }

    let expression = built.result.as_ref().ok().and_then(|root| {
        root.statements.iter().find_map(|stmt| match stmt {
            Statement::ExpressionStatement(es) => Some(es.expression.clone()),
            _ => None,
        })
    });
    let expr_span = expression.as_ref().map(|e| ByteSpan { start: e.span.start, end: e.span.end });

    if expression.is_none() && diagnostics.is_empty() {
        diagnostics.push(OakFrontendDiagnostic {
            message: "Oak TypeScript did not lower expression snippet".into(),
            span: Some(ByteSpan { start: 0, end: trimmed.len() }),
        });
    }

    let ok = diagnostics.is_empty() && expression.is_some();
    ExpressionSnippetParse { expression, root_span: expr_span, diagnostics, ok }
}

/// Fail fast when Oak rejects a template expression snippet.
pub fn require_expression_snippet(expr: &str) -> Result<ByteSpan, String> {
    let parse = parse_expression_snippet(expr);
    if parse.ok {
        return Ok(parse.root_span.unwrap_or(ByteSpan::empty_at(0)));
    }
    Err(crate::oak_cst::format_cst_diagnostics(&parse.diagnostics))
}
