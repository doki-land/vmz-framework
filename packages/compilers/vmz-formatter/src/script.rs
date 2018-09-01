//! Format `<script>` bodies with oxc_formatter (TS) or envelope-only (other langs).

use oxc_allocator::Allocator;
use oxc_span::SourceType;
use vmz_compiler::{ScriptBlock, ScriptLanguage};

use crate::editorconfig::EditorSettings;

/// Format one script block. Non-TS languages keep body text (envelope trim only).
pub fn format_script_block(
    block: &ScriptBlock,
    settings: &EditorSettings,
) -> Result<String, String> {
    match block.lang {
        ScriptLanguage::Ts => format_ts(&block.content, settings),
        ScriptLanguage::Rust | ScriptLanguage::Python | ScriptLanguage::Java => {
            Ok(envelope_only(&block.content, settings))
        }
    }
}

fn format_ts(source: &str, settings: &EditorSettings) -> Result<String, String> {
    let allocator = Allocator::new();
    let options = settings.js_options();
    let formatted = oxc_formatter::format(&allocator, source, SourceType::ts(), options)
        .map_err(|d| d.to_string())?;
    let code = formatted.print().map_err(|e| e.to_string())?.into_code();
    Ok(normalize_body(&code, settings))
}

fn envelope_only(source: &str, settings: &EditorSettings) -> String {
    normalize_body(source, settings)
}

fn normalize_body(source: &str, settings: &EditorSettings) -> String {
    let nl = settings.newline();
    let mut lines: Vec<String> = source
        .lines()
        .map(|l| {
            if settings.trim_trailing_whitespace { l.trim_end().to_string() } else { l.to_string() }
        })
        .collect();
    while lines.last().is_some_and(|l| l.is_empty()) {
        lines.pop();
    }
    let mut out = lines.join(nl);
    if settings.insert_final_newline || !out.is_empty() {
        // Script body inside tags always ends with newline before `</script>`.
        if !out.is_empty() {
            out.push_str(nl);
        }
    }
    out
}
