use std::path::Path;

use oak_typescript::print::{FormatOptions, format_source as oak_format_source};

/// Transitional Oak AST print (`oak_typescript::print`). Not CST-faithful — see Oaks
/// `format_print_contract` and VMZ capability matrix. Returns `Err` when Oak cannot print.
pub fn format_source(_path: &Path, source: &str) -> Result<String, String> {
    oak_format_source(source, &FormatOptions::default())
}
