//! Shared template expression snippet ingress (Oak TypeScript primary).
//!
//! Template IR still stores expression **text**; this module is the single ingress
//! that validates / spans snippets. Oak is preferred; oxc remains a temporary
//! fallback when Oak does not lower a valid expression (keeps production unblock).
//! Emit/`bind_field_idents` may still re-parse for rewrite — callers should prefer
//! these helpers over ad-hoc parser copies.
//!
//! Spans returned here are **snippet-local UTF-8 byte offsets** relative to the
//! trimmed expression text (not file offsets).

use oxc_allocator::Allocator;
use oxc_ast::ast::Statement;
use oxc_parser::Parser;
use oxc_span::{GetSpan, SourceType, Span};
use vmz_oak_frontend_adapter::parse_expression_snippet;

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

/// First human error when `expr` is not a valid TS expression snippet.
///
/// Empty / whitespace-only expressions are treated as ok (no expression present).
pub fn template_expr_snippet_error(expr: &str) -> Option<String> {
    template_expr_snippet_error_with_span(expr).map(|(msg, _)| msg)
}

/// First parse error plus its snippet-local span.
///
/// Oak is tried first. When Oak fails, oxc decides: oxc accept ⇒ treat as ok
/// (Oak gap); oxc reject ⇒ surface oxc (or Oak) diagnostics.
pub fn template_expr_snippet_error_with_span(expr: &str) -> Option<(String, SnippetSpan)> {
    let trimmed = expr.trim();
    if trimmed.is_empty() {
        return None;
    }
    let oak = parse_expression_snippet(trimmed);
    if oak.ok {
        return None;
    }
    if let Some(err) = oxc_template_expr_snippet_error_with_span(trimmed) {
        return Some(err);
    }
    // Oak failed to lower but oxc accepts — transitional Oak gap, not a user error.
    None
}

/// Whether the template expression snippet is accepted (Oak primary, oxc fallback).
pub fn template_expr_snippet_ok(expr: &str) -> bool {
    template_expr_snippet_error(expr).is_none()
}

/// Root expression span inside the trimmed snippet when parse accepts.
pub fn template_expr_root_span(expr: &str) -> Option<SnippetSpan> {
    let trimmed = expr.trim();
    if trimmed.is_empty() {
        return None;
    }
    let oak = parse_expression_snippet(trimmed);
    if oak.ok {
        return oak.root_span.map(|s| SnippetSpan { start: s.start as u32, end: s.end as u32 });
    }
    oxc_template_expr_root_span(trimmed)
}

/// Canonical-print a template expression (Oak AST primary, oxc codegen fallback).
///
/// Empty / whitespace-only input yields an empty string. Invalid expressions return `Err`.
pub fn print_template_expr(expr: &str) -> Result<String, String> {
    use oxc_ast::ast::Expression;
    use oxc_codegen::Codegen;

    let trimmed = expr.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    if let Some(out) = super::oak_expr_print::print_template_expr_via_oak(trimmed) {
        return Ok(out);
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

fn oxc_template_expr_snippet_error_with_span(trimmed: &str) -> Option<(String, SnippetSpan)> {
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

fn oxc_template_expr_root_span(trimmed: &str) -> Option<SnippetSpan> {
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
    fn oak_primary_accepts_member_without_oxc_wrap() {
        let oak = parse_expression_snippet("tag.label");
        assert!(oak.ok, "oak diags={:?}", oak.diagnostics);
        let span = oak.root_span.expect("span");
        assert_eq!(span, vmz_oak_frontend_adapter::ByteSpan { start: 0, end: 9 });
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
