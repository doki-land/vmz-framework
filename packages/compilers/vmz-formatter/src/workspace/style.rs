use std::path::Path;

use oak_typescript::formatter::FormatOptions;

/// Default style aligned with the VMZ workspace contract.
pub fn default_format_options() -> FormatOptions {
    FormatOptions { indent_width: 4, line_width: 144, type_erasure: false }
}

pub fn load_format_options(
    root: &Path,
    style_config: Option<&Path>,
) -> Result<FormatOptions, String> {
    let biome_path = style_config
        .map(|path| if path.is_absolute() { path.to_path_buf() } else { root.join(path) })
        .unwrap_or_else(|| root.join("biome.json"));
    let Ok(raw) = std::fs::read_to_string(&biome_path) else {
        return Ok(default_format_options());
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return Ok(default_format_options());
    };

    if value.pointer("/formatter/indentStyle").and_then(|v| v.as_str()) == Some("tab") {
        return Err(format!(
            "{}: Oak format does not support tab indentation",
            biome_path.display()
        ));
    }
    if value.pointer("/javascript/formatter/quoteStyle").and_then(|v| v.as_str()) == Some("double")
    {
        return Err(format!("{}: Oak format does not support double quotes", biome_path.display()));
    }

    let indent_width = value
        .pointer("/formatter/indentWidth")
        .and_then(|v| v.as_u64())
        .and_then(|v| u8::try_from(v).ok())
        .unwrap_or(4);
    let line_width = value
        .pointer("/formatter/lineWidth")
        .and_then(|v| v.as_u64())
        .and_then(|v| usize::try_from(v).ok())
        .unwrap_or(144);
    Ok(FormatOptions { indent_width, line_width, type_erasure: false })
}
