//! Shared template expression snippet ingress through `data.text` TypeScript.

use vmz_text_frontend_adapter::parse_expression_snippet;

/// Inclusive-start / exclusive-end UTF-8 byte range inside the trimmed snippet.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SnippetSpan {
    /// Inclusive UTF-8 byte offset start.
    pub start: u32,
    /// Exclusive UTF-8 byte offset end.
    pub end: u32,
}

impl SnippetSpan {
    /// Byte length of this range.
    pub fn len(self) -> u32 {
        self.end.saturating_sub(self.start)
    }
}

/// Keep the historical helper name for callers that need a parser shell.
pub fn wrap_template_expr_source(expr: &str) -> String {
    format!("({})", expr.trim())
}

/// First human error when `expr` is not a valid TypeScript expression snippet.
pub fn template_expr_snippet_error(expr: &str) -> Option<String> {
    template_expr_snippet_error_with_span(expr).map(|(message, _)| message)
}

/// First `data.text` parse error plus its snippet-local span.
pub fn template_expr_snippet_error_with_span(expr: &str) -> Option<(String, SnippetSpan)> {
    let trimmed = expr.trim();
    if trimmed.is_empty() {
        return None;
    }
    let parsed = parse_expression_snippet(trimmed);
    if parsed.ok {
        return None;
    }
    let diagnostic = parsed.diagnostics.first();
    let message = diagnostic
        .map(|diagnostic| diagnostic.render_plain())
        .unwrap_or_else(|| "`data.text` TypeScript expression parse failed".to_string());
    let span = diagnostic
        .and_then(|diagnostic| diagnostic.span)
        .map(|span| SnippetSpan { start: span.start as u32, end: span.end as u32 })
        .unwrap_or(SnippetSpan { start: 0, end: trimmed.len() as u32 });
    Some((message, span))
}

/// Whether the template expression snippet is accepted by `data.text`.
pub fn template_expr_snippet_ok(expr: &str) -> bool {
    template_expr_snippet_error(expr).is_none()
}

/// Root expression span inside the trimmed snippet when `data.text` accepts it.
pub fn template_expr_root_span(expr: &str) -> Option<SnippetSpan> {
    let trimmed = expr.trim();
    if trimmed.is_empty() {
        return None;
    }
    let parsed = parse_expression_snippet(trimmed);
    parsed.root_span.map(|span| SnippetSpan { start: span.start as u32, end: span.end as u32 })
}

/// Canonical-print a template expression through the `data.text` expression printer.
pub fn print_template_expr(expr: &str) -> Result<String, String> {
    let trimmed = expr.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    if let Some(output) = super::expr_print::print_template_expr_via_text(trimmed) {
        return Ok(output);
    }
    Err(template_expr_snippet_error(trimmed)
        .unwrap_or_else(|| "`data.text` TypeScript expression shape is unsupported".to_string()))
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
    fn text_accepts_member_with_local_span() {
        let text = parse_expression_snippet("tag.label");
        assert!(text.ok, "text diags={:?}", text.diagnostics);
        assert_eq!(template_expr_root_span("tag.label"), Some(SnippetSpan { start: 0, end: 9 }));
    }

    #[test]
    fn root_span_covers_trimmed_member_expr() {
        let span = template_expr_root_span("  user.name  ").expect("span");
        assert_eq!(span, SnippetSpan { start: 0, end: 9 });
    }

    #[test]
    fn broken_expr_error_span_is_local() {
        let (message, span) = template_expr_snippet_error_with_span("1 +").expect("error");
        assert!(!message.is_empty());
        assert!(span.start < span.end);
        assert!((span.end as usize) <= "1 +".len());
    }

    #[test]
    fn print_template_expr_is_idempotent_canonical() {
        let once = print_template_expr("a+b").expect("print");
        let twice = print_template_expr(&once).expect("reprint");
        assert_eq!(once, twice);
        assert!(!once.is_empty());
    }
}
