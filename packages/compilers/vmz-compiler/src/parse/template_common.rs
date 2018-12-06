//! Shared template parse error + HTML entity decode (no AST).

use std::fmt;

/// Parse failure for Vue template syntax.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TemplateParseError {
    /// Human-readable diagnostic.
    pub message: String,
    /// Byte offset into the template body.
    pub offset: usize,
}

impl fmt::Display for TemplateParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // Position is carried as UTF-8 byte offset on this type / protocol
        // `SourceSpan` — not embedded in the message string.
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for TemplateParseError {}

/// Decode HTML character references in template text / static attrs.
pub fn decode_html_entities(input: &str) -> String {
    if !input.contains('&') {
        return input.to_string();
    }
    let mut out = String::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'&' {
            let ch = input[i..].chars().next().unwrap();
            out.push(ch);
            i += ch.len_utf8();
            continue;
        }
        let rest = &input[i..];
        if let Some((ch, consumed)) = match_entity(rest) {
            out.push(ch);
            i += consumed;
        } else {
            out.push('&');
            i += 1;
        }
    }
    out
}

fn match_entity(s: &str) -> Option<(char, usize)> {
    if s.starts_with("&amp;") {
        return Some(('&', 5));
    }
    if s.starts_with("&lt;") {
        return Some(('<', 4));
    }
    if s.starts_with("&gt;") {
        return Some(('>', 4));
    }
    if s.starts_with("&quot;") {
        return Some(('"', 6));
    }
    if s.starts_with("&apos;") {
        return Some(('\'', 6));
    }
    if s.starts_with("&nbsp;") {
        return Some(('\u{00A0}', 6));
    }
    if let Some(rest) = s.strip_prefix("&#") {
        let hex = rest.as_bytes().first().is_some_and(|b| *b == b'x' || *b == b'X');
        let digits = if hex { &rest[1..] } else { rest };
        let end = digits.find(';')?;
        let num_str = &digits[..end];
        if num_str.is_empty() {
            return None;
        }
        let code = if hex {
            u32::from_str_radix(num_str, 16).ok()?
        } else {
            num_str.parse::<u32>().ok()?
        };
        let ch = char::from_u32(code)?;
        let consumed = 2 + if hex { 1 } else { 0 } + end + 1;
        return Some((ch, consumed));
    }
    None
}
