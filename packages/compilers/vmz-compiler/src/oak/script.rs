//! Oak TypeScript script validation for VMZ `<script client|server>` blocks.

use vmz_oak_frontend_adapter::{require_script_ast, ScriptRole, ScriptShellInput};

use crate::sfc::{ScriptBlock, ScriptKind, ScriptLanguage};

/// Map a parsed script block to Oak adapter input.
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

/// Validate TypeScript script bodies through Oak AST (no-op for non-TS langs).
pub fn check_oak_script_ts(block: &ScriptBlock) -> Result<(), String> {
    if block.lang != ScriptLanguage::Ts {
        return Ok(());
    }
    require_script_ast(&script_shell_from_block(block)).map(|_| ())
}
