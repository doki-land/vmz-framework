use oak_typescript::ast::{Expression, ExpressionKind, ObjectProperty, Statement};
use vmz_oak_frontend_adapter::{ByteSpan, parse_expression_snippet};

fn collect_identifier_spans(expr: &Expression, out: &mut Vec<ByteSpan>) {
    match expr.kind.as_ref() {
        ExpressionKind::Identifier(_) => {
            out.push(ByteSpan { start: expr.span.start, end: expr.span.end });
        }
        ExpressionKind::MemberExpression { object, property, .. } => {
            collect_identifier_spans(object, out);
            collect_identifier_spans(property, out);
        }
        ExpressionKind::ConditionalExpression { test, consequent, alternate } => {
            collect_identifier_spans(test, out);
            collect_identifier_spans(consequent, out);
            collect_identifier_spans(alternate, out);
        }
        ExpressionKind::BinaryExpression { left, right, .. } => {
            collect_identifier_spans(left, out);
            collect_identifier_spans(right, out);
        }
        ExpressionKind::AssignmentExpression { left, right, .. } => {
            collect_identifier_spans(left, out);
            collect_identifier_spans(right, out);
        }
        ExpressionKind::CallExpression { func, args } => {
            collect_identifier_spans(func, out);
            for arg in args {
                collect_identifier_spans(arg, out);
            }
        }
        ExpressionKind::ObjectLiteral { properties } => {
            for property in properties {
                match property {
                    ObjectProperty::Property { value, .. } => {
                        collect_identifier_spans(value, out);
                    }
                    ObjectProperty::Method { .. } => {}
                    ObjectProperty::Spread(value) => collect_identifier_spans(value, out),
                }
            }
        }
        ExpressionKind::ArrowFunction { body, .. } => collect_statement_identifiers(body, out),
        _ => {}
    }
}

fn collect_statement_identifiers(stmt: &Statement, out: &mut Vec<ByteSpan>) {
    match stmt {
        Statement::ExpressionStatement(stmt) => collect_identifier_spans(&stmt.expression, out),
        Statement::BlockStatement(block) => {
            for child in &block.statements {
                collect_statement_identifiers(child, out);
            }
        }
        Statement::ReturnStatement(ret) => {
            if let Some(argument) = &ret.argument {
                collect_identifier_spans(argument, out);
            }
        }
        _ => {}
    }
}

#[test]
fn closes_the_snippet_on_illegal_trailing_input() {
    for snippet in ["a b", "user.name extra", "1 2"] {
        let parsed = parse_expression_snippet(snippet);
        assert!(!parsed.ok, "{snippet}: trailing input must not be accepted");
        let structured = parsed.diagnostics.iter().any(|d| {
            d.code == "vmz::expression::trailing_input"
                || d.code == "vmz::expression::multiple_statements"
                || d.code == "vmz::expression::not_lowered"
        });
        assert!(
            structured,
            "{snippet}: expected a structured diagnostic, got {:?}",
            parsed.diagnostics
        );
        for diagnostic in &parsed.diagnostics {
            if let Some(span) = diagnostic.span {
                assert!(span.start <= snippet.len(), "{snippet}: span start out of range");
                assert!(span.end <= snippet.len(), "{snippet}: span end out of range");
                assert!(span.end >= span.start, "{snippet}: span must not be inverted");
            }
        }
    }
}

#[test]
fn trailing_diagnostic_names_the_leftover_text() {
    let parsed = parse_expression_snippet("user.name + extra )");
    assert!(!parsed.ok, "a stray closer must not be accepted: {:?}", parsed.diagnostics);
    let trailing = parsed
        .diagnostics
        .iter()
        .find(|d| d.code == "vmz::expression::trailing_input")
        .expect("trailing_input diagnostic");
    assert_eq!(trailing.args.get("tail").map(String::as_str), Some(")"));
    assert_eq!(trailing.span, Some(ByteSpan { start: 18, end: 19 }));
}

#[test]
fn rejects_multi_statement_snippets_with_count_and_span() {
    let parsed = parse_expression_snippet("a; b");
    assert!(!parsed.ok);
    let diagnostic = parsed
        .diagnostics
        .iter()
        .find(|d| d.code == "vmz::expression::multiple_statements")
        .expect("multiple_statements diagnostic");
    assert_eq!(diagnostic.args.get("count").map(String::as_str), Some("2"));
    assert_eq!(diagnostic.span, Some(ByteSpan { start: 0, end: 4 }));
}

#[test]
fn keeps_diagnostics_as_codes_not_sentences() {
    for snippet in ["1 +", "user.", "a b"] {
        let parsed = parse_expression_snippet(snippet);
        assert!(!parsed.ok, "{snippet} must fail");
        for diagnostic in &parsed.diagnostics {
            assert!(
                diagnostic.code.starts_with("vmz::") || diagnostic.code.starts_with("oak::"),
                "{snippet}: unexpected diagnostic code {}",
                diagnostic.code
            );
            assert!(
                !diagnostic.code.contains(' '),
                "{}: diagnostics carry codes, not sentences",
                diagnostic.code
            );
        }
    }
}

#[test]
fn utf8_multibyte_snippet_spans_slice_the_input() {
    let snippet = "\"日本語\".length + \"🚀\".length";
    let parsed = parse_expression_snippet(snippet);
    assert!(parsed.ok, "{snippet}: {:?}", parsed.diagnostics);
    let span = parsed.root_span.expect("root span");
    assert_eq!(&snippet[span.start..span.end], snippet);
}

#[test]
fn leading_whitespace_offsets_stay_absolute_to_the_input() {
    let snippet = "   user.name";
    let parsed = parse_expression_snippet(snippet);
    assert!(parsed.ok, "{:?}", parsed.diagnostics);
    let span = parsed.root_span.expect("root span");
    assert_eq!(&snippet[span.start..span.end], "user.name");
    assert_eq!(span.start, 3);
}

#[test]
fn object_expression_spans_are_remapped_out_of_the_wrapper() {
    let snippet = "{ id: \"x\" }";
    let parsed = parse_expression_snippet(snippet);
    assert!(parsed.ok, "{snippet}: {:?}", parsed.diagnostics);
    let expression = parsed.expression.expect("expression");
    assert_eq!(
        &snippet[expression.span.start..expression.span.end],
        snippet,
        "root expression span must slice the snippet"
    );
    let mut identifiers = Vec::new();
    collect_identifier_spans(&expression, &mut identifiers);
    for span in &identifiers {
        assert!(span.end <= snippet.len(), "child span must stay inside the snippet");
    }
    let root_span = parsed.root_span.expect("root span");
    assert_eq!(&snippet[root_span.start..root_span.end], snippet);
}

#[test]
fn object_expression_child_spans_slice_the_input() {
    let snippet = "{ id: \"x\" }";
    let parsed = parse_expression_snippet(snippet);
    assert!(parsed.ok, "{snippet}: {:?}", parsed.diagnostics);
    let expression = parsed.expression.expect("expression");
    let ExpressionKind::ObjectLiteral { properties } = expression.kind.as_ref() else {
        panic!("expected an object literal, got {:?}", expression.kind);
    };
    let ObjectProperty::Property { value, .. } = &properties[0] else {
        panic!("expected a named property");
    };
    assert_eq!(
        snippet[value.span.start..value.span.end].trim_end(),
        "\"x\"",
        "property value span must be remapped out of the wrapper"
    );
}

#[test]
fn arrow_expression_with_block_body_spans_stay_snippet_local() {
    let snippet = "{ on: () => { isOpen = !isOpen } }";
    let parsed = parse_expression_snippet(snippet);
    assert!(parsed.ok, "{snippet}: {:?}", parsed.diagnostics);
    let expression = parsed.expression.expect("expression");
    assert_eq!(&snippet[expression.span.start..expression.span.end], snippet);
    let ExpressionKind::ObjectLiteral { properties } = expression.kind.as_ref() else {
        panic!("expected an object literal, got {:?}", expression.kind);
    };
    let ObjectProperty::Property { value, .. } = &properties[0] else {
        panic!("expected a named property");
    };
    assert_eq!(
        snippet[value.span.start..value.span.end].trim_end(),
        "() => { isOpen = !isOpen }",
        "arrow body span must be remapped out of the wrapper"
    );
}

#[test]
fn arrow_expression_root_span_covers_the_snippet() {
    let snippet = "() => ({ id: \"x\" })";
    let parsed = parse_expression_snippet(snippet);
    assert!(parsed.ok, "{snippet}: {:?}", parsed.diagnostics);
    let span = parsed.root_span.expect("root span");
    assert_eq!(&snippet[span.start..span.end], snippet);
}
