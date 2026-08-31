//! Single-document printer ownership for `.vmz` SFC formatting.

use vmz_compiler::ParsedVmz;

use crate::assemble::assemble_vmz;
use crate::editorconfig::EditorSettings;
use crate::script::format_script_block;
use crate::style::format_style_block;

/// Owned format document: envelope + template AST print + OXC script/style bodies.
///
/// Final `.vmz` text must exit only through [`VmzDocument::print`].
pub struct VmzDocument<'a> {
    parsed: &'a ParsedVmz,
    settings: &'a EditorSettings,
}

impl<'a> VmzDocument<'a> {
    /// Borrow a parsed SFC and EditorConfig settings for printing.
    pub fn from_parsed(parsed: &'a ParsedVmz, settings: &'a EditorSettings) -> Self {
        Self { parsed, settings }
    }

    /// Format script/style with OXC, template via Semantic AST, then assemble envelope.
    pub fn print(self) -> Result<String, String> {
        let parsed = self.parsed;
        let settings = self.settings;
        let client = format_script_block(&parsed.client, settings)?;
        let server = if let Some(server) = &parsed.server {
            Some(format_script_block(server, settings)?)
        } else {
            None
        };
        let style = if let Some(style) = &parsed.style {
            Some(format_style_block(style, settings)?)
        } else {
            None
        };
        // `assemble_vmz` formats `<template>` from Semantic AST (OXC expr print).
        assemble_vmz(parsed, &client, server.as_deref(), style.as_deref(), settings)
    }
}
