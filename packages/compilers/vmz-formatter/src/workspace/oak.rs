use std::path::Path;

use oak_typescript::formatter::{FormatOptions, format_source as oak_format_source};

/// Format via Oak public formatter API (`oak_typescript::formatter`).
pub fn format_source(
    _path: &Path,
    source: &str,
    options: &FormatOptions,
) -> Result<String, String> {
    oak_format_source(source, options).map_err(|err| err.to_string())
}
