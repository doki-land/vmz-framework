//! Consumer-side UTF-8 byte offset ↔ line/column / LSP UTF-16 conversion.
//!
//! # Contract
//!
//! AST / protocol spans stay offset-only ([`super::template_span::TemplateSpan`],
//! [`vmz_protocol::SourceSpan`]). CLI / LSP / diagnostic **renderers** convert
//! here from full source text. Do not store line/column on span types.
//!
//! - [`Self::line_col`]: 1-based line + 1-based **Unicode scalar** column (UTF-8 view)
//! - [`Self::lsp_position`] / [`Self::offset_from_lsp`]: 0-based line + 0-based
//!   **UTF-16 code unit** character (LSP `Position`)

/// Line-start table for one source buffer.
#[derive(Debug, Clone)]
pub struct OffsetIndex {
    /// Inclusive UTF-8 byte offset of each line start (line 0 at `0`).
    line_starts: Vec<u32>,
}

/// LSP `Position`: 0-based line, 0-based UTF-16 code-unit character.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LspPosition {
    /// 0-based line index.
    pub line: u32,
    /// 0-based UTF-16 code-unit offset within the line.
    pub character: u32,
}

impl OffsetIndex {
    /// Build an index from complete source text.
    pub fn new(source: &str) -> Self {
        let mut line_starts = vec![0u32];
        for (i, b) in source.as_bytes().iter().enumerate() {
            if *b == b'\n' {
                line_starts.push((i + 1) as u32);
            }
        }
        Self { line_starts }
    }

    /// 1-based line and 1-based UTF-8 scalar column for a UTF-8 byte `offset`.
    ///
    /// Offsets past EOF clamp to EOF. Empty sources map to `(1, 1)`.
    pub fn line_col(&self, source: &str, offset: u32) -> (u32, u32) {
        let len = source.len() as u32;
        let offset = offset.min(len);
        if self.line_starts.is_empty() {
            return (1, 1);
        }
        let line_idx = match self.line_starts.binary_search(&offset) {
            Ok(i) => i,
            Err(i) => i.saturating_sub(1),
        };
        let line_start = self.line_starts[line_idx] as usize;
        let end = offset as usize;
        let col = if end <= line_start {
            1
        } else {
            source.get(line_start..end).map(|s| s.chars().count()).unwrap_or(0) as u32 + 1
        };
        ((line_idx as u32) + 1, col)
    }

    /// 0-based LSP position (UTF-16 code units within the line) for a UTF-8 byte offset.
    pub fn lsp_position(&self, source: &str, offset: u32) -> LspPosition {
        let len = source.len() as u32;
        let offset = offset.min(len);
        if self.line_starts.is_empty() {
            return LspPosition { line: 0, character: 0 };
        }
        let line_idx = match self.line_starts.binary_search(&offset) {
            Ok(i) => i,
            Err(i) => i.saturating_sub(1),
        };
        let line_start = self.line_starts[line_idx] as usize;
        let end = offset as usize;
        let character = if end <= line_start {
            0
        } else {
            utf16_len(source.get(line_start..end).unwrap_or(""))
        };
        LspPosition { line: line_idx as u32, character }
    }

    /// UTF-8 byte offset for an LSP position (clamped to line / EOF).
    pub fn offset_from_lsp(&self, source: &str, pos: LspPosition) -> u32 {
        if self.line_starts.is_empty() {
            return 0;
        }
        let line_idx = (pos.line as usize).min(self.line_starts.len().saturating_sub(1));
        let line_start = self.line_starts[line_idx] as usize;
        let line_end = if line_idx + 1 < self.line_starts.len() {
            self.line_starts[line_idx + 1] as usize
        } else {
            source.len()
        };
        // Exclude trailing `\n` from the line body for character counting.
        let mut body_end = line_end;
        if body_end > line_start && source.as_bytes().get(body_end - 1) == Some(&b'\n') {
            body_end -= 1;
        }
        let line_body = source.get(line_start..body_end).unwrap_or("");
        let byte_in_line = offset_from_utf16(line_body, pos.character);
        (line_start + byte_in_line) as u32
    }
}

fn utf16_len(s: &str) -> u32 {
    s.chars().map(|c| c.len_utf16() as u32).sum()
}

/// Byte offset into `s` for `utf16_units` UTF-16 code units (clamped).
fn offset_from_utf16(s: &str, utf16_units: u32) -> usize {
    let mut units = 0u32;
    for (i, c) in s.char_indices() {
        if units >= utf16_units {
            return i;
        }
        units += c.len_utf16() as u32;
    }
    s.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ascii_lines() {
        let src = "ab\ncd\nef";
        let idx = OffsetIndex::new(src);
        assert_eq!(idx.line_col(src, 0), (1, 1));
        assert_eq!(idx.line_col(src, 1), (1, 2));
        assert_eq!(idx.line_col(src, 3), (2, 1));
        assert_eq!(idx.line_col(src, 6), (3, 1));
    }

    #[test]
    fn utf8_scalar_columns() {
        // "你" is 3 UTF-8 bytes; column advances by 1 scalar.
        let src = "你x\nbar";
        let idx = OffsetIndex::new(src);
        assert_eq!(idx.line_col(src, 0), (1, 1));
        assert_eq!(idx.line_col(src, 3), (1, 2)); // 'x'
        assert_eq!(idx.line_col(src, 5), (2, 1)); // 'b' after '\n'
    }

    #[test]
    fn utf16_round_trip_ascii() {
        let src = "ab\ncd";
        let idx = OffsetIndex::new(src);
        for off in [0u32, 1, 2, 3, 4, 5] {
            let pos = idx.lsp_position(src, off);
            assert_eq!(idx.offset_from_lsp(src, pos), off.min(src.len() as u32));
        }
    }

    #[test]
    fn utf16_round_trip_cjk() {
        // "你" = 1 UTF-16 unit, 3 UTF-8 bytes.
        let src = "你x";
        let idx = OffsetIndex::new(src);
        assert_eq!(idx.lsp_position(src, 0), LspPosition { line: 0, character: 0 });
        assert_eq!(idx.lsp_position(src, 3), LspPosition { line: 0, character: 1 }); // before 'x'
        assert_eq!(idx.lsp_position(src, 4), LspPosition { line: 0, character: 2 }); // after 'x'
        assert_eq!(idx.offset_from_lsp(src, LspPosition { line: 0, character: 1 }), 3);
        assert_eq!(idx.offset_from_lsp(src, LspPosition { line: 0, character: 2 }), 4);
    }

    #[test]
    fn lsp_unicode_non_bmp_surrogate_pair() {
        // U+1F600 😀 = 4 UTF-8 bytes, 2 UTF-16 code units.
        let src = "a😀b";
        let idx = OffsetIndex::new(src);
        assert_eq!(idx.lsp_position(src, 0), LspPosition { line: 0, character: 0 });
        assert_eq!(idx.lsp_position(src, 1), LspPosition { line: 0, character: 1 }); // start of emoji
        let after_emoji = 1 + "😀".len();
        assert_eq!(
            idx.lsp_position(src, after_emoji as u32),
            LspPosition { line: 0, character: 3 }
        );
        assert_eq!(idx.offset_from_lsp(src, LspPosition { line: 0, character: 1 }), 1);
        assert_eq!(
            idx.offset_from_lsp(src, LspPosition { line: 0, character: 3 }),
            after_emoji as u32
        );
        // Mid-surrogate clamp: character 2 lands after the full scalar.
        assert_eq!(
            idx.offset_from_lsp(src, LspPosition { line: 0, character: 2 }),
            after_emoji as u32
        );
    }

    #[test]
    fn utf8_utf16_round_trip_mixed_line() {
        let src = "你😀x\ny";
        let idx = OffsetIndex::new(src);
        for off in 0..=src.len() as u32 {
            let pos = idx.lsp_position(src, off);
            let back = idx.offset_from_lsp(src, pos);
            // Round-trip may snap to scalar boundary when off splits a multi-byte char.
            let snapped = idx.lsp_position(src, back);
            assert_eq!(snapped, pos, "off={off} pos={pos:?} back={back}");
        }
    }
}
