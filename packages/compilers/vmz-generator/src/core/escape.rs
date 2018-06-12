//! Unified HTML / XML / CSS string escapes (single implementation for all printers).

/// Escape text content for HTML (`&`, `<`, `>`).
pub fn escape_html_text(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            _ => out.push(c),
        }
    }
    out
}

/// Escape an HTML attribute value (double-quoted).
pub fn escape_html_attr(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(c),
        }
    }
    out
}

/// Escape XML/HTML-ish attribute (Mini template dialect).
pub fn escape_xml_attr(s: &str) -> String {
    escape_html_attr(s)
}

/// Escape XML text content.
pub fn escape_xml_text(s: &str) -> String {
    escape_html_text(s)
}

/// Escape a CSS string literal (double-quoted).
pub fn escape_css_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\A "),
            '\r' => out.push_str("\\D "),
            _ => out.push(c),
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn html_escapes_script_breaker() {
        assert_eq!(escape_html_text("</script>"), "&lt;/script&gt;");
        assert_eq!(escape_html_attr("a\"b"), "a&quot;b");
    }
}
