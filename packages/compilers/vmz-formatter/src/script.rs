//! Format `<script>` bodies via Oak TypeScript.

use oak_typescript::formatter::format_source as oak_format_source;
use vmz_compiler::{ScriptBlock, ScriptLanguage};

use crate::editorconfig::EditorSettings;

/// Format one script block. Non-TS languages keep body text (envelope trim only).
pub fn format_script_block(
    block: &ScriptBlock,
    settings: &EditorSettings,
) -> Result<String, String> {
    match block.lang {
        ScriptLanguage::Ts => {
            let formatted = oak_format_source(&block.content, &settings.format_options())
                .map_err(|error| error.to_string())?;
            Ok(normalize_body(&formatted, settings))
        }
        ScriptLanguage::Rust | ScriptLanguage::Python | ScriptLanguage::Java => {
            Ok(envelope_only(&block.content, settings))
        }
    }
}

fn envelope_only(source: &str, settings: &EditorSettings) -> String {
    normalize_body(source, settings)
}

fn normalize_body(source: &str, settings: &EditorSettings) -> String {
    let nl = settings.newline();
    let mut lines: Vec<String> = source
        .lines()
        .map(|line| {
            if settings.trim_trailing_whitespace { line.trim_end().to_string() } else { line.to_string() }
        })
        .collect();
    while lines.last().is_some_and(|line| line.is_empty()) {
        lines.pop();
    }
    while lines.first().is_some_and(|line| line.is_empty()) {
        lines.remove(0);
    }
    let mut out = lines.join(nl);
    if settings.insert_final_newline && !out.is_empty() {
        out.push_str(nl);
    }
    out
}
