use std::path::Path;

use oak_typescript::print::{FormatOptions, format_source as oak_format_source};

/// Format via Oak TypeScript AST print. Returns `Err` when Oak cannot print the file.
pub fn format_source(_path: &Path, source: &str) -> Result<String, String> {
    oak_format_source(source, &FormatOptions::default())
}
