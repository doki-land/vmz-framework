//! Moved from `src/parse/template.rs` (cargo-cry: tests next to Cargo.toml).

use vmz_compiler::parse::template::*;

#[test]
fn parses_interp() {
    let ir = parse_template("<h2>{user.name}</h2>");
    assert_eq!(ir.roots.len(), 1);
    match &ir.roots[0] {
        TemplateNode::Element { tag, children, .. } => {
            assert_eq!(tag, "h2");
            assert!(matches!(&children[0], TemplateNode::Interp(s) if s == "user.name"));
        }
        _ => panic!("expected element"),
    }
}

#[test]
fn skips_html_comments() {
    let ir = parse_template("<!-- auto -->\n<CounterButton initial={0} />");
    assert_eq!(ir.roots.len(), 1);
    match &ir.roots[0] {
        TemplateNode::Element { tag, attrs, .. } => {
            assert_eq!(tag, "CounterButton");
            assert_eq!(attrs.len(), 1);
            assert_eq!(attrs[0].name, "initial");
            assert!(matches!(&attrs[0].value, AttrValue::Interp(s) if s == "0"));
        }
        _ => panic!("expected component"),
    }
}

#[test]
fn parses_if_attr() {
    let ir = parse_template(r#"<p if={!user}>Loading</p>"#);
    match &ir.roots[0] {
        TemplateNode::Element { tag, attrs, .. } => {
            assert_eq!(tag, "p");
            assert_eq!(attrs[0].name, "if");
            assert!(matches!(&attrs[0].value, AttrValue::Interp(s) if s == "!user"));
        }
        _ => panic!("expected element"),
    }
}

#[test]
fn decodes_named_entities_in_text() {
    let ir = parse_template("<li>CV &gt; 5% &amp; ok</li>");
    match &ir.roots[0] {
        TemplateNode::Element { children, .. } => match &children[0] {
            TemplateNode::Text(t) => assert_eq!(t, "CV > 5% & ok"),
            other => panic!("expected text, got {other:?}"),
        },
        other => panic!("expected element, got {other:?}"),
    }
}

#[test]
fn decodes_numeric_and_attr() {
    assert_eq!(decode_html_entities("a&#62;b&#x3c;c"), "a>b<c");
    let ir = parse_template(r#"<a title="A &quot;B&quot;">x</a>"#);
    match &ir.roots[0] {
        TemplateNode::Element { attrs, .. } => {
            assert_eq!(attrs[0].value, AttrValue::Static("A \"B\"".into()));
        }
        other => panic!("expected element, got {other:?}"),
    }
}
