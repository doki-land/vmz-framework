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

/// Minify an already type-erased JavaScript text (pack stage), returning the
/// compact text plus token segments mapping generated positions back to
/// positions in the original text.
///
/// Callers that already erased TypeScript syntax pass no deletions. Token
/// boundaries are the same contract as [`print_js_source`]'s minify path:
/// identifier renaming, dead-code elimination and statement folding are not
/// performed.
pub fn minify_source(source: &str) -> Result<(String, Vec<SourceMapSegment>), String> {
    minify_tokens(source, &[])
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
    // 测试期探针按「一次压缩」武装：只判定单次调用是否重复扫描。
    #[cfg(test)]
    scan_probe::arm(source.len());
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
    let mut cursor = PositionCursor::new(source);
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
            let (src_line, src_col) = cursor.advance_to(start);
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

#[cfg(test)]
mod scan_probe {
    use std::cell::Cell;

    thread_local! {
        /// `Some(源长度)` = 守卫已武装，累计扫描超过该长度即判定重复扫描。
        static LIMIT: Cell<Option<usize>> = const { Cell::new(None) };
        /// 本次武装期间实际遍历过的字符数。
        static SCANNED: Cell<usize> = const { Cell::new(0) };
    }

    /// 武装探针：`len` 为源文本字符数。
    pub(super) fn arm(len: usize) {
        LIMIT.with(|limit| limit.set(Some(len)));
        SCANNED.with(|scanned| scanned.set(0));
    }

    /// 关闭探针并返回本次累计的扫描字符数。
    pub(super) fn disarm() -> usize {
        LIMIT.with(|limit| limit.set(None));
        SCANNED.with(|scanned| scanned.replace(0))
    }

    /// 记录一次位置定位实际遍历过的字符数。
    ///
    /// 超出源长度立即失败：平方级的 `line_col` 实现会很快触发，
    /// 不必等它把整份文本重复扫上几分钟。
    pub(super) fn record(visited: usize) {
        SCANNED.with(|scanned| scanned.set(scanned.get() + visited));
        if let Some(limit) = LIMIT.with(Cell::get) {
            let total = SCANNED.with(Cell::get);
            assert!(
                total <= limit,
                "source map positions rescanned the source: {total} chars for a {limit}-char source"
            );
        }
    }
}

/// 顺序读取源文本位置：token 起点单调递增，整趟只扫一遍字节。
///
/// 不能用 [`SourceLines::line_col`]：它会从行首 `chars()` 数到目标偏移，
/// 遇到单行超长文本（例如内联的大 JSON 数据）就是 O(行长度 × token 数)。
struct PositionCursor<'a> {
    source: &'a str,
    offset: usize,
    line: u32,
    col: u32,
}

impl<'a> PositionCursor<'a> {
    fn new(source: &'a str) -> Self {
        Self { source, offset: 0, line: 0, col: 0 }
    }

    /// 前进到 `target`（调用方保证单调不减），返回该处的行与 UTF-16 列。
    fn advance_to(&mut self, target: usize) -> (u32, u32) {
        let target = target.min(self.source.len());
        #[cfg(test)]
        let mut visited = 0usize;
        for ch in self.source[self.offset..target].chars() {
            #[cfg(test)]
            {
                visited += 1;
            }
            if ch == '\n' {
                self.line += 1;
                self.col = 0;
            } else {
                self.col += ch.len_utf16() as u32;
            }
        }
        #[cfg(test)]
        scan_probe::record(visited);
        self.offset = target;
        (self.line, self.col)
    }
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
    // A token that can end a statement keeps its line break: without one, ASI
    // no longer applies and two statements would merge into invalid syntax
    // (the classic case is a semicolon-free `import … from "x"` followed by
    // another statement). Operators and braces that cannot end a statement
    // continue safely on the same line.
    ends_statement(prev_kind, prev_text)
}

/// Whether the previous token can end a statement.
///
/// Contextual keywords (`unknown`, `string`, `from`, …) lex as keyword kinds
/// but are plain identifiers in expression position, so the token text is the
/// reliable signal for them.
fn ends_statement(kind: T, text: &str) -> bool {
    if is_statement_end(kind) {
        return true;
    }
    matches!(
        text.chars().last(),
        Some(ch) if is_identifier_char(ch) || ch == '"' || ch == '\'' || ch == '`'
    )
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
        let mut column = 0u32;
        #[cfg(test)]
        let mut visited = 0usize;
        for ch in self.source[self.starts[line]..offset].chars() {
            column += ch.len_utf16() as u32;
            #[cfg(test)]
            {
                visited += 1;
            }
        }
        // 从行首重新数到目标偏移：逐 token 调用就是平方级。探针在此记录，
        // 让守卫能在退回该写法时立刻失败。
        #[cfg(test)]
        scan_probe::record(visited);
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

#[cfg(test)]
mod tests {
    use super::{minify_source, scan_probe};

    /// 合成输入的 token 数量级与内联大数据的真实产物一致（数万 token）。
    const NUMBERS: usize = 37_000;
    /// 尾部允许未被扫描的字符数（最后一个 token 之后的部分）。
    const TAIL_CHARS: usize = 64;

    fn single_line_payload() -> String {
        let mut source = String::with_capacity(200 * 1024);
        source.push_str("const data=[");
        for index in 0..NUMBERS {
            if index > 0 {
                source.push(',');
            }
            source.push_str(&index.to_string());
        }
        source.push_str("];");
        source
    }

    /// 回归守卫：单行超长文本的压缩只做一遍位置扫描。
    ///
    /// 这不是性能基准，也不设墙钟阈值：判据是可数的内部工作量。旧的
    /// `SourceLines::line_col` 对每个 token 都从行首重新数一遍，扫描字符数
    /// 是 O(行长度 × token 数)，一旦退回这种写法就会超过源长度若干数量级。
    /// 探针在累计扫描超过源长度时立即失败。
    #[test]
    fn minify_positions_scan_single_line_source_once() {
        let source = single_line_payload();
        assert!(!source.contains('\n'), "守卫输入必须是单行文本");
        let source_bytes = source.len();
        let source_chars = source.chars().count();
        assert!(source_bytes > 180 * 1024, "合成输入应接近 200KB，实际 {source_bytes} 字节");

        let (code, segments) = minify_source(&source).expect("合成输入必须能压缩");
        let scanned = scan_probe::disarm();

        // 输出断言：压缩必须真的发生，而不是跳过压缩后原样返回。
        assert_eq!(code, source, "压缩结果与预期不一致");
        assert!(segments.len() > 70_000, "合成输入应有可比数量的 token，实际 {}", segments.len());

        assert!(
            scanned <= source_chars,
            "位置定位重复扫描：{scanned} 字符 / 源文本 {source_chars} 字符"
        );
        assert!(
            scanned + TAIL_CHARS >= source_chars,
            "位置游标没有走到文本末尾：{scanned} 字符 / 源文本 {source_chars} 字符"
        );
    }
}
