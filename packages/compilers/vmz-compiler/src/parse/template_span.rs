//! Local UTF-8 byte spans for template Concrete AST (not file coordinates, not LSP).
//!
//! # Contract (hard)
//!
//! - `start` / `end` are **UTF-8 byte offsets** into the `<template>` body string.
//! - Range is **end-exclusive** `[start, end)`.
//! - **No** line / column on this type — consumers convert via a source-text
//!   `OffsetIndex` (CLI / LSP UTF-16 / diagnostic UTF-8) when needed.
//! - Absolute file coordinates = SFC `content_start + local_offset`, then wrap as
//!   protocol [`vmz_protocol::dx::SourceSpan`] (`path` + file offsets).
//! - Do not precompute line/column in the parser.

/// Inclusive-exclusive UTF-8 byte range into the template body string.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct TemplateSpan {
    /// Start byte offset (UTF-8, inclusive).
    pub start: u32,
    /// End byte offset (UTF-8, exclusive).
    pub end: u32,
}

impl TemplateSpan {
    /// Build a span from `usize` offsets (truncated to `u32`).
    pub fn from_usize(start: usize, end: usize) -> Self {
        Self {
            start: start as u32,
            end: end as u32,
        }
    }

    /// Empty span at `offset`.
    pub fn point(offset: usize) -> Self {
        let o = offset as u32;
        Self { start: o, end: o }
    }

    /// Whether the span covers at least one byte.
    pub fn is_empty(self) -> bool {
        self.start >= self.end
    }

    /// Map template-local span to absolute file offsets (no path).
    pub fn to_absolute(self, content_start: u32) -> (u32, u32) {
        (content_start + self.start, content_start + self.end)
    }
}
