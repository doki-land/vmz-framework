//! Format `<style>` bodies with oxc_formatter_css.

use oxc_allocator::Allocator;
use oxc_formatter_css::CssVariant;
use vmz_compiler::{StyleBlock, StyleLanguage};

use crate::editorconfig::EditorSettings;

/// Format one style block via oxc CSS formatter.
pub fn format_style_block(block: &StyleBlock, settings: &EditorSettings) -> Result<String, String> {
    let source = block.content.trim();
    if source.is_empty() {
        return Ok(String::new());
    }

    let allocator = Allocator::new();
    let variant = match block.lang {
        StyleLanguage::Css => CssVariant::Css,
        StyleLanguage::Scss => CssVariant::Scss,
        // Indented Sass is not a first-class oxc variant; keep text via SCSS parser path.
        StyleLanguage::Sass => CssVariant::Scss,
    };
    let options = settings.css_options(variant);
    let formatted =
        oxc_formatter_css::format(&allocator, source, options).map_err(|d| d.to_string())?;
    let code = formatted.print().map_err(|e| e.to_string())?.into_code();
    Ok(normalize_style_body(&code, settings))
}

fn normalize_style_body(source: &str, settings: &EditorSettings) -> String {
    let nl = settings.newline();
    let unit = settings.indent_unit();
    let mut lines: Vec<String> = source
        .lines()
        .map(|l| {
            let l = if settings.trim_trailing_whitespace {
                l.trim_end()
            } else {
                l
            };
            if l.is_empty() {
                String::new()
            } else {
                format!("{unit}{l}")
            }
        })
        .collect();
    while lines.last().is_some_and(|l| l.is_empty()) {
        lines.pop();
    }
    let mut out = lines.join(nl);
    if !out.is_empty() {
        out.push_str(nl);
    }
    out
}
