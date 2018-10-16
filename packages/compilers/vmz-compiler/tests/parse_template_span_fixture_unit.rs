//! `0.1.18` completion gate: Concrete AST span fixture pack (UTF-8 byte offsets).
//!
//! Each case asserts that every recorded `TemplateSpan` slices the source to the
//! expected substring. Spans are end-exclusive `[start, end)` into the template body.

use vmz_compiler::parse::template::{ConcreteAttr, ConcreteNode, parse_template_concrete};

struct SpanCase {
    name: &'static str,
    source: &'static str,
    /// Expected `(start, end, slice)` triples discovered by walking the AST in order.
    /// Empty means: only check that every node/attr span is a valid non-inverted slice
    /// of `source` (and that multi-byte UTF-8 cases still align on byte boundaries).
    expected_slices: &'static [(&'static str,)],
}

fn collect_slices(src: &str, nodes: &[ConcreteNode], out: &mut Vec<String>) {
    for node in nodes {
        match node {
            ConcreteNode::Element { span, attrs, children, .. } => {
                out.push(src[span.start as usize..span.end as usize].to_string());
                for attr in attrs {
                    let span = match attr {
                        ConcreteAttr::Static { span, .. }
                        | ConcreteAttr::Directive { span, .. } => *span,
                    };
                    out.push(src[span.start as usize..span.end as usize].to_string());
                }
                collect_slices(src, children, out);
            }
            ConcreteNode::Text { span, .. }
            | ConcreteNode::Interpolation { span, .. }
            | ConcreteNode::Comment { span, .. } => {
                out.push(src[span.start as usize..span.end as usize].to_string());
            }
        }
    }
}

fn assert_all_spans_valid_slices(src: &str, nodes: &[ConcreteNode]) {
    for node in nodes {
        match node {
            ConcreteNode::Element { span, attrs, children, .. } => {
                assert!(span.start <= span.end);
                assert!((span.end as usize) <= src.len());
                assert!(src.is_char_boundary(span.start as usize));
                assert!(src.is_char_boundary(span.end as usize));
                let _ = &src[span.start as usize..span.end as usize];
                for attr in attrs {
                    let span = match attr {
                        ConcreteAttr::Static { span, .. }
                        | ConcreteAttr::Directive { span, .. } => *span,
                    };
                    assert!(span.start <= span.end);
                    assert!((span.end as usize) <= src.len());
                    assert!(src.is_char_boundary(span.start as usize));
                    assert!(src.is_char_boundary(span.end as usize));
                }
                assert_all_spans_valid_slices(src, children);
            }
            ConcreteNode::Text { span, .. }
            | ConcreteNode::Interpolation { span, .. }
            | ConcreteNode::Comment { span, .. } => {
                assert!(span.start <= span.end);
                assert!((span.end as usize) <= src.len());
                assert!(src.is_char_boundary(span.start as usize));
                assert!(src.is_char_boundary(span.end as usize));
            }
        }
    }
}

#[test]
fn concrete_span_fixture_pack_utf8_and_structure() {
    let cases = [
        SpanCase {
            name: "ascii_interp",
            source: "<p>{{ x }}</p>",
            expected_slices: &[("<p>{{ x }}</p>",), ("{{ x }}",)],
        },
        SpanCase {
            name: "utf8_text",
            source: "<span>你好世界</span>",
            expected_slices: &[("<span>你好世界</span>",), ("你好世界",)],
        },
        SpanCase {
            name: "utf8_interp_mixed",
            source: "<b>{{ 标题 }}</b>",
            expected_slices: &[("<b>{{ 标题 }}</b>",), ("{{ 标题 }}",)],
        },
        SpanCase {
            name: "attr_and_event",
            source: r#"<button type="button" @click="save">ok</button>"#,
            expected_slices: &[],
        },
        SpanCase { name: "comment_retained", source: "<!-- note --> <i/>", expected_slices: &[] },
        SpanCase {
            name: "nested_if",
            source: r#"<div v-if="ok"><em>{{ label }}</em></div>"#,
            expected_slices: &[],
        },
    ];

    for case in cases {
        let concrete = parse_template_concrete(case.source)
            .unwrap_or_else(|e| panic!("{}: parse failed: {e}", case.name));
        assert_all_spans_valid_slices(case.source, &concrete.roots);

        if !case.expected_slices.is_empty() {
            let mut slices = Vec::new();
            collect_slices(case.source, &concrete.roots, &mut slices);
            let expected: Vec<&str> = case.expected_slices.iter().map(|(s,)| *s).collect();
            for exp in &expected {
                assert!(
                    slices.iter().any(|s| s == exp),
                    "{}: missing slice {exp:?} in {slices:?}",
                    case.name
                );
            }
        }
    }
}

#[test]
fn concrete_span_fixture_interpolation_exact_bytes() {
    // Multi-byte: "中" is 3 UTF-8 bytes; offsets must not land mid-codepoint.
    let src = "<p>{{ 中 }}</p>";
    let concrete = parse_template_concrete(src).unwrap();
    let ConcreteNode::Element { children, .. } = &concrete.roots[0] else {
        panic!("element");
    };
    let ConcreteNode::Interpolation { span, expr, .. } = &children[0] else {
        panic!("interp");
    };
    assert_eq!(expr, "中");
    assert_eq!(&src[span.start as usize..span.end as usize], "{{ 中 }}");
    assert!(src.is_char_boundary(span.start as usize));
    assert!(src.is_char_boundary(span.end as usize));
}

#[test]
fn concrete_span_fixture_attr_covers_directive_text() {
    let src = r#"<a :href="url" @click.stop="go">x</a>"#;
    let concrete = parse_template_concrete(src).unwrap();
    let ConcreteNode::Element { attrs, .. } = &concrete.roots[0] else {
        panic!("element");
    };
    assert_eq!(attrs.len(), 2);
    for attr in attrs {
        let span = match attr {
            ConcreteAttr::Static { span, .. } | ConcreteAttr::Directive { span, .. } => *span,
        };
        let slice = &src[span.start as usize..span.end as usize];
        assert!(
            slice.contains("href") || slice.contains("click"),
            "attr span slice should cover the directive text, got {slice:?}"
        );
    }
}
