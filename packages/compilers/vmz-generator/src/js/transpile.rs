//! TypeScript source transformation through Oak.
use std::path::Path;
use super::print::{EmittedJs, JsPrintOptions, print_js_source};
/// Transpile output.
pub type TranspileOutput = EmittedJs;
/// Transpile TypeScript to JavaScript.
pub fn transpile_ts(source: &str, filename: &str) -> Result<String, String> { Ok(transpile_ts_printed(source, filename, &JsPrintOptions::default())?.code) }
/// Transpile with an optional source map hint.
pub fn transpile_ts_with_map(source: &str, filename: &str, path: Option<&Path>) -> Result<TranspileOutput, String> { transpile_ts_printed(source, filename, &JsPrintOptions { source_map_path: path.map(|p| p.to_path_buf()), ..Default::default() }) }
/// Transpile with print options.
pub fn transpile_ts_printed(source: &str, filename: &str, options: &JsPrintOptions) -> Result<EmittedJs, String> { print_js_source(source, filename, options) }
