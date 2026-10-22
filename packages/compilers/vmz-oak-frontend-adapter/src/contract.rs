//! Language-neutral contracts between VMZ, Oaks CST, and future Nyar projection.

use oak_core::Range;
use std::collections::BTreeMap;
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

/// Language-neutral diagnostic surfaced from an Oak parse.
///
/// Carries a stable code, structured catalog arguments, and an optional span —
/// never a rendered sentence. Terminal/localized text is the caller's catalog job.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OakFrontendDiagnostic {
    /// Stable diagnostic code (`oak::*` or a VMZ-owned `vmz::*` code).
    pub code: &'static str,
    /// Catalog template arguments.
    pub args: BTreeMap<String, String>,
    /// Span in the original `.vmz` file when known.
    pub span: Option<ByteSpan>,
}

impl OakFrontendDiagnostic {
    /// Diagnostic with no arguments or span yet.
    pub fn new(code: &'static str) -> Self {
        Self { code, args: BTreeMap::new(), span: None }
    }

    /// Attach one catalog argument (empty values are dropped).
    pub fn with_arg(mut self, key: &str, value: impl Into<String>) -> Self {
        let value = value.into();
        if !value.is_empty() {
            self.args.insert(key.to_string(), value);
        }
        self
    }

    /// Attach a source span.
    pub fn with_span(mut self, span: ByteSpan) -> Self {
        self.span = Some(span);
        self
    }

    /// Flat text for surfaces that have no message catalog yet.
    ///
    /// Callers that own a localized catalog should render [`Self::code`] and
    /// [`Self::args`] themselves instead.
    pub fn render_plain(&self) -> String {
        if self.args.is_empty() {
            return self.code.to_string();
        }
        let args = self
            .args
            .iter()
            .map(|(key, value)| format!("{key}={value}"))
            .collect::<Vec<_>>()
            .join(", ");
        format!("{} ({args})", self.code)
    }
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
