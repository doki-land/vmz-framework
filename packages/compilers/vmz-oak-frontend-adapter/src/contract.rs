//! Language-neutral contracts between VMZ, Oaks CST, and future Nyar projection.

use oak_core::Range;
use std::path::PathBuf;

/// Inclusive-exclusive byte span in the original `.vmz` source.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ByteSpan {
    /// UTF-8 start (inclusive).
    pub start: usize,
    /// UTF-8 end (exclusive).
    pub end: usize,
}

impl ByteSpan {
    /// Empty span at `pos`.
    pub fn empty_at(pos: usize) -> Self {
        Self { start: pos, end: pos }
    }

    /// Convert to Oak `Range`.
    pub fn to_range(self) -> Range<usize> {
        Range::from(self.start..self.end)
    }
}

/// Ordered SFC block kinds in a `.vmz` file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BlockKind {
    /// `<router>` JSON5 block.
    Router,
    /// `<meta>` JSON5 block.
    Meta,
    /// `<template>` view block.
    Template,
    /// `<style>` block.
    Style,
    /// `<script client>` block.
    ScriptClient,
    /// `<script server>` block.
    ScriptServer,
}

/// One block region with absolute source span (envelope tags included where noted).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SfcBlockRegion {
    /// Block role.
    pub kind: BlockKind,
    /// Full block span in the `.vmz` file (opening tag through closing tag when present).
    pub span: ByteSpan,
    /// Inner content span (between open/close tags).
    pub content_span: ByteSpan,
}

/// VMZ SFC region map — input view for Oak CST and Nyar analysis adapters.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SfcDocumentView {
    /// Source path.
    pub path: PathBuf,
    /// Full source text.
    pub source: String,
    /// Ordered block regions.
    pub blocks: Vec<SfcBlockRegion>,
}

/// VMZ `<template>` body slice for Oak CST/AST (no `vmz-compiler` dependency).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TemplateShellInput {
    /// Markup between `<template>` tags.
    pub content: String,
    /// Byte offset of content start in the `.vmz` file.
    pub content_start: usize,
}

/// Client vs server `<script>` role for Oak TypeScript AST.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScriptRole {
    /// `<script client>`.
    Client,
    /// `<script server>`.
    Server,
}

/// VMZ script body slice for Oak TypeScript AST.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScriptShellInput {
    /// TypeScript between `<script>` tags.
    pub content: String,
    /// Byte offset of content start in the `.vmz` file.
    pub content_start: usize,
    /// Client or server role.
    pub role: ScriptRole,
}

/// Diagnostic surfaced from Oak parse (mapped to `.vmz` coordinates when possible).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OakFrontendDiagnostic {
    /// Message text.
    pub message: String,
    /// Span in the original `.vmz` file when known.
    pub span: Option<ByteSpan>,
}

/// Result of parsing a VMZ template region through Oak CST.
#[derive(Debug, Clone)]
pub struct TemplateCstParse {
    /// Shell text passed to Oak (`<template>…</template>` around template body).
    pub shell_source: String,
    /// Byte offset in `.vmz` where `shell_source` byte `0` maps (`template` open `<`).
    pub shell_base_offset: usize,
    /// Oak diagnostics (spans remapped to `.vmz` when possible).
    pub diagnostics: Vec<OakFrontendDiagnostic>,
    /// `true` when Oak reported no errors.
    pub ok: bool,
}
