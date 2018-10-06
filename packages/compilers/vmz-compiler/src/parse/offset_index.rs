//! Consumer-side UTF-8 byte offset → line / column conversion.
//!
//! # Contract
//!
//! AST / protocol spans stay offset-only ([`super::template_span::TemplateSpan`],
//! [`vmz_protocol::SourceSpan`]). CLI / LSP / diagnostic **renderers** convert
//! here from full source text. Do not store line/column on span types.
//!
//! Columns are **1-based Unicode scalar counts** within the line (UTF-8 view).
//! LSP UTF-16 conversion is a later consumer of the same offsets.

/// Line-start table for one source buffer.
#[derive(Debug, Clone)]
pub struct OffsetIndex {
    /// Inclusive UTF-8 byte offset of each line start (line 0 at `0`).
    line_starts: Vec<u32>,
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
}
