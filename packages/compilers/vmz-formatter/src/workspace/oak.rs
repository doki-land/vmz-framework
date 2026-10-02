use std::path::Path;

use oak_typescript::{FormatOptions, format_source as oak_format_source};

/// Format via Oak public `format` API (`oak_typescript::format`).
pub fn format_source(
    _path: &Path,
    source: &str,
    options: &FormatOptions,
) -> Result<String, String> {
    oak_format_source(source, options).map_err(|err| err.to_string())
}
