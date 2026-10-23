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

    let source = SourceText::new(trimmed);
    // VMZ template expressions are plain TypeScript and VMZ forbids JSX, so a
    // leading `<` must read as a generic arrow or a type parameter list.
    let language = TypeScriptLanguage { jsx: false, ..TypeScriptLanguage::standard() };
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
        // Reject multi-statement snippets — a template expression must lower to exactly
        // one expression; anything after the first is illegal trailing input.
        if root.statements.len() > 1 {
            diagnostics.push(
                OakFrontendDiagnostic::new("vmz::expression::multiple_statements")
                    .with_arg("count", root.statements.len().to_string())
                    .with_span(ByteSpan { start: 0, end: trimmed.len() }),
            );
            return None;
        }
        root.statements.iter().find_map(|stmt| match stmt {
            Statement::ExpressionStatement(es) => Some(es.expression.clone()),
            _ => None,
        })
    });
    if expression.is_none() {
        let wrappers = wrapper_variants(trimmed);
        for (wrapped, prefix_len) in &wrappers {
            let wrapped_source = SourceText::new(wrapped.as_str());
            let wrapped_built = Builder::build(&builder, &wrapped_source, &[], &mut cache);

            // Preserve any diagnostics Oak emitted inside the wrapper (warnings about
            // shadowing, unused vars, etc. — the old code dropped them).
            let mut wrapper_diags = Vec::new();
            if let Err(err) = &wrapped_built.result {
                wrapper_diags.push(map_oak_error_with_prefix_offset(err, *prefix_len));
            }
            for err in &wrapped_built.diagnostics {
                wrapper_diags.push(map_oak_error_with_prefix_offset(err, *prefix_len));
            }

            if let Ok(root) = &wrapped_built.result {
                // Same multi-statement guard inside the wrapper — we expect exactly
                // the `const __vmz_expr = ...;` declaration, no trailing junk.
                if root.statements.len() != 1 {
                    continue;
                }
                if let Some(value) = root.statements.iter().find_map(|stmt| match stmt {
                    Statement::VariableDeclaration(decl) if decl.name == "__vmz_expr" => {
                        decl.value.clone()
                    }
                    _ => None,
                }) {
                    // `root_span` is intentionally snippet-local (0..trimmed.len()):
                    // the expression we extracted occupies exactly the trimmed input.
                    let ok = wrapper_diags.is_empty();
                    return ExpressionSnippetParse {
                        expression: Some(value),
                        root_span: Some(ByteSpan { start: 0, end: trimmed.len() }),
                        diagnostics: wrapper_diags,
                        ok,
                    };
                }
            }
        }
    }
    let expr_span = expression.as_ref().map(|e| ByteSpan { start: e.span.start, end: e.span.end });

    if expression.is_none() && diagnostics.is_empty() {
        diagnostics.push(
            OakFrontendDiagnostic::new("vmz::expression::not_lowered")
                .with_span(ByteSpan { start: 0, end: trimmed.len() }),
        );
    }

    let ok = diagnostics.is_empty() && expression.is_some();
    ExpressionSnippetParse { expression, root_span: expr_span, diagnostics, ok }
}

fn is_vue_contextual_identifier(value: &str) -> bool {
    matches!(value, "type" | "readonly" | "default" | "static" | "get" | "set")
}

/// Build wrapper strings and their `const __vmz_expr = …` prefix offsets.
///
/// The prefix length is added to every diagnostic that Oak emits inside the
/// wrapper, so that offsets map back to snippet-local coordinates.
fn wrapper_variants(trimmed: &str) -> Vec<(String, usize)> {
    const PREFIX: &str = "const __vmz_expr = ";
    if trimmed.contains("=>") {
        vec![(format!("{PREFIX}{trimmed};"), PREFIX.len())]
    } else if trimmed.starts_with("({") && trimmed.ends_with("})") {
        let inner = &trimmed[1..trimmed.len() - 1];
        vec![(format!("{PREFIX}{inner} ;"), PREFIX.len())]
    } else {
        vec![(format!("{PREFIX}({trimmed});"), PREFIX.len() + 1)] // +1 for '('
    }
}

/// Offset an Oak error's diagnostic span back from wrapper-relative
/// coordinates to snippet-local coordinates by subtracting `prefix_len`.
///
/// Preserves the original span's width — only the start is shifted, because
/// the wrapper prefix is always a leading byte slice that does not appear in
/// the user's trimmed snippet.
fn map_oak_error_with_prefix_offset(
    err: &oak_core::OakError,
    prefix_len: usize,
) -> OakFrontendDiagnostic {
    let mut diagnostic = crate::oak_cst::describe(err);
    if let Some(span) = diagnostic.span.take() {
        let start = span.start.saturating_sub(prefix_len);
        let end = span.end.saturating_sub(prefix_len);
        diagnostic.span = Some(ByteSpan { start, end });
    }
    diagnostic
}

/// Fail fast when Oak rejects a template expression snippet.
pub fn require_expression_snippet(expr: &str) -> Result<ByteSpan, Vec<OakFrontendDiagnostic>> {
    let parse = parse_expression_snippet(expr);
    if parse.ok {
        return Ok(parse.root_span.unwrap_or(ByteSpan::empty_at(0)));
    }
    Err(crate::oak_cst::non_empty(parse.diagnostics, "vmz::expression::parse_failed"))
}
