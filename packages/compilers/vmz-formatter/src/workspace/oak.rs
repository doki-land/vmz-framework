use std::path::Path;

use oak_typescript::cst_format::{CstFormatOptions, format_source as cst_format_source};
use oak_typescript::print::{FormatOptions, format_source as ast_print_source};

/// Oak CST format first, then transitional AST print. Neither is full CST-faithful yet.
pub fn format_source(
    _path: &Path,
    source: &str,
    cst: &CstFormatOptions,
) -> Result<String, String> {
    cst_format_source(source, cst)
        .or_else(|_| ast_print_source(source, &FormatOptions::default()))
}
