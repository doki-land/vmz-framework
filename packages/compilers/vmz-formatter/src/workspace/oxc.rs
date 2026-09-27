use std::path::Path;

use oxc_allocator::Allocator;
use oxc_formatter::{JsFormatOptions, QuoteStyle, format};
use oxc_formatter_core::{IndentStyle, IndentWidth, LineWidth};
use oxc_span::SourceType;

use super::FormatFileResult;

/// Default style aligned with sibling repos' `biome.json` (4 spaces, single quotes, width 144).
pub fn default_format_options() -> JsFormatOptions {
    JsFormatOptions {
        indent_style: IndentStyle::Space,
        indent_width: IndentWidth::try_from(4).unwrap_or_default(),
        line_width: LineWidth::try_from(144).unwrap_or_default(),
        quote_style: QuoteStyle::Single,
        ..JsFormatOptions::default()
    }
}

pub fn load_format_options(root: &Path, style_config: Option<&Path>) -> JsFormatOptions {
    let biome_path = style_config
        .map(|path| if path.is_absolute() { path.to_path_buf() } else { root.join(path) })
        .unwrap_or_else(|| root.join("biome.json"));
    let Ok(raw) = std::fs::read_to_string(&biome_path) else {
        return default_format_options();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return default_format_options();
    };

    let mut options = default_format_options();
    if let Some(width) = value
        .pointer("/formatter/lineWidth")
        .and_then(|v| v.as_u64())
        .and_then(|v| u16::try_from(v).ok())
    {
        if let Ok(line_width) = LineWidth::try_from(width) {
            options.line_width = line_width;
        }
    }
    if let Some(width) = value
        .pointer("/formatter/indentWidth")
        .and_then(|v| v.as_u64())
        .and_then(|v| u8::try_from(v).ok())
    {
        if let Ok(indent_width) = IndentWidth::try_from(width) {
            options.indent_width = indent_width;
        }
    }
    if let Some(quote) = value.pointer("/javascript/formatter/quoteStyle").and_then(|v| v.as_str())
    {
        options.quote_style = match quote {
            "double" => QuoteStyle::Double,
            _ => QuoteStyle::Single,
        };
    }
    options
}

pub fn format_source_with_options(
    path: &Path,
    source: &str,
    options: JsFormatOptions,
) -> Result<FormatFileResult, String> {
    let source_type =
        SourceType::from_path(path).map_err(|err| format!("{}: {err}", path.display()))?;
    let allocator = Allocator::new();
    let formatted = format(&allocator, source, source_type, options)
        .map_err(|err| format!("{}: {err}", path.display()))?;
    let code = formatted
        .print()
        .map_err(|err| format!("{}: print error: {err}", path.display()))?
        .into_code();

    Ok(FormatFileResult { changed: code != source, output: code })
}
