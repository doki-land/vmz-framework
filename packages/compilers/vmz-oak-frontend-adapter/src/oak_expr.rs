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

    if is_vue_contextual_identifier(trimmed) {
        return ExpressionSnippetParse {
            expression: Some(Expression::new(
                oak_typescript::ast::ExpressionKind::Identifier(trimmed.to_string()),
                (0..trimmed.len()).into(),
            )),
            root_span: Some(ByteSpan { start: 0, end: trimmed.len() }),
            diagnostics: Vec::new(),
            ok: true,
        };
    }

    if let Some(inner) = strip_outer_parens(trimmed) {
        let reparsed = parse_expression_snippet(inner);
        if reparsed.ok {
            return reparsed;
        }
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
    if expression.is_none() {
        let wrappers = if trimmed.contains("=>") {
            vec![format!("const __vmz_expr = {trimmed};")]
        } else if trimmed.starts_with("({") && trimmed.ends_with("})") {
            vec![format!("const __vmz_expr = {} ;", &trimmed[1..trimmed.len() - 1])]
        } else {
            vec![format!("const __vmz_expr = ({trimmed});")]
        };
        for wrapped in wrappers {
            let wrapped_source = SourceText::new(wrapped.as_str());
            let wrapped_built = Builder::build(&builder, &wrapped_source, &[], &mut cache);
            if let Ok(root) = &wrapped_built.result {
                if let Some(value) = root.statements.iter().find_map(|stmt| match stmt {
                    Statement::VariableDeclaration(decl) if decl.name == "__vmz_expr" => decl.value.clone(),
                    _ => None,
                }) {
                    return ExpressionSnippetParse {
                        expression: Some(value),
                        root_span: Some(ByteSpan { start: 0, end: trimmed.len() }),
                        diagnostics: Vec::new(),
                        ok: true,
                    };
                }
            }
        }
    }
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

fn is_vue_contextual_identifier(value: &str) -> bool {
    matches!(value, "type" | "readonly" | "default" | "static" | "get" | "set")
}

fn strip_outer_parens(value: &str) -> Option<&str> {
    if !value.starts_with('(') || !value.ends_with(')') {
        return None;
    }
    let mut depth = 0usize;
    for (index, ch) in value.char_indices() {
        match ch {
            '(' => depth += 1,
            ')' => {
                depth = depth.checked_sub(1)?;
                if depth == 0 && index + ch.len_utf8() != value.len() {
                    return None;
                }
            }
            _ => {}
        }
    }
    (depth == 0).then(|| &value[1..value.len() - 1])
}

/// Fail fast when Oak rejects a template expression snippet.
pub fn require_expression_snippet(expr: &str) -> Result<ByteSpan, String> {
    let parse = parse_expression_snippet(expr);
    if parse.ok {
        return Ok(parse.root_span.unwrap_or(ByteSpan::empty_at(0)));
    }
    Err(crate::oak_cst::format_cst_diagnostics(&parse.diagnostics))
}
