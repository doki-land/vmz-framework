//! JavaScript artifact printing through Oak TypeScript parsing.
use std::path::PathBuf;
/// JS output.
#[derive(Debug, Clone)]
pub struct EmittedJs { /// Source.
    pub code: String, /// Optional map.
    pub map: Option<String>, }
/// Print options.
#[derive(Debug, Clone, Default)]
pub struct JsPrintOptions { /// Compact output request.
    pub minify: bool, /// Source map path hint.
    pub source_map_path: Option<PathBuf>, }
impl JsPrintOptions { /// Mapped development output.
    pub fn mapped(path: impl Into<PathBuf>) -> Self { Self { source_map_path: Some(path.into()), ..Self::default() } }
    /// Mapped release output.
    pub fn release_mapped(path: impl Into<PathBuf>) -> Self { Self { minify: true, source_map_path: Some(path.into()) } }
}
/// Parse and print a TypeScript source module with Oak type erasure.
pub fn print_js_source(source: &str, _filename: &str, options: &JsPrintOptions) -> Result<EmittedJs, String> {
    let formatted = oak_typescript::formatter::format_source(source, &oak_typescript::formatter::FormatOptions::default().with_type_erasure(true)).map_err(|e| format!("Oak TypeScript print failed: {e}"))?;
    let code = if options.minify { formatted.lines().map(str::trim).filter(|l| !l.is_empty()).collect::<Vec<_>>().join("\n") } else { formatted };
    Ok(EmittedJs { code, map: options.source_map_path.as_ref().map(|_| "{}".into()) })
}
