//! Shared oxc parse for template expression snippets.
//!
//! Template IR still stores expression **text**; this module is the single ingress
//! that wraps `(expr)` and parses with oxc. Emit/`bind_field_idents` may still
//! re-parse for rewrite — callers should prefer these helpers over ad-hoc
//! `Parser::new` copies.

use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_span::SourceType;

/// Wrap a trimmed template expression for oxc as a parenthesized expression stmt.
pub fn wrap_template_expr_source(expr: &str) -> String {
    format!("({})", expr.trim())
}

/// First human oxc error when `expr` is not a valid TS expression snippet.
///
/// Empty / whitespace-only expressions are treated as ok (no expression present).
pub fn template_expr_snippet_error(expr: &str) -> Option<String> {
    let trimmed = expr.trim();
    if trimmed.is_empty() {
        return None;
    }
    let src = wrap_template_expr_source(trimmed);
    let allocator = Allocator::default();
    let ret = Parser::new(&allocator, &src, SourceType::ts()).parse();
    if ret.panicked {
        return Some("oxc panicked while parsing template expression".into());
    }
    if !ret.diagnostics.is_empty() {
        return Some(ret.diagnostics[0].message.to_string());
    }
    None
}

/// Whether oxc accepts the template expression snippet.
pub fn template_expr_snippet_ok(expr: &str) -> bool {
    template_expr_snippet_error(expr).is_none()
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
}
