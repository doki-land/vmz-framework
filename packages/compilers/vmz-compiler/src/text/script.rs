//! `data.text` TypeScript script validation for VMZ `<script client|server>` blocks.

use vmz_text_frontend_adapter::{
    ScriptRole, ScriptShellInput, format_cst_diagnostics, require_script_ast,
};

use crate::sfc::{ScriptBlock, ScriptKind, ScriptLanguage};

/// Map a parsed script block to `data.text` adapter input.
pub fn script_shell_from_block(block: &ScriptBlock) -> ScriptShellInput {
    ScriptShellInput {
        content: block.content.clone(),
        content_start: block.content_start,
        role: match block.kind {
            ScriptKind::Client => ScriptRole::Client,
            ScriptKind::Server => ScriptRole::Server,
        },
    }
}

/// Validate TypeScript script bodies through `data.text` AST (no-op for non-TS langs).
///
/// Shares the `data.text` path with [`crate::analyze::analyze_script`] surface lowering.
/// Production `check` / `compile` use `data.text` surface lowering;
/// this helper remains strict for smoke / adapter gates.
pub fn check_script_ast_ts(block: &ScriptBlock) -> Result<(), String> {
    if block.lang != ScriptLanguage::Ts {
        return Ok(());
    }
    require_script_ast(&script_shell_from_block(block))
        .map(|_| ())
        .map_err(|diagnostics| format_cst_diagnostics(&diagnostics))
}
