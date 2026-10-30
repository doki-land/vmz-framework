//! TypeScript type erasure over the Oak TypeScript lexer token stream.
//!
//! Oak's TypeScript parser does not materialize class member annotations,
//! parameter annotations or return types as CST/AST nodes, so those ranges
//! cannot be removed through syntax-node spans. Erasure therefore runs on
//! lexer tokens: it deletes type-only ranges and keeps every other source byte,
//! which preserves formatting, comments and line numbering.

use oak_core::{Lexer, NoLexerCache, SourceText};
use oak_typescript::{TypeScriptLanguage, TypeScriptLexer, TypeScriptTokenType as T};

/// A significant (non-trivia) lexer token.
#[derive(Clone, Copy)]
struct Token {
    kind: T,
    start: usize,
    end: usize,
}

/// Removed type range.
struct TypeSpan {
    /// Index of the first token after the type.
    next: usize,
    /// Byte offset where the type ends.
    end: usize,
}

/// One `{ ... }` import / export specifier list with inline `type` specifiers
/// removed.
struct SpecifierList {
    /// Token index of the closing `}`.
    close: usize,
    /// Whether at least one inline type specifier was removed.
    removed: bool,
    /// Number of specifiers left in the list.
    remaining: usize,
}

/// One specifier between two commas of an import / export list.
#[derive(Clone, Copy)]
struct SpecItem {
    first: usize,
    last: usize,
    /// Token index of the comma before the specifier.
    leading_comma: Option<usize>,
    /// Token index of the comma after the specifier.
    trailing_comma: Option<usize>,
}

#[derive(Clone, Copy)]
enum FrameKind {
    ClassBody,
    Block,
    ObjectLiteral,
    Params,
    Paren,
    Bracket,
}

struct Frame {
    kind: FrameKind,
    /// Number of `?` tokens still waiting for their `:` in a ternary.
    ternary: usize,
}

/// Erase TypeScript-only syntax from `source` and return JavaScript.
///
/// Returns an error for syntax that cannot be erased without changing runtime
/// behavior, such as `enum`, `namespace`, `declare module` and `declare global`.
pub fn erase_types(source: &str) -> Result<String, String> {
    Ok(erase_types_with_deletions(source)?.0)
}

/// Erase TypeScript syntax and report the removed byte ranges.
///
/// The ranges are sorted and merged, so they can be used to map erased output
/// offsets back to the original source and to keep the minifier from emitting
/// type-only tokens.
pub fn erase_types_with_deletions(
    source: &str,
) -> Result<(String, Vec<(usize, usize)>), String> {
    let text = SourceText::new(source);
    let language = TypeScriptLanguage::default();
    let lexer = TypeScriptLexer::new(&language);
    let mut cache = NoLexerCache;
    let lexed = lexer.lex(&text, &[], &mut cache);
    let tokens = lexed.result.map_err(|error| format!("Oak TypeScript lexer failed: {error:?}"))?;
    let mut significant = Vec::with_capacity(tokens.len());
    for token in tokens.iter() {
        if is_trivia(token.kind) {
            continue;
        }
        if token.kind == T::Eof {
            break;
        }
        if token.kind == T::Error {
            return Err(format!("Oak TypeScript lexer rejected byte offset {}", token.span.start));
        }
        significant.push(Token { kind: token.kind, start: token.span.start, end: token.span.end });
    }
    Eraser { source, tokens: significant, deletions: Vec::new() }.run()
}
struct Eraser<'a> {
    source: &'a str,
    tokens: Vec<Token>,
    deletions: Vec<(usize, usize)>,
}

impl<'a> Eraser<'a> {
    fn run(mut self) -> Result<(String, Vec<(usize, usize)>), String> {
        let mut frames: Vec<Frame> = Vec::new();
        let mut pending_class = false;
        let mut var_decl_depth: Option<usize> = None;
        let mut case_head = false;
        let mut root_ternary = 0usize;
        let mut i = 0usize;
        while i < self.tokens.len() {
            let token = self.tokens[i];
            let prev = i.checked_sub(1).map(|index| self.tokens[index].kind);
            let frame = frames.last().map(|frame| frame.kind);
            if let Some(depth) = var_decl_depth {
                if depth >= frames.len() && i > 0 {
                    let previous = self.tokens[i - 1];
                    if self.has_newline(previous.end, token.start)
                        && ends_statement(previous.kind)
                        && !continues_expression(token.kind)
                    {
                        var_decl_depth = None;
                    }
                }
            }
            match token.kind {
                T::Semicolon => {
                    if var_decl_depth.is_some_and(|depth| depth >= frames.len()) {
                        var_decl_depth = None;
                    }
                    case_head = false;
                    i += 1;
                }
                T::Case | T::Default => {
                    case_head = true;
                    i += 1;
                }
                T::Import => {
                    if self.kind(i + 1) == Some(T::Type) {
                        let end = self.statement_end(i);
                        self.delete_to(i, end);
                        i = end;
                        continue;
                    }
                    if let Some(open) = self.import_specifier_brace(i) {
                        let list = self.erase_specifier_list(open)?;
                        let clause_binding = self.tokens[i + 1..open]
                            .iter()
                            .any(|token| matches!(token.kind, T::IdentifierName | T::Star));
                        if list.removed && list.remaining == 0 && !clause_binding {
                            let end = self.statement_end(i);
                            self.delete_to(i, end);
                            i = end;
                            continue;
                        }
                        i = list.close + 1;
                        continue;
                    }
                    i += 1;
                }
                T::Export => {
                    if self.kind(i + 1) == Some(T::LeftBrace) {
                        let list = self.erase_specifier_list(i + 1)?;
                        if list.removed && list.remaining == 0 {
                            let end = self.statement_end(i);
                            self.delete_to(i, end);
                            i = end;
                            continue;
                        }
                        i = list.close + 1;
                        continue;
                    }
                    i += 1;
                }
                T::Interface => {
                    let statement_start = matches!(
                        prev,
                        None | Some(
                            T::Semicolon | T::LeftBrace | T::RightBrace | T::Export | T::Default
                        )
                    );
                    if !statement_start {
                        i += 1;
                        continue;
                    }
                    let start = if prev == Some(T::Export) {
                        self.tokens[i - 1].start
                    } else {
                        token.start
                    };
                    let Some(body) = self.find_body_brace(i + 1) else {
                        return Err("type erasure cannot find an `interface` body to remove".into());
                    };
                    let Some(close) = self.matching(body) else {
                        return Err("type erasure found an unterminated `interface` body".into());
                    };
                    self.delete(start, self.tokens[close].end);
                    i = close + 1;
                }
                T::Type => {
                    let alias = matches!(self.kind(i + 1), Some(T::IdentifierName));
                    let reexport = self.kind(i + 1) == Some(T::LeftBrace);
                    if !alias && !reexport {
                        i += 1;
                        continue;
                    }
                    let start = if prev == Some(T::Export) {
                        self.tokens[i - 1].start
                    } else {
                        token.start
                    };
                    let end = if reexport {
                        self.statement_end(i)
                    } else {
                        let Some(equal) = (i + 1..self.tokens.len()).find(|&index| {
                            matches!(
                                self.tokens[index].kind,
                                T::Equal | T::Semicolon | T::LeftBrace
                            )
                        }) else {
                            i += 1;
                            continue;
                        };
                        if self.tokens[equal].kind != T::Equal {
                            i += 1;
                            continue;
                        }
                        match self.type_end(equal + 1, false) {
                            Some(span) if self.kind(span.next) == Some(T::Semicolon) => {
                                span.next + 1
                            }
                            Some(span) => span.next,
                            None => equal + 1,
                        }
                    };
                    let end_byte = if end == 0 { token.end } else { self.tokens[end - 1].end };
                    self.delete(start, end_byte);
                    i = end;
                }
                T::Declare => {
                    let statement_start = matches!(
                        prev,
                        None | Some(T::Semicolon | T::LeftBrace | T::RightBrace | T::Export)
                    );
                    let declares = matches!(
                        self.kind(i + 1),
                        Some(
                            T::IdentifierName
                                | T::StringLiteral
                                | T::Class
                                | T::Function
                                | T::Const
                                | T::Let
                                | T::Var
                                | T::Namespace
                                | T::Global
                        )
                    );
                    if statement_start && declares {
                        let namespace = matches!(self.kind(i + 1), Some(T::Namespace | T::Global))
                            || self.text(i + 1) == Some("module");
                        if namespace {
                            return Err(
                                "type erasure does not support `declare` module or namespace declarations"
                                    .into(),
                            );
                        }
                        let end = self.statement_end(i);
                        self.delete_to(i, end);
                        i = end;
                        continue;
                    }
                    i += 1;
                }
                T::Enum | T::Namespace => {
                    let statement_start = matches!(
                        prev,
                        None | Some(
                            T::Semicolon | T::LeftBrace | T::RightBrace | T::Export | T::Declare
                        )
                    );
                    let declares =
                        matches!(self.kind(i + 1), Some(T::IdentifierName | T::StringLiteral));
                    if statement_start && declares {
                        let keyword = if token.kind == T::Enum { "enum" } else { "namespace" };
                        return Err(format!(
                            "type erasure does not support `{keyword}` declarations"
                        ));
                    }
                    i += 1;
                }
                T::Class => {
                    pending_class = true;
                    i += 1;
                }
                T::Implements => {
                    let header = pending_class
                        || matches!(
                            prev,
                            Some(T::IdentifierName | T::RightParen | T::RightBrace | T::Greater)
                        );
                    if !header {
                        i += 1;
                        continue;
                    }
                    let brace = (i + 1..self.tokens.len())
                        .find(|&index| self.tokens[index].kind == T::LeftBrace);
                    if let Some(brace) = brace {
                        let interrupted = self.tokens[i + 1..brace]
                            .iter()
                            .any(|token| matches!(token.kind, T::Semicolon | T::RightBrace));
                        if !interrupted {
                            self.delete(token.start, self.tokens[brace].start);
                            i = brace;
                            continue;
                        }
                    }
                    i += 1;
                }
                T::LeftBrace => {
                    let kind = if pending_class {
                        pending_class = false;
                        FrameKind::ClassBody
                    } else if is_object_literal_brace(prev) {
                        FrameKind::ObjectLiteral
                    } else {
                        FrameKind::Block
                    };
                    frames.push(Frame { kind, ternary: 0 });
                    case_head = false;
                    i += 1;
                }
                T::RightBrace => {
                    frames.pop();
                    if var_decl_depth.is_some_and(|depth| depth > frames.len()) {
                        var_decl_depth = None;
                    }
                    case_head = false;
                    i += 1;
                }
                T::LeftParen => {
                    let kind = if self.is_params_paren(i, prev) {
                        FrameKind::Params
                    } else {
                        FrameKind::Paren
                    };
                    frames.push(Frame { kind, ternary: 0 });
                    i += 1;
                }
                T::RightParen => {
                    if matches!(frame, Some(FrameKind::Params | FrameKind::Paren)) {
                        frames.pop();
                    }
                    i += 1;
                }
                T::LeftBracket => {
                    frames.push(Frame { kind: FrameKind::Bracket, ternary: 0 });
                    i += 1;
                }
                T::RightBracket => {
                    if matches!(frame, Some(FrameKind::Bracket)) {
                        frames.pop();
                    }
                    i += 1;
                }
                T::Less => {
                    let adjacent = i > 0
                        && self.tokens[i - 1].kind == T::IdentifierName
                        && self.tokens[i - 1].end == token.start;
                    let Some(close) = self.matching_angle(i) else {
                        i += 1;
                        continue;
                    };
                    let continues = matches!(
                        self.kind(close + 1),
                        Some(T::LeftParen | T::LeftBrace | T::Extends | T::Implements)
                    );
                    if adjacent && continues {
                        self.delete(token.start, self.tokens[close].end);
                        i = close + 1;
                        continue;
                    }
                    i += 1;
                }
                T::Colon => {
                    if case_head {
                        case_head = false;
                        i += 1;
                        continue;
                    }
                    if let Some(frame) = frames.last_mut() {
                        if frame.ternary > 0 {
                            frame.ternary -= 1;
                            i += 1;
                            continue;
                        }
                    } else if root_ternary > 0 {
                        root_ternary -= 1;
                        i += 1;
                        continue;
                    }
                    let in_var_decl = var_decl_depth == Some(frames.len());
                    if self.is_annotation_position(prev, frame, in_var_decl) {
                        if let Some(span) = self.type_end(i + 1, false) {
                            self.delete(token.start, span.end);
                            i = span.next;
                            continue;
                        }
                    }
                    i += 1;
                }
                T::Question => {
                    let next = self.kind(i + 1);
                    let member = matches!(frame, Some(FrameKind::ClassBody));
                    let params = matches!(frame, Some(FrameKind::Params));
                    let optional = if can_end_binding(prev.unwrap_or(T::Eof)) && (member || params)
                    {
                        match next {
                            Some(
                                T::Colon
                                | T::Comma
                                | T::RightParen
                                | T::Equal
                                | T::Semicolon
                                | T::LeftBrace,
                            ) => true,
                            Some(T::LeftParen) if member => self
                                .matching(i + 1)
                                .and_then(|close| self.kind(close + 1))
                                .is_some_and(|kind| {
                                    matches!(kind, T::Colon | T::LeftBrace | T::Semicolon)
                                }),
                            _ => false,
                        }
                    } else {
                        false
                    };
                    if optional {
                        self.delete_token(i);
                        i += 1;
                        continue;
                    }
                    if let Some(frame) = frames.last_mut() {
                        frame.ternary += 1;
                    } else {
                        root_ternary += 1;
                    }
                    i += 1;
                }
                T::Exclamation => {
                    let next = self.kind(i + 1);
                    let postfix = ends_expression(prev.unwrap_or(T::Eof))
                        && next.map_or(true, is_after_non_null);
                    if postfix {
                        self.delete_token(i);
                    }
                    i += 1;
                }
                T::As => {
                    let cast = ends_expression(prev.unwrap_or(T::Eof)) && !self.in_import_clause(i);
                    if cast {
                        if let Some(span) = self.type_end(i + 1, true) {
                            self.delete(self.space_trimmed_start(i), span.end);
                            i = span.next;
                            continue;
                        }
                    }
                    i += 1;
                }
                T::Public | T::Private | T::Protected | T::Readonly | T::Abstract | T::Override => {
                    let name_like = self.kind(i + 1).is_some_and(|kind| {
                        matches!(
                            kind,
                            T::IdentifierName
                                | T::StringLiteral
                                | T::NumericLiteral
                                | T::LeftBracket
                                | T::Star
                        ) || is_member_name_keyword(kind)
                    });
                    let property_access = matches!(prev, Some(T::Dot | T::QuestionDot));
                    if name_like && !property_access {
                        self.delete_token(i);
                    }
                    i += 1;
                }
                T::Const | T::Let | T::Var => {
                    var_decl_depth = Some(frames.len());
                    i += 1;
                }
                _ => i += 1,
            }
        }
        Ok(self.apply())
    }

    fn apply(mut self) -> (String, Vec<(usize, usize)>) {
        self.deletions.sort_unstable();
        let mut out = String::with_capacity(self.source.len());
        let mut merged: Vec<(usize, usize)> = Vec::with_capacity(self.deletions.len());
        let mut cursor = 0usize;
        for (start, end) in self.deletions {
            let start = start.max(cursor).min(self.source.len());
            let end = end.max(start).min(self.source.len());
            if start > cursor {
                out.push_str(&self.source[cursor..start]);
            }
            if end > start {
                if let Some(last) = merged.last_mut()
                    && last.1 >= start
                {
                    last.1 = last.1.max(end);
                } else {
                    merged.push((start, end));
                }
            }
            cursor = end;
        }
        if cursor < self.source.len() {
            out.push_str(&self.source[cursor..]);
        }
        (out, merged)
    }

    fn kind(&self, index: usize) -> Option<T> {
        self.tokens.get(index).map(|token| token.kind)
    }

    fn text(&self, index: usize) -> Option<&'a str> {
        let token = self.tokens.get(index)?;
        self.source.get(token.start..token.end)
    }

    fn has_newline(&self, from: usize, to: usize) -> bool {
        self.source.get(from..to).is_some_and(|slice| slice.contains('\n'))
    }

    fn space_trimmed_start(&self, index: usize) -> usize {
        let start = self.tokens[index].start;
        if index == 0 {
            return start;
        }
        let prev_end = self.tokens[index - 1].end;
        if self.has_newline(prev_end, start) {
            return start;
        }
        let bytes = self.source.as_bytes();
        let mut trimmed = start;
        while trimmed > prev_end && matches!(bytes[trimmed - 1], b' ' | b'\t') {
            trimmed -= 1;
        }
        trimmed
    }

    fn delete(&mut self, start: usize, end: usize) {
        if end > start {
            self.deletions.push((start, end));
        }
    }

    fn delete_token(&mut self, index: usize) {
        let token = self.tokens[index];
        let end = match self.tokens.get(index + 1) {
            Some(next) if !self.has_newline(token.end, next.start) => next.start,
            _ => token.end,
        };
        self.delete(token.start, end);
    }

    fn delete_to(&mut self, start: usize, end: usize) {
        if end > start {
            self.delete(self.tokens[start].start, self.tokens[end - 1].end);
        }
    }

    fn matching(&self, open: usize) -> Option<usize> {
        let (left, right) = match self.tokens[open].kind {
            T::LeftBrace => (T::LeftBrace, T::RightBrace),
            T::LeftParen => (T::LeftParen, T::RightParen),
            T::LeftBracket => (T::LeftBracket, T::RightBracket),
            _ => return None,
        };
        let mut depth = 0usize;
        for index in open..self.tokens.len() {
            let kind = self.tokens[index].kind;
            if kind == left {
                depth += 1;
            } else if kind == right {
                depth -= 1;
                if depth == 0 {
                    return Some(index);
                }
            }
        }
        None
    }

    fn matching_angle(&self, open: usize) -> Option<usize> {
        let mut depth = 0usize;
        for index in open..self.tokens.len() {
            match self.tokens[index].kind {
                T::Less => depth += 1,
                T::Greater => {
                    if depth == 0 {
                        return None;
                    }
                    depth -= 1;
                    if depth == 0 {
                        return Some(index);
                    }
                }
                T::RightShift if depth >= 2 => depth -= 2,
                T::RightShift if depth == 1 => return Some(index),
                T::Semicolon | T::RightBrace => return None,
                _ => {}
            }
        }
        None
    }

    fn find_body_brace(&self, from: usize) -> Option<usize> {
        (from..self.tokens.len()).find(|&index| matches!(self.tokens[index].kind, T::LeftBrace))
    }

    fn is_params_paren(&self, open: usize, prev: Option<T>) -> bool {
        let Some(close) = self.matching(open) else {
            return false;
        };
        let Some(after) = self.kind(close + 1) else {
            return false;
        };
        let head = matches!(after, T::LeftBrace | T::Arrow | T::Colon);
        if !head {
            return false;
        }
        let caller = matches!(
            prev,
            Some(
                T::IdentifierName
                    | T::RightParen
                    | T::Constructor
                    | T::Catch
                    | T::Function
                    | T::Get
                    | T::Set
                    | T::Static
                    | T::Async
                    | T::Star
                    | T::Equal
                    | T::Comma
                    | T::LeftParen
                    | T::Return
                    | T::Question
                    | T::Colon
                    | T::Arrow
                    | T::Default
                    | T::Export
                    | T::DotDotDot
                    | T::Greater
            )
        );
        caller || after == T::Arrow
    }

    fn is_annotation_position(
        &self,
        prev: Option<T>,
        frame: Option<FrameKind>,
        in_var_decl: bool,
    ) -> bool {
        let Some(prev) = prev else {
            return false;
        };
        let keyword_member = matches!(frame, Some(FrameKind::ClassBody | FrameKind::Params))
            && is_member_name_keyword(prev);
        if !can_end_binding(prev) && !keyword_member {
            return false;
        }
        if prev == T::RightParen {
            return true;
        }
        match frame {
            Some(FrameKind::ClassBody | FrameKind::Params) => true,
            Some(FrameKind::Block) | None => in_var_decl,
            Some(FrameKind::ObjectLiteral | FrameKind::Paren | FrameKind::Bracket) => false,
        }
    }

    /// Locate the `{ ... }` named-import list that follows `import` at `at`.
    ///
    /// Returns `None` for side-effect imports, namespace imports and dynamic
    /// `import(...)` / `import.meta` expressions.
    fn import_specifier_brace(&self, at: usize) -> Option<usize> {
        let mut index = at + 1;
        while index < self.tokens.len() {
            match self.tokens[index].kind {
                T::LeftBrace => return Some(index),
                T::IdentifierName | T::Comma | T::Star | T::As => index += 1,
                _ => return None,
            }
        }
        None
    }

    /// Remove inline `type` specifiers from the `{ ... }` list opened at `open`.
    ///
    /// Each `type X` / `type X as Y` specifier is deleted together with the
    /// comma after it, falling back to the comma before it for the last entry,
    /// so the remaining list keeps valid comma syntax at every position.
    fn erase_specifier_list(&mut self, open: usize) -> Result<SpecifierList, String> {
        let Some(close) = self.matching(open) else {
            return Err(format!(
                "type erasure found an unterminated import/export specifier list at byte {}",
                self.tokens[open].start
            ));
        };
        let mut items: Vec<SpecItem> = Vec::new();
        let mut leading: Option<usize> = None;
        let mut first = open + 1;
        let mut index = open + 1;
        while index < close {
            if self.tokens[index].kind == T::Comma {
                if index > first {
                    items.push(SpecItem {
                        first,
                        last: index - 1,
                        leading_comma: leading,
                        trailing_comma: Some(index),
                    });
                }
                leading = Some(index);
                first = index + 1;
            }
            index += 1;
        }
        if close > first {
            items.push(SpecItem {
                first,
                last: close - 1,
                leading_comma: leading,
                trailing_comma: None,
            });
        }
        let mut removed = false;
        let mut remaining = 0usize;
        for item in &items {
            if !self.is_inline_type_specifier(item.first, item.last)? {
                remaining += 1;
                continue;
            }
            let (start, end) = match (item.trailing_comma, item.leading_comma) {
                (Some(comma), _) => (self.tokens[item.first].start, self.tokens[comma].end),
                (None, Some(comma)) => (self.tokens[comma].start, self.tokens[item.last].end),
                (None, None) => (self.tokens[item.first].start, self.tokens[item.last].end),
            };
            self.check_splice(start, end)?;
            self.delete(start, end);
            removed = true;
        }
        Ok(SpecifierList { close, removed, remaining })
    }

    /// Decide whether the specifier spanning `first..=last` is inline type-only.
    fn is_inline_type_specifier(&self, first: usize, last: usize) -> Result<bool, String> {
        // A lone `type` entry imports the value named `type`.
        if self.tokens[first].kind != T::Type || first == last {
            return Ok(false);
        }
        match self.kind(first + 1) {
            Some(T::IdentifierName | T::StringLiteral) if first + 1 == last => Ok(true),
            Some(T::IdentifierName | T::StringLiteral)
                if self.kind(first + 2) == Some(T::As)
                    && matches!(
                        self.kind(first + 3),
                        Some(T::IdentifierName | T::StringLiteral)
                    )
                    && first + 3 == last =>
            {
                Ok(true)
            }
            // `import { type as local }` imports the value named `type`.
            Some(T::As) => Ok(false),
            _ => Err(format!(
                "type erasure cannot parse the import/export specifier at byte {}",
                self.tokens[first].start
            )),
        }
    }

    /// Reject removals that would glue the surrounding bytes into another token.
    fn check_splice(&self, start: usize, end: usize) -> Result<(), String> {
        let bytes = self.source.as_bytes();
        let before = start.checked_sub(1).and_then(|index| bytes.get(index)).copied();
        let after = bytes.get(end).copied();
        let ident = |byte: Option<u8>| {
            byte.is_some_and(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$'))
        };
        if ident(before) && ident(after) {
            return Err(format!(
                "type erasure cannot remove the inline type specifier at byte {start} without gluing identifiers"
            ));
        }
        if before == Some(b'/') && matches!(after, Some(b'/' | b'*')) {
            return Err(format!(
                "type erasure cannot remove the inline type specifier at byte {start} without gluing a comment"
            ));
        }
        Ok(())
    }

    fn in_import_clause(&self, at: usize) -> bool {
        let mut index = at;
        while index > 0 {
            index -= 1;
            match self.tokens[index].kind {
                T::LeftBrace => {
                    let before = index.checked_sub(1).map(|slot| self.tokens[slot].kind);
                    if matches!(before, Some(T::Import | T::Export)) {
                        return true;
                    }
                    let type_clause = before == Some(T::Type)
                        && index >= 2
                        && matches!(self.tokens[index - 2].kind, T::Import | T::Export);
                    return type_clause;
                }
                T::Semicolon | T::RightBrace => return false,
                T::Import | T::Export => {
                    let statement_start = index == 0
                        || matches!(
                            self.tokens[index - 1].kind,
                            T::Semicolon | T::LeftBrace | T::RightBrace
                        );
                    return statement_start;
                }
                _ => {}
            }
        }
        false
    }

    fn statement_end(&self, start: usize) -> usize {
        let mut paren = 0usize;
        let mut bracket = 0usize;
        let mut brace = 0usize;
        let mut index = start;
        while index < self.tokens.len() {
            let token = self.tokens[index];
            match token.kind {
                T::RightBrace if brace == 0 => return index,
                _ => {}
            }
            if paren == 0 && bracket == 0 && brace == 0 && index > start {
                let previous = self.tokens[index - 1];
                if self.has_newline(previous.end, token.start)
                    && ends_statement(previous.kind)
                    && !continues_expression(token.kind)
                {
                    return index;
                }
            }
            match token.kind {
                T::Semicolon if paren == 0 && bracket == 0 && brace == 0 => return index + 1,
                T::LeftParen => paren += 1,
                T::RightParen => paren = paren.saturating_sub(1),
                T::LeftBracket => bracket += 1,
                T::RightBracket => bracket = bracket.saturating_sub(1),
                T::LeftBrace => brace += 1,
                T::RightBrace => brace = brace.saturating_sub(1),
                _ => {}
            }
            index += 1;
        }
        self.tokens.len()
    }

    fn type_end(&self, start: usize, expr: bool) -> Option<TypeSpan> {
        if start >= self.tokens.len() {
            return None;
        }
        let type_start = self.tokens[start].kind;
        let mut paren = 0usize;
        let mut bracket = 0usize;
        let mut brace = 0usize;
        let mut angle = 0usize;
        let mut index = start;
        let mut last_end = 0usize;
        let mut consumed = false;
        while index < self.tokens.len() {
            let token = self.tokens[index];
            let depth_zero = paren == 0 && bracket == 0 && brace == 0 && angle == 0;
            if depth_zero && consumed {
                let previous = self.tokens[index - 1];
                if self.has_newline(previous.end, token.start)
                    && !continues_type(token.kind)
                    && !continues_expression(token.kind)
                {
                    break;
                }
                if is_type_terminator(token.kind, expr, type_start) {
                    break;
                }
            }
            match token.kind {
                T::LeftParen => paren += 1,
                T::RightParen => {
                    if paren == 0 {
                        break;
                    }
                    paren -= 1;
                }
                T::LeftBracket => bracket += 1,
                T::RightBracket => {
                    if bracket == 0 {
                        break;
                    }
                    bracket -= 1;
                }
                T::LeftBrace => {
                    let continues = index == start
                        || matches!(
                            self.tokens[index - 1].kind,
                            T::Pipe
                                | T::Ampersand
                                | T::Less
                                | T::Colon
                                | T::Comma
                                | T::LeftParen
                                | T::Question
                        );
                    if !continues && depth_zero {
                        break;
                    }
                    brace += 1;
                }
                T::RightBrace => {
                    if brace == 0 {
                        break;
                    }
                    brace -= 1;
                }
                T::Less => angle += 1,
                T::Greater => {
                    if angle == 0 {
                        break;
                    }
                    angle -= 1;
                }
                T::RightShift => {
                    if angle >= 2 {
                        angle -= 2;
                    } else if angle == 1 {
                        angle = 0;
                    } else {
                        break;
                    }
                }
                _ => {}
            }
            consumed = true;
            last_end = token.end;
            index += 1;
        }
        consumed.then_some(TypeSpan { next: index, end: last_end })
    }
}

fn is_trivia(kind: T) -> bool {
    matches!(kind, T::Whitespace | T::Newline | T::LineComment | T::BlockComment)
}

fn is_object_literal_brace(prev: Option<T>) -> bool {
    matches!(
        prev,
        Some(
            T::Equal
                | T::LeftParen
                | T::Comma
                | T::Colon
                | T::LeftBracket
                | T::Return
                | T::Question
                | T::DotDotDot
                | T::AmpersandAmpersand
                | T::PipePipe
                | T::QuestionQuestion
        )
    )
}

fn is_type_terminator(kind: T, expr: bool, type_start: T) -> bool {
    match kind {
        T::Comma | T::Semicolon | T::Equal => true,
        T::Arrow => !matches!(type_start, T::LeftParen | T::New),
        T::Question | T::Colon => expr,
        T::Plus | T::Minus | T::Star | T::Slash | T::Percent => expr,
        T::EqualEqual | T::NotEqual | T::EqualEqualEqual | T::NotEqualEqual => expr,
        T::AmpersandAmpersand | T::PipePipe | T::QuestionQuestion => expr,
        T::LessEqual | T::GreaterEqual => expr,
        // `as A | null` / `as A & B` are casts to union / intersection types, so a
        // single separator must stay inside the erased type. Logical `||` / `&&`
        // still terminate above.
        T::Pipe | T::Ampersand => false,
        T::In | T::Instanceof => expr,
        _ => false,
    }
}

fn continues_type(kind: T) -> bool {
    matches!(
        kind,
        T::Pipe
            | T::Ampersand
            | T::Dot
            | T::Less
            | T::Greater
            | T::LeftBracket
            | T::Question
            | T::Colon
            | T::Arrow
            | T::Extends
            | T::Keyof
            | T::Typeof
            | T::Readonly
            | T::Infer
            | T::Is
            | T::New
            | T::LeftParen
            | T::Star
    )
}

fn continues_expression(kind: T) -> bool {
    matches!(
        kind,
        T::Dot
            | T::QuestionDot
            | T::LeftParen
            | T::LeftBracket
            | T::Comma
            | T::Question
            | T::Colon
            | T::Arrow
            | T::Plus
            | T::Minus
            | T::Star
            | T::Slash
            | T::Percent
            | T::Equal
            | T::PlusEqual
            | T::MinusEqual
            | T::StarEqual
            | T::SlashEqual
            | T::PercentEqual
            | T::AmpersandAmpersand
            | T::PipePipe
            | T::QuestionQuestion
            | T::EqualEqual
            | T::NotEqual
            | T::EqualEqualEqual
            | T::NotEqualEqual
            | T::Less
            | T::Greater
            | T::LessEqual
            | T::GreaterEqual
            | T::Ampersand
            | T::Pipe
            | T::Caret
            | T::TemplateString
            | T::In
            | T::Instanceof
    )
}

fn ends_statement(kind: T) -> bool {
    matches!(
        kind,
        T::IdentifierName
            | T::StringLiteral
            | T::NumericLiteral
            | T::BigIntLiteral
            | T::BooleanLiteral
            | T::TemplateString
            | T::RegexLiteral
            | T::RightParen
            | T::RightBracket
            | T::RightBrace
            | T::PlusPlus
            | T::MinusMinus
            | T::This
            | T::Super
            | T::True
            | T::False
            | T::Null
            | T::Undefined
    )
}

fn can_end_binding(kind: T) -> bool {
    matches!(
        kind,
        T::IdentifierName
            | T::StringLiteral
            | T::NumericLiteral
            | T::RightParen
            | T::RightBracket
            | T::RightBrace
            | T::Question
            | T::Exclamation
            | T::This
            | T::Super
            | T::Get
            | T::Set
            | T::Constructor
    )
}

/// Keyword tokens that are legal class member names once the modifier prefix is
/// stripped (`public type`, `public readonly`, `static get`, ...).
///
/// Structural keywords that drive frame or statement tracking in [`Eraser::run`]
/// (`class`, `interface`, `enum`, `namespace`, `case`, `default`, ...) are
/// intentionally absent so a member named like them cannot corrupt that state.
fn is_member_name_keyword(kind: T) -> bool {
    matches!(
        kind,
        T::Type
            | T::Readonly
            | T::Get
            | T::Set
            | T::Static
            | T::Async
            | T::New
            | T::Constructor
            | T::Public
            | T::Private
            | T::Protected
            | T::Abstract
            | T::Override
            | T::Implements
            | T::Extends
            | T::Keyof
            | T::Infer
            | T::Is
            | T::As
            | T::Asserts
            | T::Unique
            | T::Any
            | T::Boolean
            | T::Number
            | T::Object
            | T::String
            | T::Symbol
            | T::Unknown
            | T::Never
            | T::Void
            | T::Null
            | T::True
            | T::False
            | T::This
            | T::Super
            | T::Delete
            | T::Typeof
            | T::Instanceof
            | T::In
            | T::Of
            | T::From
    )
}

fn ends_expression(kind: T) -> bool {
    matches!(
        kind,
        T::IdentifierName
            | T::StringLiteral
            | T::NumericLiteral
            | T::BigIntLiteral
            | T::BooleanLiteral
            | T::TemplateString
            | T::RegexLiteral
            | T::RightParen
            | T::RightBracket
            | T::RightBrace
            | T::This
            | T::Super
            | T::True
            | T::False
            | T::Null
            | T::Undefined
            | T::PlusPlus
            | T::MinusMinus
    )
}

fn is_after_non_null(kind: T) -> bool {
    matches!(
        kind,
        T::Dot
            | T::QuestionDot
            | T::LeftBracket
            | T::LeftParen
            | T::RightParen
            | T::Comma
            | T::Semicolon
            | T::RightBracket
            | T::RightBrace
            | T::Equal
            | T::Question
            | T::Colon
            | T::Arrow
            | T::Plus
            | T::Minus
            | T::Star
            | T::Slash
            | T::Percent
            | T::EqualEqual
            | T::NotEqual
            | T::EqualEqualEqual
            | T::NotEqualEqual
            | T::AmpersandAmpersand
            | T::PipePipe
            | T::QuestionQuestion
            | T::Less
            | T::Greater
            | T::LessEqual
            | T::GreaterEqual
            | T::In
            | T::Instanceof
    )
}

#[cfg(test)]
mod tests {
    use super::{erase_types, erase_types_with_deletions};

    #[test]
    fn erases_trailing_inline_type_specifier() {
        let js = erase_types("import { a, type B } from \"./x\";\nconst value = a;\n").unwrap();
        assert_eq!(js, "import { a } from \"./x\";\nconst value = a;\n");
    }

    #[test]
    fn erases_leading_inline_type_specifier() {
        let js = erase_types("import { type B, a } from \"./x\";\n").unwrap();
        assert!(!js.contains("type"), "{js}");
        assert!(js.contains("a } from \"./x\";"), "{js}");
    }

    #[test]
    fn erases_aliased_inline_type_specifier() {
        let js = erase_types("import { a, type B as C } from \"./x\";\n").unwrap();
        assert_eq!(js, "import { a } from \"./x\";\n");
    }

    #[test]
    fn erases_multiline_inline_type_specifiers() {
        let js =
            erase_types("import {\n  a,\n  type B,\n  c,\n} from \"./x\";\nconst value = a + c;\n")
                .unwrap();
        assert!(!js.contains("type B"), "{js}");
        assert!(js.contains("  a,"), "{js}");
        assert!(js.contains("  c,"), "{js}");
        assert!(js.contains("} from \"./x\";"), "{js}");
    }

    #[test]
    fn erases_inline_type_specifiers_from_export_lists() {
        let js = erase_types("export { type B, keep };\n").unwrap();
        assert_eq!(js, "export {  keep };\n");
        let only_type = erase_types("const keep = 1;\nexport { type B };\n").unwrap();
        assert!(!only_type.contains("export"), "{only_type}");
        assert!(only_type.contains("const keep = 1;"), "{only_type}");
    }

    #[test]
    fn erases_all_type_only_import_lists() {
        let js =
            erase_types("import { type B, type C as D } from \"./x\";\nconst a = 1;\n").unwrap();
        assert!(!js.contains("import"), "{js}");
        assert!(js.contains("const a = 1;"), "{js}");
    }

    #[test]
    fn keeps_value_bindings_named_type() {
        let js = erase_types("import { type } from \"./x\";\nimport { type as t } from \"./y\";\n")
            .unwrap();
        assert!(js.contains("import { type } from \"./x\";"), "{js}");
        assert!(js.contains("import { type as t } from \"./y\";"), "{js}");
    }

    #[test]
    fn keeps_whole_statement_type_only_imports_erased() {
        let js = erase_types(
            "import type { X } from \"./x\";\nimport type Y from \"./y\";\nconst value = 1;\n",
        )
        .unwrap();
        assert!(!js.contains("import"), "{js}");
        assert!(js.contains("const value = 1;"), "{js}");
    }

    #[test]
    fn reports_specifier_deletions_with_the_comma() {
        let (js, deletions) =
            erase_types_with_deletions("import { a, type B } from \"./x\";\n").unwrap();
        assert_eq!(js, "import { a } from \"./x\";\n");
        assert_eq!(deletions, vec![(10, 18)]);
        let source = "import { a, type B } from \"./x\";\n";
        assert_eq!(&source[deletions[0].0..deletions[0].1], ", type B");
    }

    #[test]
    fn reports_monotonic_specifier_deletions() {
        let source = "import { type A, b, type C } from \"./x\";\nexport { type D, e };\n";
        let (js, deletions) = erase_types_with_deletions(source).unwrap();
        assert!(!js.contains("type"), "{js}");
        let mut previous_end = 0usize;
        for (start, end) in &deletions {
            assert!(start < end, "{deletions:?}");
            assert!(previous_end <= *start, "{deletions:?}");
            previous_end = *end;
        }
    }
}
