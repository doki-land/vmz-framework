//! JavaScript artifact printing through Oak TypeScript parsing.
use super::erase::erase_types;
use std::path::PathBuf;
/// JS output.
#[derive(Debug, Clone)]
pub struct EmittedJs {
    /// Source.
    pub code: String,
    /// Optional map. Absent when no source map was actually generated (instead of a fake `{}`).
    pub map: Option<String>,
}
/// Print options.
#[derive(Debug, Clone, Default)]
pub struct JsPrintOptions {
    /// Compact output request.
    pub minify: bool,
    /// Source map path hint. When `Some`, the downstream pipeline is expected to attach
    /// a real map — we do not fabricate one here.
    pub source_map_path: Option<PathBuf>,
}
impl JsPrintOptions {
    /// Mapped development output.
    pub fn mapped(path: impl Into<PathBuf>) -> Self {
        Self { source_map_path: Some(path.into()), ..Self::default() }
    }
    /// Mapped release output.
    pub fn release_mapped(path: impl Into<PathBuf>) -> Self {
        Self { minify: true, source_map_path: Some(path.into()) }
    }
}
/// Collapse line-internal whitespace for minified output.
///
/// Each line is trimmed, consecutive runs of ASCII whitespace are compressed to a
/// single space, and the line is dropped entirely if it becomes empty. Consecutive
/// newlines between non-empty lines are preserved as single `\n`. This is a JS-safe
/// cosmetic compaction — it intentionally does not do AST-level dead-code removal,
/// identifier renaming, or semicolon insertion.
fn minify_whitespace(source: &str) -> String {
    let mut out = String::with_capacity(source.len());
    for line in source.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let mut last_was_ws = false;
        for ch in trimmed.chars() {
            if ch.is_ascii_whitespace() {
                if !last_was_ws {
                    out.push(' ');
                }
                last_was_ws = true;
            } else {
                out.push(ch);
                last_was_ws = false;
            }
        }
        out.push('\n');
    }
    // Drop trailing newline — callers can add their own terminator.
    if out.ends_with('\n') {
        out.pop();
    }
    out
}
/// Parse and print a TypeScript source module with Oak type erasure.
pub fn print_js_source(
    source: &str,
    _filename: &str,
    options: &JsPrintOptions,
) -> Result<EmittedJs, String> {
    let shell = vmz_oak_frontend_adapter::ScriptShellInput {
        content: source.to_string(),
        content_start: 0,
        role: vmz_oak_frontend_adapter::ScriptRole::Client,
    };
    let parsed = vmz_oak_frontend_adapter::parse_script_ast(&shell);
    if !parsed.ok {
        return Err(format!(
            "Oak TypeScript parse failed: {}",
            vmz_oak_frontend_adapter::format_cst_diagnostics(&parsed.diagnostics)
        ));
    }
    let formatted = erase_types(source)?;
    let code = if options.minify {
        minify_whitespace(&formatted)
    } else {
        formatted
    };
    // Intentionally `None`: we do not fabricate an empty `{}` source map when no
    // real map has been generated. Downstream consumers should read `source_map_path`
    // from `options` and attach an actual map themselves if they want one.
    Ok(EmittedJs { code, map: None })
}
