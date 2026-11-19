use std::path::Path;

use data_text_typescript::formatter::{FormatOptions, format_source as text_format_source};

/// Format via `data.text` public formatter API (`data_text_typescript::formatter`).
pub fn format_source(
    _path: &Path,
    source: &str,
    options: &FormatOptions,
) -> Result<String, String> {
    text_format_source(source, options).map_err(|err| err.to_string())
}
