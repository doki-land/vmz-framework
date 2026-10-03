//! Style layer composition (`@import` entry) + CSS validate/format.

use std::fs;
use std::path::{Path, PathBuf};

use crate::core::{GeneratorError, Result};

/// Stable emit order (lower first).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[repr(u8)]
pub enum StyleLayer {
    /// `/designs` tokens + themes -> CSS custom properties.
    Designs = 0,
    /// `designs/styles` + SFC `<style>` (SCSS/CSS).
    Scss = 1,
    /// TW utilities from `style:tw` / `@tailwind`.
    Tw = 2,
}

/// One CSS body contributed by a style layer for [`emit_style_bundle`].
#[derive(Debug, Clone)]
pub struct StyleContribution {
    /// Layer that owns this contribution (controls sort order).
    pub layer: StyleLayer,
    /// File name written under `out_dir` (e.g. `vmz-tw.css`).
    pub asset_name: String,
    /// CSS body to write (skipped when empty/whitespace).
    pub css: String,
}

/// Disk layout produced by [`emit_style_bundle`].
#[derive(Debug, Default)]
pub struct StyleEmitReport {
    /// Relative entry name (`vmz.css`) when at least one layer wrote CSS.
    pub css_entry: Option<String>,
    /// Absolute paths of assets written this call (layers + entry).
    pub written: Vec<PathBuf>,
}

/// Validate CSS with the VMZ CSS lexer.
///
/// Not used as a hard gate on StyleEmitter write (TW/`@tailwind` and SCSS
/// intermediates may not be pure CSS yet). Call from checks / tests.
pub fn validate_css(css: &str) -> Result<()> {
    scan_css(css, ScanMode::Validate).map(|_| ())
}

/// Canonical CSS print through the VMZ CSS lexer and stable brace layout.
pub fn format_css(css: &str) -> String {
    let trimmed = css.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let mut body = format_css_body(trimmed);
    if !body.ends_with('\n') {
        body.push('\n');
    }
    body
}

/// Production CSS print: validate, then drop comments and collapse whitespace.
pub fn minify_css(css: &str) -> String {
    let trimmed = css.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let _ = validate_css(trimmed);
    compact_css(trimmed)
}

#[derive(Clone, Copy)]
enum ScanMode {
    Validate,
}

fn scan_css(source: &str, _mode: ScanMode) -> Result<String> {
    let mut braces = 0usize;
    let mut parens = 0usize;
    let mut brackets = 0usize;
    let mut quote = None;
    let mut escaped = false;
    let mut block_comment = false;
    let mut index = 0usize;
    let chars: Vec<char> = source.replace("\r\n", "\n").replace('\r', "\n").chars().collect();
    while index < chars.len() {
        let ch = chars[index];
        let next = chars.get(index + 1).copied();
        if block_comment {
            if ch == '*' && next == Some('/') {
                block_comment = false;
                index += 2;
                continue;
            }
            index += 1;
            continue;
        }
        if let Some(active) = quote {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == active {
                quote = None;
            }
            index += 1;
            continue;
        }
        if ch == '/' && next == Some('*') {
            block_comment = true;
            index += 2;
            continue;
        }
        if ch == '\'' || ch == '"' {
            quote = Some(ch);
            index += 1;
            continue;
        }
        match ch {
            '{' => braces += 1,
            '}' if braces > 0 => braces -= 1,
            '}' => return Err(GeneratorError::msg("css parse: unmatched closing brace")),
            '(' => parens += 1,
            ')' if parens > 0 => parens -= 1,
            ')' => return Err(GeneratorError::msg("css parse: unmatched closing parenthesis")),
            '[' => brackets += 1,
            ']' if brackets > 0 => brackets -= 1,
            ']' => return Err(GeneratorError::msg("css parse: unmatched closing bracket")),
            _ => {}
        }
        index += 1;
    }
    if quote.is_some() {
        return Err(GeneratorError::msg("css parse: unterminated string"));
    }
    if block_comment {
        return Err(GeneratorError::msg("css parse: unterminated comment"));
    }
    if braces != 0 || parens != 0 || brackets != 0 {
        return Err(GeneratorError::msg("css parse: unclosed delimiter"));
    }
    Ok(source.to_string())
}

fn format_css_body(source: &str) -> String {
    let nl = "\n";
    let unit = "  ";
    let mut output = String::new();
    let mut current = String::new();
    let mut depth = 0usize;
    let mut quote = None;
    let mut escaped = false;
    let mut block_comment = false;
    let mut line_comment = false;
    let chars: Vec<char> = source.replace("\r\n", "\n").replace('\r', "\n").chars().collect();
    let mut index = 0usize;
    while index < chars.len() {
        let ch = chars[index];
        let next = chars.get(index + 1).copied();
        if block_comment {
            current.push(ch);
            if ch == '*' && next == Some('/') {
                current.push('/');
                index += 2;
                block_comment = false;
                continue;
            }
            index += 1;
            continue;
        }
        if line_comment {
            if ch == '\n' {
                line_comment = false;
                flush_css_line(&mut output, &mut current, depth, unit, nl);
            } else {
                current.push(ch);
            }
            index += 1;
            continue;
        }
        if let Some(active) = quote {
            current.push(ch);
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == active {
                quote = None;
            }
            index += 1;
            continue;
        }
        if ch == '/' && next == Some('*') {
            current.push(ch);
            current.push('*');
            block_comment = true;
            index += 2;
            continue;
        }
        if ch == '/' && next == Some('/') {
            current.push(ch);
            current.push('/');
            line_comment = true;
            index += 2;
            continue;
        }
        if ch == '\'' || ch == '"' {
            quote = Some(ch);
            current.push(ch);
            index += 1;
            continue;
        }
        match ch {
            '{' => {
                let header = normalize_css_fragment(&current, false);
                if header.is_empty() {
                    return source.trim().to_string();
                }
                write_css_line(&mut output, depth, unit, &format!("{header} {{"), nl);
                current.clear();
                depth += 1;
            }
            '}' => {
                flush_css_line(&mut output, &mut current, depth, unit, nl);
                depth = depth.saturating_sub(1);
                write_css_line(&mut output, depth, unit, "}", nl);
            }
            ';' => {
                current.push(';');
                flush_css_line(&mut output, &mut current, depth, unit, nl);
            }
            '\n' => {
                if depth == 0 && !current.trim().is_empty() {
                    flush_css_line(&mut output, &mut current, depth, unit, nl);
                } else {
                    current.push(' ');
                }
            }
            _ => current.push(ch),
        }
        index += 1;
    }
    flush_css_line(&mut output, &mut current, depth, unit, nl);
    output
}

fn normalize_css_fragment(fragment: &str, declaration: bool) -> String {
    let mut value = fragment.split_whitespace().collect::<Vec<_>>().join(" ");
    if declaration && let Some(colon) = value.find(':') {
        let (left, right) = value.split_at(colon);
        value = format!("{}: {}", left.trim(), right[1..].trim());
    }
    value.trim().to_string()
}

fn flush_css_line(output: &mut String, current: &mut String, depth: usize, unit: &str, nl: &str) {
    let value = normalize_css_fragment(current, true);
    current.clear();
    if !value.is_empty() {
        write_css_line(output, depth, unit, &value, nl);
    }
}

fn write_css_line(output: &mut String, depth: usize, unit: &str, value: &str, nl: &str) {
    for _ in 0..depth {
        output.push_str(unit);
    }
    output.push_str(value);
    output.push_str(nl);
}

fn compact_css(src: &str) -> String {
    let bytes = src.as_bytes();
    let mut out = String::with_capacity(src.len());
    let mut i = 0;
    let mut in_str: Option<u8> = None;
    let mut escaped = false;
    let mut last_punct = true;
    let mut skipped_ws = false;
    while i < bytes.len() {
        let b = bytes[i];
        if let Some(q) = in_str {
            out.push(b as char);
            if escaped {
                escaped = false;
            } else if b == b'\\' {
                escaped = true;
            } else if b == q {
                in_str = None;
            }
            i += 1;
            last_punct = false;
            skipped_ws = false;
            continue;
        }
        if b == b'/' && i + 1 < bytes.len() && bytes[i + 1] == b'*' {
            i += 2;
            while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                i += 1;
            }
            i = (i + 2).min(bytes.len());
            skipped_ws = true;
            continue;
        }
        if b == b'"' || b == b'\'' {
            in_str = Some(b);
            out.push(b as char);
            i += 1;
            last_punct = false;
            skipped_ws = false;
            continue;
        }
        if b.is_ascii_whitespace() {
            i += 1;
            skipped_ws = true;
            continue;
        }
        let punct = matches!(b, b'{' | b'}' | b':' | b';' | b',' | b'(' | b')');
        if skipped_ws && !last_punct && !punct && !out.is_empty() {
            let prev = out.as_bytes()[out.len() - 1];
            if !matches!(prev, b'{' | b'}' | b':' | b';' | b',' | b'(' | b')') {
                out.push(' ');
            }
        }
        skipped_ws = false;
        if b >= 0x80 {
            let rest = &src[i..];
            let ch = rest.chars().next().unwrap();
            out.push(ch);
            i += ch.len_utf8();
            last_punct = false;
            continue;
        }
        out.push(b as char);
        last_punct = punct;
        i += 1;
    }
    out
}

/// Print CSS for artifacts: [`format_css`] (dev) or [`minify_css`] (release).
pub fn print_css(css: &str, minify: bool) -> String {
    if minify { minify_css(css) } else { format_css(css) }
}

/// Print WXSS from Canonical CSS; `rpx` units are kept by the lexical printer.
pub fn print_wxss(css: &str, minify: bool) -> String {
    print_css(css, minify)
}

/// Emit per-layer assets and a composition entry that `@import`s them in order.
pub fn emit_style_bundle(
    out_dir: &Path,
    contributions: &[StyleContribution],
) -> std::io::Result<StyleEmitReport> {
    emit_style_bundle_opts(out_dir, contributions, false)
}

/// Like [`emit_style_bundle`]; `minify` selects compact CSS (no layer comments).
pub fn emit_style_bundle_opts(
    out_dir: &Path,
    contributions: &[StyleContribution],
    minify: bool,
) -> std::io::Result<StyleEmitReport> {
    let mut report = StyleEmitReport::default();
    let mut imports: Vec<String> = Vec::new();

    let mut ordered = contributions.to_vec();
    ordered.sort_by_key(|c| c.layer as u8);

    for contrib in &ordered {
        let printed = print_css(&contrib.css, minify);
        if printed.is_empty() {
            continue;
        }
        let out = out_dir.join(&contrib.asset_name);
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut file = String::new();
        if !minify {
            file.push_str(&format!("/* vmz style layer: {:?} */\n", contrib.layer));
        }
        file.push_str(&printed);
        fs::write(&out, file)?;
        report.written.push(out);
        imports.push(contrib.asset_name.clone());
    }

    if imports.is_empty() {
        return Ok(report);
    }

    let entry_name = "vmz.css";
    let entry_path = out_dir.join(entry_name);
    let mut entry = String::new();
    if !minify {
        entry.push_str("/* vmz style entry: composed via @import */\n");
    }
    for name in &imports {
        if minify {
            entry.push_str(&format!("@import\"./{name}\";"));
        } else {
            entry.push_str(&format!("@import \"./{name}\";\n"));
        }
    }
    fs::write(&entry_path, entry)?;
    report.written.push(entry_path);
    report.css_entry = Some(entry_name.to_string());
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn minify_css_drops_comments_and_ws() {
        let src = "/* layer */\n.foo {\n  color: red;\n  margin: 1px 2px;\n}\n";
        let min = minify_css(src);
        assert!(!min.contains("/*"), "{min}");
        assert!(min.contains(".foo{") || min.contains(".foo {"), "{min}");
        assert!(min.contains("color:red") || min.contains("color: red"), "{min}");
        assert!(min.len() < src.len(), "min={} src={}", min.len(), src.len());
        assert!(min.contains("1px 2px"), "keep ident spaces: {min}");
    }

    #[test]
    fn validate_css_rejects_unclosed_literals_and_delimiters() {
        assert!(validate_css(".a { color: \"red; }").is_err());
        assert!(validate_css(".a { color: red;").is_err());
        assert!(validate_css(".a { color: rgb(1, 2, 3; }").is_err());
    }

    #[test]
    fn format_css_is_idempotent_and_keeps_data_urls() {
        let source = ".a{background:url(data:image/svg+xml,%3Csvg%3E);content:\"a;b\";}";
        let once = format_css(source);
        assert!(once.contains("data:image/svg+xml"));
        assert_eq!(format_css(&once), once);
    }

    #[test]
    fn print_wxss_keeps_rpx() {
        let src = ".page { padding: 24rpx 28rpx; color: #3d6b2f; }\n";
        let out = print_wxss(src, false);
        assert!(out.contains("24rpx"), "{out}");
        assert!(out.contains("28rpx"), "{out}");
        let min = print_wxss(src, true);
        assert!(min.contains("24rpx"), "{min}");
        assert!(!min.contains("/*"), "{min}");
    }
}
