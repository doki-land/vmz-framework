//! Vue 3.5 syntax parity: VMZ must not accept element syntax that Vue's compiler rejects.
//!
//! VMZ reinterprets semantics, so this matrix only pins the authoring surface. Reference
//! diagnostics come from `@vue/compiler-dom` 3.5.13 `compile()` (`onError`).

use vmz_compiler::{
    SemanticNode, SemanticProp, TemplateBlock, lower_concrete_to_semantic,
    parse_template_concrete_body_primary, parse_template_semantic_primary,
};

fn body_block(body: &str) -> TemplateBlock {
    TemplateBlock { content: body.to_string(), content_start: 0 }
}

/// Oak-direct Semantic parse (the production ingress).
fn oak_semantic(body: &str) -> Result<vmz_compiler::SemanticIr, String> {
    parse_template_semantic_primary(&body_block(body)).map_err(|e| e.message)
}

/// Concrete → Semantic adapter parse (must agree with the Oak-direct path).
fn adapter_semantic(body: &str) -> Result<vmz_compiler::SemanticIr, String> {
    let concrete = parse_template_concrete_body_primary(body).map_err(|e| e.message)?;
    lower_concrete_to_semantic(&concrete).map_err(|e| e.message)
}

/// Vue rejects the template, so both VMZ layers must fail with the same diagnostic.
fn assert_rejected(body: &str, expected: &str) {
    let oak = oak_semantic(body).expect_err(&format!("oak accepted: {body}"));
    let adapter = adapter_semantic(body).expect_err(&format!("adapter accepted: {body}"));
    assert!(oak.contains(expected), "oak diagnostic `{oak}` lacks `{expected}` for {body}");
    assert!(
        adapter.contains(expected),
        "adapter diagnostic `{adapter}` lacks `{expected}` for {body}"
    );
}

/// Vue accepts the template, so both VMZ layers must parse it.
fn assert_accepted(body: &str) {
    oak_semantic(body).unwrap_or_else(|e| panic!("oak rejected: {body}: {e}"));
    adapter_semantic(body).unwrap_or_else(|e| panic!("adapter rejected: {body}: {e}"));
}

#[test]
fn rejects_duplicate_attribute_names() {
    assert_rejected(r#"<p title="a" title="b">x</p>"#, "duplicate attribute `title`");
    assert_rejected(r#"<p class="a" class="b">x</p>"#, "duplicate attribute `class`");
    assert_rejected(r#"<p v-if="a" v-if="b">x</p>"#, "duplicate attribute `v-if`");
    assert_rejected(r#"<p :title="a" :title="b">x</p>"#, "duplicate attribute `:title`");
}

#[test]
fn rejects_v_slot_on_native_elements() {
    assert_rejected(r#"<div v-slot="p">x</div>"#, "`v-slot` can only be used on components");
    assert_rejected(r#"<slot v-slot="p"></slot>"#, "`v-slot` can only be used on components");
}

#[test]
fn rejects_v_html_and_v_text_with_children() {
    assert_rejected(r#"<p v-html="h">x</p>"#, "`v-html` will override element children");
    assert_rejected(r#"<p v-html="h"><b>x</b></p>"#, "`v-html` will override element children");
    assert_rejected(r#"<p v-text="t">x</p>"#, "`v-text` will override element children");
}

#[test]
fn rejects_v_model_on_non_form_native_elements() {
    assert_rejected(r#"<div v-model="a"></div>"#, "`v-model` can only be used on");
    assert_rejected(r#"<template v-model="a"></template>"#, "`v-model` can only be used on");
    assert_rejected(r#"<svg v-model="a"></svg>"#, "`v-model` can only be used on");
}

#[test]
fn accepts_class_bind_and_distinct_attribute_names() {
    assert_accepted(r#"<p class="a" :class="b">x</p>"#);
    assert_accepted(r#"<p title="a" :title="b">x</p>"#);
    // Vue's duplicate check is case-sensitive.
    assert_accepted(r#"<p title="a" TITLE="b">x</p>"#);
}

#[test]
fn accepts_v_slot_on_components_and_template() {
    assert_accepted(r#"<Comp v-slot="p"><span>x</span></Comp>"#);
    assert_accepted(r#"<Comp><template #header="p"><h1>x</h1></template></Comp>"#);
    assert_accepted(r#"<Comp><template v-slot:footer="p"><p>x</p></template></Comp>"#);
    // Unknown lowercase tags are components for Vue (`isNativeTag` is false).
    assert_accepted(r#"<foo v-slot="p">x</foo>"#);
}

#[test]
fn accepts_v_html_and_v_text_without_element_children() {
    assert_accepted(r#"<p v-html="h"></p>"#);
    assert_accepted("<p v-html=\"h\">\n  </p>");
    assert_accepted(r#"<p v-text="t"></p>"#);
    assert_accepted(r#"<p v-html="h" v-text="t"></p>"#);
}

#[test]
fn accepts_v_model_on_form_controls_and_components() {
    assert_accepted(r#"<input v-model="a">"#);
    assert_accepted(r#"<textarea v-model="a"></textarea>"#);
    assert_accepted(r#"<select v-model="a"></select>"#);
    assert_accepted(r#"<Comp v-model="a" />"#);
    assert_accepted(r#"<my-comp v-model="a" />"#);
}

#[test]
fn accepts_template_fragment_roots() {
    assert_accepted(r#"<template v-if="a"><p>x</p></template>"#);
    assert_accepted(r#"<template v-for="i in xs" :key="i"><p>x</p></template>"#);
}

#[test]
fn accepts_unquoted_attribute_values_as_static_text() {
    assert_accepted(r#"<p title={a}>x</p>"#);
    assert_accepted(r#"<p title=a>x</p>"#);
    assert_accepted(r#"<p title={a} id={b}>x</p>"#);
    assert_accepted(r#"<p :title={a}>x</p>"#);
}

#[test]
fn expands_bind_same_name_shorthand() {
    assert_eq!(first_bind_expr(r#"<p :title></p>"#), "title");
    assert_eq!(first_bind_expr(r#"<p v-bind:title></p>"#), "title");
    assert_eq!(first_bind_expr(r#"<p :foo-bar></p>"#), "fooBar");
    assert_eq!(first_bind_expr(r#"<p :title.camel></p>"#), "title");
    assert_rejected(
        r#"<p :[key]></p>"#,
        "`v-bind` with same-name shorthand only allows a static argument",
    );
}

fn first_bind_expr(body: &str) -> String {
    let semantic = oak_semantic(body).expect("semantic");
    let SemanticNode::Element { props, .. } = &semantic.roots[0] else {
        panic!("expected element, got {:?}", semantic.roots[0]);
    };
    props
        .iter()
        .find_map(|prop| match prop {
            SemanticProp::Bind { expr, .. } => Some(expr.clone()),
            _ => None,
        })
        .unwrap_or_else(|| panic!("expected bind prop, got {props:?}"))
}
