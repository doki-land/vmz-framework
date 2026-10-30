//! JavaScript artifact printing through Oak TypeScript parsing.
use super::erase::erase_types_with_deletions;
use oak_core::{Lexer, NoLexerCache, SourceText};
use oak_typescript::{TypeScriptLanguage, TypeScriptLexer, TypeScriptTokenType as T};
use std::path::PathBuf;
/// JS output.
#[derive(Debug, Clone)]
pub struct EmittedJs {
    /// Source.
    pub code: String,
    /// Source map v3 JSON. `None` only when no map was requested.
    pub map: Option<String>,
}
/// Print options.
#[derive(Debug, Clone, Default)]
pub struct JsPrintOptions {
    /// Compact output request.
    pub minify: bool,
    /// Source map path hint. When `Some`, a real source map v3 document is emitted.
    pub source_map_path: Option<PathBuf>,
}
impl JsPrintOptions {
    /// Mapped development output.
    pub fn mapped(path: impl Into<PathBuf>) -> Self {
        Self { source_map_path: Some(path.into()), ..Self::default() }
    }
    /// Mapped release output.
    pub fn release_mapped(path: impl Into<PathBuf>) -> Self {
        Self { minify: true, source_map_path: Some(path.into()) }
    }
}

/// One generated token mapped back to its original source position.
#[derive(Debug, Clone, Copy)]
pub struct SourceMapSegment {
    /// Line in the generated output (0-based).
    pub gen_line: u32,
    /// Column in the generated output, UTF-16 units (0-based).
    pub gen_col: u32,
    /// Index into the `sources` array passed to [`source_map_json`].
    pub src_index: u32,
    /// Line in the original source (0-based).
    pub src_line: u32,
    /// Column in the original source, UTF-16 units (0-based).
    pub src_col: u32,
}

/// Parse and print a TypeScript source module with Oak type erasure.
pub fn print_js_source(
    source: &str,
    filename: &str,
    options: &JsPrintOptions,
) -> Result<EmittedJs, String> {
    let shell = vmz_oak_frontend_adapter::ScriptShellInput {
        content: source.to_string(),
        content_start: 0,
        role: vmz_oak_frontend_adapter::ScriptRole::Client,
    };
    let parsed = vmz_oak_frontend_adapter::parse_script_ast(&shell);
    if !parsed.ok {
        return Err(format!(
            "Oak TypeScript parse failed: {}",
            vmz_oak_frontend_adapter::format_cst_diagnostics(&parsed.diagnostics)
        ));
    }
    let (formatted, deletions) = erase_types_with_deletions(source)?;
    let (code, segments) = if options.minify {
        minify_tokens(source, &deletions)?
    } else {
        let segments = erased_line_segments(source, &deletions, &formatted);
        (formatted, segments)
    };
    let map = options.source_map_path.as_ref().map(|_| {
        source_map_json(filename, &[filename.to_string()], &[source.to_string()], &segments)
    });
    Ok(EmittedJs { code, map })
}

/// Minify from Oak lexer tokens, keeping string, template, regex and comment
/// semantics intact.
///
/// Boundaries: tokens are emitted as their original source slices (strings,
/// template literals and regex bodies are never rewritten), comments are
/// dropped, indentation and redundant spaces disappear, and line breaks are
/// only kept where automatic semicolon insertion or a restricted production
/// could observe them (`return`/`throw`/`break`/`continue`/`yield`, postfix
/// `++`/`--`, and a following line that starts with a continuation token).
/// This does not do identifier renaming, dead-code elimination or statement
/// folding.
fn minify_tokens(
    source: &str,
    deletions: &[(usize, usize)],
) -> Result<(String, Vec<SourceMapSegment>), String> {
    let text = SourceText::new(source);
    let language = TypeScriptLanguage::default();
    let lexer = TypeScriptLexer::new(&language);
    let mut cache = NoLexerCache;
    let tokens = lexer
        .lex(&text, &[], &mut cache)
        .result
        .map_err(|error| format!("Oak TypeScript lexer failed: {error:?}"))?;

    let mut out = String::with_capacity(source.len());
    let mut line = 0u32;
    let mut col = 0u32;
    let mut segments = Vec::new();
    let source_lines = SourceLines::new(source);
    let mut prev: Option<(T, usize, usize)> = None;

    for token in tokens.iter() {
        if matches!(token.kind, T::Whitespace | T::Newline | T::LineComment | T::BlockComment) {
            continue;
        }
        if token.kind == T::Eof {
            break;
        }
        if token.kind == T::Error {
            return Err(format!("Oak TypeScript lexer rejected byte offset {}", token.span.start));
        }
        for (start, end) in kept_fragments(token.span.start, token.span.end, deletions) {
            let fragment = &source[start..end];
            if let Some((prev_kind, prev_start, prev_end)) = prev {
                let gap = &source[prev_end..start];
                let separator = separator(prev_kind, &source[prev_start..prev_end], fragment, gap);
                push_text(&mut out, &mut line, &mut col, separator);
            }
            let (src_line, src_col) = source_lines.line_col(start);
            segments.push(SourceMapSegment {
                gen_line: line,
                gen_col: col,
                src_index: 0,
                src_line,
                src_col,
            });
            push_text(&mut out, &mut line, &mut col, fragment);
            prev = Some((token.kind, start, end));
        }
    }
    Ok((out, segments))
}

/// Split a token span into the byte ranges that survive type erasure.
fn kept_fragments(start: usize, end: usize, deletions: &[(usize, usize)]) -> Vec<(usize, usize)> {
    let mut ranges = vec![(start, end)];
    for &(delete_start, delete_end) in deletions {
        if delete_end <= start || delete_start >= end {
            continue;
        }
        let mut next = Vec::with_capacity(ranges.len() + 1);
        for (range_start, range_end) in ranges {
            if delete_end <= range_start || delete_start >= range_end {
                next.push((range_start, range_end));
                continue;
            }
            if range_start < delete_start {
                next.push((range_start, delete_start));
            }
            if delete_end < range_end {
                next.push((delete_end, range_end));
            }
        }
        ranges = next;
    }
    ranges.into_iter().filter(|(range_start, range_end)| range_end > range_start).collect()
}

fn separator(prev_kind: T, prev_text: &str, next_text: &str, gap: &str) -> &'static str {
    if gap.contains('\n') && keeps_newline(prev_kind, prev_text, next_text) {
        return "\n";
    }
    if needs_space(prev_kind, prev_text, next_text) { " " } else { "" }
}

/// Keep line breaks that automatic semicolon insertion can observe.
fn keeps_newline(prev_kind: T, prev_text: &str, next_text: &str) -> bool {
    let next = next_text.chars().next().unwrap_or(' ');
    // A line that starts with these tokens continues the previous expression.
    if matches!(next, '(' | '[' | '+' | '-' | '/' | '`' | '.' | '?' | '*') {
        return true;
    }
    // Restricted productions end only at the line break.
    if matches!(prev_kind, T::Return | T::Throw | T::Break | T::Continue | T::Yield | T::Async) {
        return true;
    }
    if prev_text.ends_with("++") || prev_text.ends_with("--") {
        return true;
    }
    // Any token that can end a statement keeps its line break, everything else
    // (operators, braces, separators, infix keywords) continues safely.
    !is_statement_end(prev_kind)
}

fn is_statement_end(kind: T) -> bool {
    matches!(
        kind,
        T::IdentifierName
            | T::NumericLiteral
            | T::BigIntLiteral
            | T::StringLiteral
            | T::BooleanLiteral
            | T::TemplateString
            | T::RegexLiteral
            | T::This
            | T::Super
            | T::True
            | T::False
            | T::Null
            | T::RightParen
            | T::RightBracket
            | T::RightBrace
    )
}

/// Whether two adjacent token texts must stay separated to keep lexing stable.
fn needs_space(prev_kind: T, prev_text: &str, next_text: &str) -> bool {
    let (Some(prev), Some(next)) = (prev_text.chars().last(), next_text.chars().next()) else {
        return false;
    };
    if prev_kind == T::RegexLiteral && (is_identifier_char(next) || next.is_ascii_digit()) {
        return true;
    }
    if is_identifier_char(prev) && is_identifier_char(next) {
        return true;
    }
    match (prev, next) {
        ('+', '+') | ('-', '-') => true,
        ('/', '/' | '*') | ('*', '/') => true,
        ('<', '!') => true,
        ('>', '>') => true,
        ('?', '.') => true,
        ('.', '0'..='9') => true,
        _ => prev_kind == T::NumericLiteral && next == '.',
    }
}

fn is_identifier_char(ch: char) -> bool {
    ch.is_alphanumeric() || ch == '_' || ch == '$'
}

fn push_text(out: &mut String, line: &mut u32, col: &mut u32, text: &str) {
    for ch in text.chars() {
        if ch == '\n' {
            *line += 1;
            *col = 0;
        } else {
            *col += ch.len_utf16() as u32;
        }
    }
    out.push_str(text);
}

/// Map generated offsets of the erased output back to original line starts.
fn erased_line_segments(
    source: &str,
    deletions: &[(usize, usize)],
    erased: &str,
) -> Vec<SourceMapSegment> {
    let source_lines = SourceLines::new(source);
    let mut segments = Vec::new();
    let mut offset = 0usize;
    for (index, generated) in erased.split('\n').enumerate() {
        let original = map_erased_offset(offset, deletions);
        let (src_line, src_col) = source_lines.line_col(original);
        segments.push(SourceMapSegment {
            gen_line: index as u32,
            gen_col: 0,
            src_index: 0,
            src_line,
            src_col,
        });
        offset += generated.len() + 1;
    }
    segments
}

/// Translate an offset in the erased output to the original source.
///
/// Offsets inside a deleted range map to the end of that range.
pub fn map_erased_offset(offset: usize, deletions: &[(usize, usize)]) -> usize {
    let mut removed = 0usize;
    for &(start, end) in deletions {
        let length = end - start;
        if offset + removed >= end {
            removed += length;
        } else if offset + removed >= start {
            return end;
        } else {
            break;
        }
    }
    offset + removed
}

/// Line index over a source text; columns are counted in UTF-16 units.
pub struct SourceLines<'a> {
    source: &'a str,
    starts: Vec<usize>,
}

impl<'a> SourceLines<'a> {
    /// Index the line starts of `source`.
    pub fn new(source: &'a str) -> Self {
        let mut starts = vec![0usize];
        for (index, byte) in source.bytes().enumerate() {
            if byte == b'\n' {
                starts.push(index + 1);
            }
        }
        Self { source, starts }
    }

    /// Line and UTF-16 column of a byte offset (clamped to the source end).
    pub fn line_col(&self, offset: usize) -> (u32, u32) {
        let offset = offset.min(self.source.len());
        let line = self.starts.partition_point(|&start| start <= offset) - 1;
        let column =
            self.source[self.starts[line]..offset].chars().map(|ch| ch.len_utf16() as u32).sum();
        (line as u32, column)
    }
}

/// Emit a source map v3 document over one or more sources.
///
/// Segments must be sorted by `(gen_line, gen_col)`; the `src_index` field
/// selects the entry in `sources` / `sources_content` (adjacent deltas are
/// encoded into `mappings`).
pub fn source_map_json(
    file: &str,
    sources: &[String],
    sources_content: &[String],
    segments: &[SourceMapSegment],
) -> String {
    let mut mappings = String::new();
    let last_line = segments.last().map_or(0, |segment| segment.gen_line);
    let mut index = 0usize;
    let mut prev_src_line = 0i64;
    let mut prev_src_col = 0i64;
    let mut prev_src_index = 0i64;
    for line in 0..=last_line {
        if line > 0 {
            mappings.push(';');
        }
        let mut prev_gen_col = 0i64;
        let mut first = true;
        while index < segments.len() && segments[index].gen_line == line {
            let segment = &segments[index];
            if !first {
                mappings.push(',');
            }
            first = false;
            mappings.push_str(&vlq(segment.gen_col as i64 - prev_gen_col));
            mappings.push_str(&vlq(segment.src_index as i64 - prev_src_index));
            mappings.push_str(&vlq(segment.src_line as i64 - prev_src_line));
            mappings.push_str(&vlq(segment.src_col as i64 - prev_src_col));
            prev_gen_col = segment.gen_col as i64;
            prev_src_index = segment.src_index as i64;
            prev_src_line = segment.src_line as i64;
            prev_src_col = segment.src_col as i64;
            index += 1;
        }
    }
    serde_json::json!({
        "version": 3,
        "file": file,
        "sources": sources,
        "sourcesContent": sources_content,
        "names": [],
        "mappings": mappings,
    })
    .to_string()
}

fn vlq(value: i64) -> String {
    const BASE64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut value = if value < 0 { ((-value) as u64) << 1 | 1 } else { (value as u64) << 1 };
    let mut out = String::new();
    loop {
        let mut digit = (value & 0x1f) as usize;
        value >>= 5;
        if value > 0 {
            digit |= 0x20;
        }
        out.push(BASE64[digit] as char);
        if value == 0 {
            break;
        }
    }
    out
}
