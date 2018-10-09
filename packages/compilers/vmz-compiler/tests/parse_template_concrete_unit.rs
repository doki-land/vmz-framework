//! Concrete AST unit tests (structured Directive + spans).

use vmz_compiler::parse::template::*;

#[test]
fn on_modifiers_structured_and_ir_strips() {
    let src = r#"<button @click.stop.prevent="save">x</button>"#;
    let concrete = parse_template_concrete(src).unwrap();
    match &concrete.roots[0] {
        ConcreteNode::Element { attrs, span, .. } => {
            assert!(!span.is_empty());
            match &attrs[0] {
                ConcreteAttr::Directive {
                    dir: Directive::On {
                        arg: DirectiveArg::Static(ev),
                        handler,
                        modifiers,
                    },
                    span: attr_span,
                } => {
                    assert_eq!(ev, "click");
                    assert_eq!(handler, "save");
                    assert_eq!(modifiers, &["stop".to_string(), "prevent".to_string()]);
                    assert!(!attr_span.is_empty());
                }
                other => panic!("expected On directive, got {other:?}"),
            }
        }
        other => panic!("expected element, got {other:?}"),
    }

    let ir = parse_template(src).unwrap();
    match &ir.roots[0] {
        TemplateNode::Element { attrs, .. } => {
            let click = attrs.iter().find(|a| a.name == "@click").expect("@click");
            assert!(matches!(&click.value, AttrValue::Interp(s) if s == "save"));
            assert!(!attrs.iter().any(|a| a.name.contains("stop")));
        }
        other => panic!("expected element, got {other:?}"),
    }
}

#[test]
fn v_for_keeps_index_alias_on_concrete_only() {
    let src = r#"<li v-for="(item, index) in items" :key="item.id">{{ item }}</li>"#;
    let concrete = parse_template_concrete(src).unwrap();
    match &concrete.roots[0] {
        ConcreteNode::Element { attrs, .. } => {
            let for_dir = attrs.iter().find_map(|a| match a {
                ConcreteAttr::Directive {
                    dir: Directive::For {
                        source,
                        value_alias,
                        key_alias,
                        index_alias,
                    },
                    ..
                } => Some((source, value_alias, key_alias, index_alias)),
                _ => None,
            });
            let (source, value, key, index) = for_dir.expect("For");
            assert_eq!(source, "items");
            assert_eq!(value, "item");
            assert_eq!(key.as_deref(), Some("index"));
            assert!(index.is_none());
        }
        other => panic!("expected element, got {other:?}"),
    }

    let ir = parse_template(src).unwrap();
    match &ir.roots[0] {
        TemplateNode::Element { attrs, .. } => {
            assert!(attrs.iter().any(|a| a.name == "each" && matches!(&a.value, AttrValue::Interp(s) if s == "items")));
            assert!(attrs.iter().any(|a| a.name == "as" && matches!(&a.value, AttrValue::Static(s) if s == "item")));
            assert!(!attrs.iter().any(|a| matches!(&a.value, AttrValue::Static(s) if s == "index")));
        }
        other => panic!("expected element, got {other:?}"),
    }
}

#[test]
fn structured_if_bind_slot_bind_object() {
    let src = r#"
<template>
  <div v-if="ok" :title="label" #default="slotProps" v-bind="extra">x</div>
</template>
"#;
    // Body-only parse (no outer template tag required by parse_template).
    let body = r#"<div v-if="ok" :title="label" #default="slotProps" v-bind="extra">x</div>"#;
    let concrete = parse_template_concrete(body).unwrap();
    match &concrete.roots[0] {
        ConcreteNode::Element { attrs, .. } => {
            assert!(attrs.iter().any(|a| matches!(
                a,
                ConcreteAttr::Directive { dir: Directive::If { test }, .. } if test == "ok"
            )));
            assert!(attrs.iter().any(|a| matches!(
                a,
                ConcreteAttr::Directive {
                    dir: Directive::Bind {
                        arg: DirectiveArg::Static(n),
                        expr,
                        ..
                    },
                    ..
                } if n == "title" && expr == "label"
            )));
            assert!(attrs.iter().any(|a| matches!(
                a,
                ConcreteAttr::Directive {
                    dir: Directive::Slot {
                        name: DirectiveArg::Static(n),
                        props: Some(p),
                    },
                    ..
                } if n == "default" && p == "slotProps"
            )));
            assert!(attrs.iter().any(|a| matches!(
                a,
                ConcreteAttr::Directive {
                    dir: Directive::BindObject { expr },
                    ..
                } if expr == "extra"
            )));
        }
        other => panic!("expected element, got {other:?}"),
    }
    let _ = src;
}

#[test]
fn comment_on_concrete_dropped_from_ir() {
    let src = "<!-- keep on concrete --><span/>";
    let concrete = parse_template_concrete(src).unwrap();
    assert!(matches!(concrete.roots[0], ConcreteNode::Comment { .. }));
    assert!(matches!(concrete.roots[1], ConcreteNode::Element { .. }));

    let ir = parse_template(src).unwrap();
    assert_eq!(ir.roots.len(), 1);
    assert!(matches!(ir.roots[0], TemplateNode::Element { .. }));
}

#[test]
fn rejects_jsx_on_concrete() {
    let err = parse_template_concrete("<h2>{user.name}</h2>").unwrap_err();
    assert!(err.message.contains("JSX") || err.message.contains("single-brace"), "{err}");
}

#[test]
fn v_model_concrete_ok_adapter_errors() {
    let src = r#"<input v-model="query" />"#;
    let concrete = parse_template_concrete(src).unwrap();
    assert!(matches!(
        &concrete.roots[0],
        ConcreteNode::Element { attrs, .. }
            if matches!(
                &attrs[0],
                ConcreteAttr::Directive {
                    dir: Directive::Model { expr, .. },
                    ..
                } if expr == "query"
            )
    ));
    let err = parse_template(src).unwrap_err();
    assert!(err.message.contains("v-model"), "{err}");
}

/// Freeze gate: unsupported Vue forms must fail at Concrete→IR, not grow TemplateAttr.
#[test]
fn template_attr_string_model_rejects_v_model_instead_of_string_special() {
    let err = parse_template(r#"<input v-model="q" />"#).unwrap_err();
    assert!(
        err.message.contains("v-model") && !err.message.is_empty(),
        "expected explicit reject, got {err}"
    );
}

#[test]
fn template_span_is_utf8_byte_offsets_end_exclusive() {
    let src = "<p>{{ x }}</p>";
    let concrete = parse_template_concrete(src).unwrap();
    match &concrete.roots[0] {
        ConcreteNode::Element { span, children, .. } => {
            assert_eq!(span.start, 0);
            assert_eq!(span.end as usize, src.len());
            match &children[0] {
                ConcreteNode::Interpolation { span: ispan, expr, .. } => {
                    assert_eq!(expr, "x");
                    assert_eq!(&src[ispan.start as usize..ispan.end as usize], "{{ x }}");
                }
                other => panic!("expected interpolation, got {other:?}"),
            }
        }
        other => panic!("expected element, got {other:?}"),
    }
}

#[test]
fn lower_matches_parse_template_golden() {
    let fixtures = [
        "<h2>{{ user.name }}</h2>",
        r#"<!-- c --><CounterButton :initial="0" />"#,
        r#"<p v-if="!user">Loading</p>"#,
        r#"<li v-for="tag in tags" :key="tag.id">{{ tag.label }}</li>"#,
        r#"<button type="button" @click="selectFirst">select</button>"#,
        r#"<a title="A &quot;B&quot;">x</a>"#,
    ];
    for src in fixtures {
        let via_parse = parse_template(src).unwrap();
        let via_lower = lower_concrete_to_ir(&parse_template_concrete(src).unwrap()).unwrap();
        assert_eq!(via_parse, via_lower, "golden mismatch for {src}");
    }
}
