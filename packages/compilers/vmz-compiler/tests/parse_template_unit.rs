//! Vue template syntax unit tests (Vue-only author surface).

use vmz_compiler::parse::template::*;

#[test]
fn parses_mustache_interp() {
    let ir = parse_template("<h2>{{ user.name }}</h2>").unwrap();
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
fn skips_html_comments_and_bind_attr() {
    let ir = parse_template(
        r#"<!-- auto -->
<CounterButton :initial="0" />"#,
    )
    .unwrap();
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
fn parses_v_if_directive() {
    let ir = parse_template(r#"<p v-if="!user">Loading</p>"#).unwrap();
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
fn parses_v_for_into_each_as() {
    let ir =
        parse_template(r#"<li v-for="tag in tags" :key="tag.id">{{ tag.label }}</li>"#).unwrap();
    match &ir.roots[0] {
        TemplateNode::Element { attrs, children, .. } => {
            assert!(attrs.iter().any(
                |a| a.name == "each" && matches!(&a.value, AttrValue::Interp(s) if s == "tags")
            ));
            assert!(
                attrs
                    .iter()
                    .any(|a| a.name == "as"
                        && matches!(&a.value, AttrValue::Static(s) if s == "tag"))
            );
            assert!(
                attrs.iter().any(|a| a.name == "key"
                    && matches!(&a.value, AttrValue::Interp(s) if s == "tag.id"))
            );
            assert!(matches!(&children[0], TemplateNode::Interp(s) if s == "tag.label"));
        }
        _ => panic!("expected element"),
    }
}

#[test]
fn parses_event_shorthand() {
    let ir =
        parse_template(r#"<button type="button" @click="selectFirst">select</button>"#).unwrap();
    match &ir.roots[0] {
        TemplateNode::Element { attrs, .. } => {
            let click = attrs.iter().find(|a| a.name == "@click").expect("@click");
            assert!(matches!(&click.value, AttrValue::Interp(s) if s == "selectFirst"));
        }
        _ => panic!("expected element"),
    }
}

#[test]
fn rejects_single_brace_text_interp() {
    let err = parse_template("<h2>{user.name}</h2>").unwrap_err();
    assert!(err.message.contains("single-brace"), "{err}");
}

#[test]
fn rejects_unquoted_brace_attr_bind() {
    let err = parse_template(r#"<Button onClick={increment} />"#).unwrap_err();
    assert!(
        err.message.contains("unquoted") || err.message.contains("single-brace") || err.message.contains("quoted"),
        "{err}"
    );
}

#[test]
fn decodes_named_entities_in_text() {
    let ir = parse_template("<li>CV &gt; 5% &amp; ok</li>").unwrap();
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
    let ir = parse_template(r#"<a title="A &quot;B&quot;">x</a>"#).unwrap();
    match &ir.roots[0] {
        TemplateNode::Element { attrs, .. } => {
            assert_eq!(attrs[0].value, AttrValue::Static("A \"B\"".into()));
        }
        other => panic!("expected element, got {other:?}"),
    }
}
