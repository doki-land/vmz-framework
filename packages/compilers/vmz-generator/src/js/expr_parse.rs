//! Shared oxc parse for template expression snippets.
//!
//! Template IR still stores expression **text**; this module is the single ingress
//! that wraps `(expr)` and parses with oxc. Emit/`bind_field_idents` may still
//! re-parse for rewrite — callers should prefer these helpers over ad-hoc
//! `Parser::new` copies.
//!
//! Spans returned here are **snippet-local UTF-8 byte offsets** relative to the
//! trimmed expression text (not the wrapped `(…)` source, and not file offsets).
//! Full `ExprPlan` retention is a `0.1.19` concern.

use oxc_allocator::Allocator;
use oxc_ast::ast::Statement;
use oxc_parser::Parser;
use oxc_span::{GetSpan, SourceType, Span};

/// Inclusive-start / exclusive-end UTF-8 byte range inside the trimmed snippet.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SnippetSpan {
    /// Inclusive UTF-8 byte offset start (relative to trimmed expression text).
    pub start: u32,
    /// Exclusive UTF-8 byte offset end (relative to trimmed expression text).
    pub end: u32,
}

impl SnippetSpan {
    /// Byte length of this range.
    pub fn len(self) -> u32 {
        self.end.saturating_sub(self.start)
    }
}

/// Wrap a trimmed template expression for oxc as a parenthesized expression stmt.
pub fn wrap_template_expr_source(expr: &str) -> String {
    format!("({})", expr.trim())
}

/// Leading `(` inserted by [`wrap_template_expr_source`].
const WRAP_OPEN_LEN: u32 = 1;

/// Map an oxc span in the wrapped `(expr)` source into trimmed-snippet offsets.
pub fn map_wrapped_span_to_snippet(span: Span, snippet_len: u32) -> SnippetSpan {
    let start = span.start.saturating_sub(WRAP_OPEN_LEN).min(snippet_len);
    let end = span.end.saturating_sub(WRAP_OPEN_LEN).min(snippet_len).max(start);
    SnippetSpan { start, end }
}

/// First human oxc error when `expr` is not a valid TS expression snippet.
///
/// Empty / whitespace-only expressions are treated as ok (no expression present).
pub fn template_expr_snippet_error(expr: &str) -> Option<String> {
    template_expr_snippet_error_with_span(expr).map(|(msg, _)| msg)
}

/// First oxc error plus its snippet-local span (mapped out of the `(…)` wrap).
pub fn template_expr_snippet_error_with_span(expr: &str) -> Option<(String, SnippetSpan)> {
    let trimmed = expr.trim();
    if trimmed.is_empty() {
        return None;
    }
    let snippet_len = trimmed.len() as u32;
    let src = wrap_template_expr_source(trimmed);
    let allocator = Allocator::default();
    let ret = Parser::new(&allocator, &src, SourceType::ts()).parse();
    if ret.panicked {
        return Some((
            "oxc panicked while parsing template expression".into(),
            SnippetSpan { start: 0, end: snippet_len },
        ));
    }
    let diag = ret.diagnostics.first()?;
    let msg = diag.message.to_string();
    let span = diag
        .labels
        .first()
        .map(|label| {
            let start = label.offset() as u32;
            let end = start.saturating_add(label.len() as u32);
            map_wrapped_span_to_snippet(Span::new(start, end), snippet_len)
        })
        .unwrap_or(SnippetSpan { start: 0, end: snippet_len });
    Some((msg, span))
}

/// Whether oxc accepts the template expression snippet.
pub fn template_expr_snippet_ok(expr: &str) -> bool {
    template_expr_snippet_error(expr).is_none()
}

/// Root expression span inside the trimmed snippet when oxc accepts the parse.
pub fn template_expr_root_span(expr: &str) -> Option<SnippetSpan> {
    let trimmed = expr.trim();
    if trimmed.is_empty() {
        return None;
    }
    let snippet_len = trimmed.len() as u32;
    let src = wrap_template_expr_source(trimmed);
    let allocator = Allocator::default();
    let ret = Parser::new(&allocator, &src, SourceType::ts()).parse();
    if ret.panicked || !ret.diagnostics.is_empty() {
        return None;
    }
    let body = ret.program.body.first()?;
    let Statement::ExpressionStatement(es) = body else {
        return None;
    };
    Some(map_wrapped_span_to_snippet(es.expression.span(), snippet_len))
}

/// Canonical-print a template expression via oxc parse + codegen (no string replay).
///
/// Empty / whitespace-only input yields an empty string. Invalid expressions return `Err`.
pub fn print_template_expr(expr: &str) -> Result<String, String> {
    use oxc_ast::ast::Expression;
    use oxc_codegen::Codegen;

    let trimmed = expr.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    let src = wrap_template_expr_source(trimmed);
    let allocator = Allocator::default();
    let ret = Parser::new(&allocator, &src, SourceType::ts()).parse();
    if ret.panicked {
        return Err("oxc panicked while printing template expression".into());
    }
    if let Some(diag) = ret.diagnostics.first() {
        return Err(diag.message.to_string());
    }
    let body = ret.program.body.first().ok_or_else(|| "empty template expression".to_string())?;
    let Statement::ExpressionStatement(es) = body else {
        return Err("expected expression statement from template wrap".into());
    };
    let inner = match &es.expression {
        Expression::ParenthesizedExpression(p) => &p.expression,
        other => other,
    };
    let mut codegen = Codegen::new();
    codegen.print_expression(inner);
    Ok(codegen.into_source_text().trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_field_path() {
        assert!(template_expr_snippet_ok("user.name"));
        assert!(template_expr_snippet_ok("a ? b : c"));
    }

    #[test]
    fn rejects_broken_expr() {
        assert!(template_expr_snippet_error("1 +").is_some());
        assert!(template_expr_snippet_error(";;;").is_some());
    }

    #[test]
    fn root_span_covers_trimmed_member_expr() {
        let span = template_expr_root_span("  user.name  ").expect("span");
        assert_eq!(span, SnippetSpan { start: 0, end: 9 });
        assert_eq!(&"user.name"[span.start as usize..span.end as usize], "user.name");
    }

    #[test]
    fn broken_expr_error_span_maps_into_snippet() {
        let (msg, span) = template_expr_snippet_error_with_span("1 +").expect("error");
        assert!(!msg.is_empty());
        let snippet = "1 +";
        assert!(span.start < span.end);
        assert!((span.end as usize) <= snippet.len());
        let _ = &snippet[span.start as usize..span.end as usize];
    }

    #[test]
    fn map_wrapped_span_strips_open_paren() {
        // In "(user)", identifier `user` is oxc [1,5) → snippet [0,4).
        assert_eq!(
            map_wrapped_span_to_snippet(Span::new(1, 5), 4),
            SnippetSpan { start: 0, end: 4 }
        );
    }

    #[test]
    fn print_template_expr_is_idempotent_canonical() {
        let once = print_template_expr("a+b").expect("print");
        let twice = print_template_expr(&once).expect("reprint");
        assert_eq!(once, twice);
        assert!(!once.is_empty());
    }
}
