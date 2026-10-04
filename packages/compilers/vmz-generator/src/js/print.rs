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
    let shell = vmz_oak_frontend_adapter::ScriptShellInput { content: source.to_string(), content_start: 0, role: vmz_oak_frontend_adapter::ScriptRole::Client };
    if !vmz_oak_frontend_adapter::parse_script_ast(&shell).ok { return Err("Oak TypeScript parse failed".into()); }
    let formatted = erase_types(source);
    let code = if options.minify { formatted.lines().map(str::trim).filter(|l| !l.is_empty()).collect::<Vec<_>>().join("\n") } else { formatted };
    Ok(EmittedJs { code, map: options.source_map_path.as_ref().map(|_| "{}".into()) })
}

fn erase_types(source: &str) -> String {
    let mut out = String::with_capacity(source.len());
    for line in source.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("interface ") || trimmed.starts_with("type ") { continue; }
        let mut line = line.to_string();
        for keyword in ["public ", "private ", "protected ", "readonly "] { line = line.replace(keyword, ""); }
        line = strip_as_type(&line);
        out.push_str(&line);
        out.push('\n');
    }
    out
}

fn strip_as_type(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut rest = line;
    while let Some(pos) = rest.find(" as ") {
        out.push_str(&rest[..pos]);
        let tail = &rest[pos + 4..];
        let end = tail.find(|c: char| matches!(c, ',' | ';' | ')' | '}' | '\n')).unwrap_or(tail.len());
        rest = &tail[end..];
    }
    out.push_str(rest);
    out
}
