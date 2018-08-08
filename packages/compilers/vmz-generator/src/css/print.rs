//! Style layer composition (`@import` entry) + CSS validate/format.

use std::fs;
use std::path::{Path, PathBuf};

use oxc_css_parser::{Allocator, Parser, Syntax};

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

/// Validate CSS with oxc-css-parser (Syntax::Css).
///
/// Not used as a hard gate on StyleEmitter write (TW/`@tailwind` and SCSS
/// intermediates may not be pure CSS yet). Call from checks / tests.
pub fn validate_css(css: &str) -> Result<()> {
    let allocator = Allocator::default();
    let mut parser = Parser::new(&allocator, css, Syntax::Css);
    match parser.parse::<oxc_css_parser::ast::Stylesheet>() {
        Ok(_) => Ok(()),
        Err(e) => Err(GeneratorError::msg(format!("css parse: {e:?}"))),
    }
}

/// Canonical CSS print via `oxc_formatter_css` when the body is pure CSS.
///
/// Falls back to trim + trailing newline when the formatter rejects the input
/// (TW/`@tailwind` / SCSS intermediates that are not yet pure CSS).
pub fn format_css(css: &str) -> String {
    let trimmed = css.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let allocator = oxc_allocator::Allocator::new();
    let options = oxc_formatter_css::CssFormatOptions {
        variant: oxc_formatter_css::CssVariant::Css,
        ..oxc_formatter_css::CssFormatOptions::default()
    };
    if let Ok(formatted) = oxc_formatter_css::format(&allocator, trimmed, options)
        && let Ok(printed) = formatted.print()
    {
        let mut body = printed.into_code();
        if !body.ends_with('\n') {
            body.push('\n');
        }
        return body;
    }

    let mut body = trimmed.to_string();
    if !body.ends_with('\n') {
        body.push('\n');
    }
    body
}

/// Production CSS print: parse/validate via oxc-css-parser when possible, then
/// drop comments and collapse whitespace (strings / `url()` kept intact).
pub fn minify_css(css: &str) -> String {
    let trimmed = css.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let _ = validate_css(trimmed);
    compact_css(trimmed)
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

/// Print WXSS from Canonical CSS. Same oxc CSS path as [`print_css`]; `rpx` is kept.
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
