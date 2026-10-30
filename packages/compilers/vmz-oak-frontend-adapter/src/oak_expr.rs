//! Oak TypeScript parse for VMZ template expression snippets.

use oak_core::{Builder, Lexer, OakError, ParseSession, Range, SourceText};
use oak_typescript::ast::{
    Expression, ExpressionKind, FunctionParam, ObjectProperty, Statement, TypeParameter,
};
use oak_typescript::{
    TypeScriptBuilder, TypeScriptLanguage, TypeScriptLexer, TypeScriptRoot, TypeScriptTokenType,
};

use crate::contract::{ByteSpan, OakFrontendDiagnostic};
use crate::oak_cst::map_oak_error;

const WRAPPER_PREFIX: &str = "const __vmz_expr = ";

/// Result of parsing a template expression snippet via Oak TypeScript AST.
#[derive(Debug, Clone)]
pub struct ExpressionSnippetParse {
    /// Root expression when lowered (spans relative to the input string).
    pub expression: Option<Expression>,
    /// Root expression span inside the input string when lowered.
    pub root_span: Option<ByteSpan>,
    /// Oak diagnostics (spans relative to the input string).
    pub diagnostics: Vec<OakFrontendDiagnostic>,
    /// `true` when Oak lowered exactly one expression that consumes the whole input.
    pub ok: bool,
}

/// Parse a template expression snippet with Oak TypeScript (no author-visible wrap).
///
/// The whole input must be consumed by a single expression statement — trailing
/// garbage (for example `a b`) and multi-statement snippets (`a; b`) produce
/// structured `vmz::expression::*` diagnostics instead of being silently dropped.
/// Oak diagnostics from the successful parse (including wrapper parses) are kept.
/// All spans are relative to the original `expr` string, not the trimmed slice.
pub fn parse_expression_snippet(expr: &str) -> ExpressionSnippetParse {
    let trimmed = expr.trim();
    if trimmed.is_empty() {
        return ExpressionSnippetParse {
            expression: None,
            root_span: None,
            diagnostics: Vec::new(),
            ok: true,
        };
    }
    let base = expr.len() - expr.trim_start().len();

    if is_vue_contextual_identifier(trimmed) {
        return ExpressionSnippetParse {
            expression: Some(Expression::new(
                ExpressionKind::Identifier(trimmed.to_string()),
                (0..trimmed.len()).into(),
            )),
            root_span: Some(ByteSpan { start: base, end: base + trimmed.len() }),
            diagnostics: Vec::new(),
            ok: true,
        };
    }

    let source = SourceText::new(trimmed);
    // VMZ template expressions are plain TypeScript and VMZ forbids JSX, so a
    // leading `<` must read as a generic arrow or a type parameter list.
    let language = TypeScriptLanguage { jsx: false, ..TypeScriptLanguage::standard() };
    let builder = TypeScriptBuilder::new(&language);
    let mut cache = ParseSession::default();
    let built = Builder::build(&builder, &source, &[], &mut cache);

    let mut diagnostics = Vec::new();
    if let Err(err) = &built.result {
        diagnostics.push(map_snippet_error(err, base, expr));
    }
    for err in &built.diagnostics {
        diagnostics.push(map_snippet_error(err, base, expr));
    }

    // Object literals at statement start and a few other snippets only lower
    // when Oak reads them as an initializer. Retry inside `const __vmz_expr = …`,
    // but never after the snippet was already rejected for leftover input —
    // Oak's recovery could otherwise accept the abandoned tail through the
    // wrapper and hide the diagnostic.
    let mut allow_wrapper = true;
    if let Ok(root) = &built.result {
        match classify_snippet(root, trimmed) {
            SnippetShape::Expression(mut expression) => {
                shift_expression_spans(&mut expression, base as isize);
                let span = ByteSpan { start: expression.span.start, end: expression.span.end };
                let ok = diagnostics.is_empty();
                return ExpressionSnippetParse {
                    expression: Some(expression),
                    root_span: Some(span),
                    diagnostics,
                    ok,
                };
            }
            SnippetShape::MultipleStatements(count) => {
                allow_wrapper = false;
                diagnostics.push(
                    OakFrontendDiagnostic::new("vmz::expression::multiple_statements")
                        .with_arg("count", count.to_string())
                        .with_span(ByteSpan { start: base, end: base + trimmed.len() }),
                );
            }
            SnippetShape::Trailing(offset) => {
                allow_wrapper = false;
                diagnostics.push(
                    OakFrontendDiagnostic::new("vmz::expression::trailing_input")
                        .with_arg("tail", trimmed[offset..].trim().to_string())
                        .with_span(ByteSpan { start: base + offset, end: base + trimmed.len() }),
                );
            }
            SnippetShape::NotExpression => {}
        }
    }

    // Object literals at statement start and a few other snippets only lower
    // when Oak reads them as an initializer. Retry inside `const __vmz_expr = …`.
    if !allow_wrapper {
        return ExpressionSnippetParse {
            expression: None,
            root_span: None,
            diagnostics,
            ok: false,
        };
    }
    for (wrapped, prefix_len) in wrapper_variants(trimmed) {
        let wrapped_source = SourceText::new(wrapped.as_str());
        let wrapped_built = Builder::build(&builder, &wrapped_source, &[], &mut cache);

        let mut wrapper_diags = Vec::new();
        if let Err(err) = &wrapped_built.result {
            wrapper_diags.push(map_wrapper_error(err, prefix_len, base, expr));
        }
        for err in &wrapped_built.diagnostics {
            wrapper_diags.push(map_wrapper_error(err, prefix_len, base, expr));
        }

        let Ok(root) = &wrapped_built.result else {
            continue;
        };
        if root.statements.len() != 1 {
            continue;
        }
        let Some(value) = root.statements.iter().find_map(|stmt| match stmt {
            Statement::VariableDeclaration(decl) if decl.name == "__vmz_expr" => decl.value.clone(),
            _ => None,
        }) else {
            continue;
        };

        let mut expression = value;
        shift_expression_spans(&mut expression, base as isize - prefix_len as isize);
        let span = ByteSpan { start: expression.span.start, end: expression.span.end };
        let ok = wrapper_diags.is_empty();
        return ExpressionSnippetParse {
            expression: Some(expression),
            root_span: Some(span),
            diagnostics: wrapper_diags,
            ok,
        };
    }

    if diagnostics.is_empty() {
        diagnostics.push(
            OakFrontendDiagnostic::new("vmz::expression::not_lowered")
                .with_span(ByteSpan { start: base, end: base + trimmed.len() }),
        );
    }

    ExpressionSnippetParse { expression: None, root_span: None, diagnostics, ok: false }
}

fn is_vue_contextual_identifier(value: &str) -> bool {
    matches!(value, "type" | "readonly" | "default" | "static" | "get" | "set")
}

/// How a built root statement list consumes the trimmed snippet.
enum SnippetShape {
    /// Exactly one expression statement spanning the whole snippet.
    Expression(Expression),
    /// More than one statement.
    MultipleStatements(usize),
    /// One statement, but significant text is left outside it (offset in snippet).
    Trailing(usize),
    /// One statement that is not an expression (e.g. `let x = 1`).
    NotExpression,
}

fn classify_snippet(root: &TypeScriptRoot, trimmed: &str) -> SnippetShape {
    if root.statements.len() != 1 {
        return SnippetShape::MultipleStatements(root.statements.len());
    }
    let Statement::ExpressionStatement(stmt) = &root.statements[0] else {
        return SnippetShape::NotExpression;
    };
    let start = stmt.span.start.min(trimmed.len());
    let end = stmt.span.end.min(trimmed.len());
    if let Some(offset) = first_significant(&trimmed[..start]) {
        return SnippetShape::Trailing(offset);
    }
    let tail = &trimmed[end..];
    // A trailing statement terminator is still a complete expression statement.
    let tail_start = if tail.starts_with(';') { 1 } else { 0 };
    if let Some(offset) = first_significant(&tail[tail_start..]) {
        return SnippetShape::Trailing(end + tail_start + offset);
    }
    // Oak's recovery can keep the tail inside the statement span (for example
    // `user.name + extra )` lowers with the stray `)` swallowed). Reject
    // unbalanced closers so no partial expression looks accepted.
    if let Some(offset) = unbalanced_close_offset(trimmed) {
        return SnippetShape::Trailing(offset);
    }
    SnippetShape::Expression(stmt.expression.clone())
}

/// Byte offset of the first closing delimiter without a matching opener.
fn unbalanced_close_offset(source: &str) -> Option<usize> {
    let text = SourceText::new(source);
    let language = TypeScriptLanguage::standard();
    let lexer = TypeScriptLexer::new(&language);
    let mut cache = oak_core::NoLexerCache;
    let Ok(tokens) = Lexer::lex(&lexer, &text, &[], &mut cache).result else {
        return None;
    };
    let mut depth = 0usize;
    for token in tokens.iter() {
        match token.kind {
            TypeScriptTokenType::LeftParen
            | TypeScriptTokenType::LeftBracket
            | TypeScriptTokenType::LeftBrace => depth += 1,
            TypeScriptTokenType::RightParen
            | TypeScriptTokenType::RightBracket
            | TypeScriptTokenType::RightBrace => {
                if depth == 0 {
                    return Some(token.span.start);
                }
                depth -= 1;
            }
            TypeScriptTokenType::Eof => break,
            _ => {}
        }
    }
    None
}

/// Byte offset of the first significant (non whitespace / non comment) byte.
fn first_significant(text: &str) -> Option<usize> {
    let bytes = text.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        match bytes[i] {
            b' ' | b'\t' | b'\r' | b'\n' => i += 1,
            b'/' if bytes.get(i + 1) == Some(&b'/') => {
                while i < bytes.len() && bytes[i] != b'\n' {
                    i += 1;
                }
            }
            b'/' if bytes.get(i + 1) == Some(&b'*') => {
                i += 2;
                while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                    i += 1;
                }
                i = (i + 2).min(bytes.len());
            }
            _ => return Some(i),
        }
    }
    None
}

/// Map an Oak error into snippet coordinates anchored at `base`, keeping the
/// span inside `input` and on UTF-8 char boundaries.
fn map_snippet_error(err: &OakError, base: usize, input: &str) -> OakFrontendDiagnostic {
    let mut diagnostic = map_oak_error(err, base);
    if let Some(span) = diagnostic.span.take() {
        diagnostic.span = Some(clamp_span(span, input.len(), input));
    }
    diagnostic
}

/// Map a wrapper-relative Oak error back to snippet coordinates.
///
/// `prefix_len` is the wrapper prefix that does not exist in the author's
/// snippet, `base` the leading whitespace trimmed from it.
fn map_wrapper_error(
    err: &OakError,
    prefix_len: usize,
    base: usize,
    input: &str,
) -> OakFrontendDiagnostic {
    let mut diagnostic = crate::oak_cst::describe(err);
    if let Some(span) = diagnostic.span.take() {
        let start = span.start.saturating_sub(prefix_len) + base;
        let end = span.end.saturating_sub(prefix_len) + base;
        diagnostic.span = Some(clamp_span(ByteSpan { start, end }, input.len(), input));
    } else if let Some(offset) = oak_error_offset(err) {
        let start = offset.saturating_sub(prefix_len) + base;
        diagnostic.span = Some(clamp_span(ByteSpan { start, end: start + 1 }, input.len(), input));
    }
    diagnostic
}

/// Keep a diagnostic span inside the input and on char boundaries.
fn clamp_span(mut span: ByteSpan, len: usize, input: &str) -> ByteSpan {
    span.start = span.start.min(len);
    span.end = span.end.min(len).max(span.start);
    while span.end < len && !input.is_char_boundary(span.end) {
        span.end += 1;
    }
    while span.start < len && !input.is_char_boundary(span.start) {
        span.start += 1;
        span.end = span.end.max(span.start);
    }
    span
}

fn oak_error_offset(err: &OakError) -> Option<usize> {
    match err.kind() {
        oak_core::OakErrorKind::SyntaxError { offset, .. }
        | oak_core::OakErrorKind::UnexpectedCharacter { offset, .. }
        | oak_core::OakErrorKind::UnexpectedToken { offset, .. }
        | oak_core::OakErrorKind::UnexpectedEof { offset, .. }
        | oak_core::OakErrorKind::ExpectedToken { offset, .. }
        | oak_core::OakErrorKind::ExpectedName { offset, .. }
        | oak_core::OakErrorKind::TrailingCommaNotAllowed { offset, .. } => Some(*offset),
        _ => None,
    }
}

/// Build wrapper strings and their `const __vmz_expr = …` prefix offsets.
fn wrapper_variants(trimmed: &str) -> Vec<(String, usize)> {
    if trimmed.contains("=>") {
        vec![(format!("{WRAPPER_PREFIX}{trimmed};"), WRAPPER_PREFIX.len())]
    } else if trimmed.starts_with("({") && trimmed.ends_with("})") {
        let inner = &trimmed[1..trimmed.len() - 1];
        vec![(format!("{WRAPPER_PREFIX}{inner} ;"), WRAPPER_PREFIX.len())]
    } else {
        // `(` keeps object literals out of statement position; the opener is
        // also part of the wrapper prefix, so it must be subtracted as well.
        vec![(format!("{WRAPPER_PREFIX}({trimmed});"), WRAPPER_PREFIX.len() + 1)]
    }
}

fn shift_range(range: &mut Range<usize>, delta: isize) {
    let start = (range.start as isize + delta).max(0) as usize;
    let end = (range.end as isize + delta).max(start as isize) as usize;
    *range = Range::from(start..end);
}

/// Move every span in an expression tree out of wrapper coordinates.
fn shift_expression_spans(expr: &mut Expression, delta: isize) {
    if delta == 0 {
        return;
    }
    shift_range(&mut expr.span, delta);
    match expr.kind.as_mut() {
        ExpressionKind::Identifier(_)
        | ExpressionKind::NumericLiteral(_)
        | ExpressionKind::StringLiteral(_)
        | ExpressionKind::BigIntLiteral(_)
        | ExpressionKind::BooleanLiteral(_)
        | ExpressionKind::NullLiteral
        | ExpressionKind::RegexLiteral(_)
        | ExpressionKind::TemplateString(_)
        | ExpressionKind::MetaProperty { .. }
        | ExpressionKind::YieldExpression(None)
        | ExpressionKind::JsxElement(_)
        | ExpressionKind::JsxFragment(_)
        | ExpressionKind::JsxSelfClosingElement(_) => {}
        ExpressionKind::UnaryExpression { argument, .. }
        | ExpressionKind::UpdateExpression { argument, .. }
        | ExpressionKind::AwaitExpression(argument)
        | ExpressionKind::SpreadElement(argument)
        | ExpressionKind::NonNullExpression(argument)
        | ExpressionKind::AsExpression { expression: argument, .. }
        | ExpressionKind::TypeAssertionExpression { expression: argument, .. } => {
            shift_expression_spans(argument, delta);
        }
        ExpressionKind::YieldExpression(Some(argument)) => {
            shift_expression_spans(argument, delta);
        }
        ExpressionKind::BinaryExpression { left, right, .. }
        | ExpressionKind::AssignmentExpression { left, right, .. } => {
            shift_expression_spans(left, delta);
            shift_expression_spans(right, delta);
        }
        ExpressionKind::ConditionalExpression { test, consequent, alternate } => {
            shift_expression_spans(test, delta);
            shift_expression_spans(consequent, delta);
            shift_expression_spans(alternate, delta);
        }
        ExpressionKind::MemberExpression { object, property, .. } => {
            shift_expression_spans(object, delta);
            shift_expression_spans(property, delta);
        }
        ExpressionKind::CallExpression { func, args }
        | ExpressionKind::NewExpression { func, args } => {
            shift_expression_spans(func, delta);
            for arg in args {
                shift_expression_spans(arg, delta);
            }
        }
        ExpressionKind::ArrayLiteral { elements } => {
            for element in elements {
                shift_expression_spans(element, delta);
            }
        }
        ExpressionKind::ObjectLiteral { properties } => {
            for property in properties {
                match property {
                    ObjectProperty::Property { value, span, .. } => {
                        shift_range(span, delta);
                        shift_expression_spans(value, delta);
                    }
                    ObjectProperty::Spread(value) => shift_expression_spans(value, delta),
                }
            }
        }
        ExpressionKind::ImportExpression { module_specifier } => {
            shift_expression_spans(module_specifier, delta);
        }
        ExpressionKind::TaggedTemplateExpression { tag, template } => {
            shift_expression_spans(tag, delta);
            shift_expression_spans(template, delta);
        }
        ExpressionKind::ArrowFunction { type_params, params, body, .. } => {
            shift_type_spans(type_params, params, delta);
            shift_statement_spans(body, delta);
        }
        ExpressionKind::FunctionExpression { type_params, params, body, .. } => {
            shift_type_spans(type_params, params, delta);
            for stmt in body {
                shift_statement_spans(stmt, delta);
            }
        }
    }
}

fn shift_type_spans(type_params: &mut [TypeParameter], params: &mut [FunctionParam], delta: isize) {
    for param in type_params.iter_mut() {
        shift_range(&mut param.span, delta);
    }
    for param in params.iter_mut() {
        shift_range(&mut param.span, delta);
    }
}

/// Move statement spans (and their nested expressions) out of wrapper coordinates.
fn shift_statement_spans(stmt: &mut Statement, delta: isize) {
    if delta == 0 {
        return;
    }
    match stmt {
        Statement::ExpressionStatement(stmt) => {
            shift_range(&mut stmt.span, delta);
            shift_expression_spans(&mut stmt.expression, delta);
        }
        Statement::BlockStatement(block) => {
            shift_range(&mut block.span, delta);
            for child in &mut block.statements {
                shift_statement_spans(child, delta);
            }
        }
        Statement::ReturnStatement(ret) => {
            shift_range(&mut ret.span, delta);
            if let Some(argument) = &mut ret.argument {
                shift_expression_spans(argument, delta);
            }
        }
        Statement::VariableDeclaration(decl) => {
            shift_range(&mut decl.span, delta);
            if let Some(value) = &mut decl.value {
                shift_expression_spans(value, delta);
            }
        }
        Statement::IfStatement(node) => {
            shift_range(&mut node.span, delta);
            shift_expression_spans(&mut node.test, delta);
            shift_statement_spans(&mut node.consequent, delta);
            if let Some(alternate) = &mut node.alternate {
                shift_statement_spans(alternate, delta);
            }
        }
        Statement::WhileStatement(node) => {
            shift_range(&mut node.span, delta);
            shift_expression_spans(&mut node.test, delta);
            shift_statement_spans(&mut node.body, delta);
        }
        Statement::DoWhileStatement(node) => {
            shift_range(&mut node.span, delta);
            shift_expression_spans(&mut node.test, delta);
            shift_statement_spans(&mut node.body, delta);
        }
        Statement::ForStatement(node) => {
            shift_range(&mut node.span, delta);
            if let Some(initializer) = &mut node.initializer {
                shift_statement_spans(initializer, delta);
            }
            if let Some(test) = &mut node.test {
                shift_expression_spans(test, delta);
            }
            if let Some(incrementor) = &mut node.incrementor {
                shift_expression_spans(incrementor, delta);
            }
            shift_statement_spans(&mut node.body, delta);
        }
        Statement::ForInStatement(node) => {
            shift_range(&mut node.span, delta);
            shift_statement_spans(&mut node.left, delta);
            shift_expression_spans(&mut node.right, delta);
            shift_statement_spans(&mut node.body, delta);
        }
        Statement::ForOfStatement(node) => {
            shift_range(&mut node.span, delta);
            shift_statement_spans(&mut node.left, delta);
            shift_expression_spans(&mut node.right, delta);
            shift_statement_spans(&mut node.body, delta);
        }
        Statement::ThrowStatement(node) => {
            shift_range(&mut node.span, delta);
            shift_expression_spans(&mut node.argument, delta);
        }
        Statement::SwitchStatement(node) => {
            shift_range(&mut node.span, delta);
            shift_expression_spans(&mut node.discriminant, delta);
            for case in &mut node.cases {
                shift_range(&mut case.span, delta);
                if let Some(test) = &mut case.test {
                    shift_expression_spans(test, delta);
                }
                for child in &mut case.consequent {
                    shift_statement_spans(child, delta);
                }
            }
        }
        Statement::TryStatement(node) => {
            shift_range(&mut node.span, delta);
            for child in &mut node.block {
                shift_statement_spans(child, delta);
            }
            if let Some(handler) = &mut node.handler {
                shift_range(&mut handler.span, delta);
                for child in &mut handler.body {
                    shift_statement_spans(child, delta);
                }
            }
            if let Some(finalizer) = &mut node.finalizer {
                for child in finalizer {
                    shift_statement_spans(child, delta);
                }
            }
        }
        _ => {}
    }
}

/// Fail fast when Oak rejects a template expression snippet.
pub fn require_expression_snippet(expr: &str) -> Result<ByteSpan, Vec<OakFrontendDiagnostic>> {
    let parse = parse_expression_snippet(expr);
    if parse.ok {
        return Ok(parse.root_span.unwrap_or(ByteSpan::empty_at(0)));
    }
    Err(crate::oak_cst::non_empty(parse.diagnostics, "vmz::expression::parse_failed"))
}
