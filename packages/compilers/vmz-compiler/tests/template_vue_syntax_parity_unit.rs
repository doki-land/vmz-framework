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
fn rejects_template_v_slot_outside_a_component() {
    // Vue has no slot host here: it reports `X_V_SLOT_MISPLACED` or fails in codegen.
    assert_rejected(r#"<template v-slot="p">x</template>"#, "inside a component");
    assert_rejected(r#"<template v-slot:footer="p">x</template>"#, "inside a component");
    assert_rejected(r#"<div><template v-slot:x="p">x</template></div>"#, "inside a component");
    assert_rejected(
        r#"<div><section><template v-slot="p">x</template></section></div>"#,
        "inside a component",
    );
}

#[test]
fn rejects_mixed_v_slot_usage() {
    // `X_V_SLOT_MIXED_SLOT_USAGE`: `<Comp v-slot>` plus nested `<template #x>`.
    assert_rejected(r#"<Comp v-slot="p"><template #a>x</template></Comp>"#, "mixed `v-slot` usage");
    assert_rejected(
        r#"<Comp v-slot="p"><template #default>x</template></Comp>"#,
        "mixed `v-slot` usage",
    );
}

#[test]
fn rejects_duplicate_slot_names() {
    assert_rejected(
        r#"<Comp><template #a>1</template><template #a>2</template></Comp>"#,
        "duplicate slot name `a`",
    );
    assert_rejected(
        r#"<Comp><template #a>1</template><template v-slot:a>2</template></Comp>"#,
        "duplicate slot name `a`",
    );
    // Vue's slot analysis ignores slot templates wrapped in control flow.
    assert_accepted(
        r#"<Comp><template v-if="ok" #x>1</template><template v-else #x>2</template></Comp>"#,
    );
    // Sibling components keep their own slot namespace.
    assert_accepted(
        r#"<Comp><template #a>1</template><Inner><template #a>2</template></Inner></Comp>"#,
    );
}

#[test]
fn rejects_extraneous_children_next_to_an_explicit_default_slot() {
    assert_rejected(
        r#"<Comp><template #default>1</template>{{ x }}</Comp>"#,
        "extraneous children",
    );
    assert_rejected(r#"<Comp><template #default>1</template>text</Comp>"#, "extraneous children");
    assert_rejected(
        r#"<Comp><template #default>1</template><template>2</template></Comp>"#,
        "extraneous children",
    );
    // Whitespace-only text and comments are not children for this check.
    assert_accepted(r#"<Comp><template #default>1</template> </Comp>"#);
    assert_accepted(r#"<Comp><template #default>1</template><!-- c --></Comp>"#);
    // Only an explicit `default` slot makes siblings dead.
    assert_accepted(r#"<Comp><template #a>1</template>text</Comp>"#);
}

#[test]
fn rejects_slash_inside_start_tags() {
    // Vue reports `Illegal '/' in tags`; only `/>` may close a start tag.
    assert_rejected(r#"<div a/b="c"></div>"#, "illegal `/` in tags");
    assert_rejected(r#"<div a/b></div>"#, "illegal `/` in tags");
    assert_accepted(r#"<div a=b/c></div>"#);
}

#[test]
fn accepts_source_spelling_variants_of_bind_and_on() {
    // Vue compares raw attribute names, so `:` and `v-bind:` coexist.
    assert_accepted(r#"<p :title="a" v-bind:title="b"></p>"#);
    assert_accepted(r#"<p @click="a" v-on:click="b"></p>"#);
}

#[test]
fn rejects_illegal_directive_names() {
    assert_rejected(r#"<p v-="a"></p>"#, "not a legal directive name");
    assert_rejected(r#"<p v-></p>"#, "not a legal directive name");
    assert_rejected(r#"<p v-.mod="a"></p>"#, "not a legal directive name");
}

#[test]
fn rejects_attribute_names_with_quotes_or_a_leading_equals() {
    // Vue: `X_INVALID_ATTRIBUTE_NAME` and `X_ATTRIBUTE_NAME_CANNOT_START_WITH_EQUAL`.
    assert_rejected(r#"<div "x"></div>"#, "attribute name cannot contain quotes");
    assert_rejected("<div 'x'></div>", "attribute name cannot contain quotes");
    assert_rejected(r#"<div a"b"></div>"#, "attribute name cannot contain quotes");
    assert_rejected("<div =x></div>", "attribute name cannot start with `=`");
    // Vue's tokenizer keeps a quoted directive argument legal, so that spelling must pass.
    assert_accepted(r#"<div :"x"></div>"#);
}

#[test]
fn rejects_unquoted_attribute_values_with_forbidden_characters() {
    // Vue: `X_UNEXPECTED_CHARACTER_IN_UNQUOTED_ATTRIBUTE_VALUE`.
    assert_rejected(r#"<div a=b"c></div>"#, "unquoted attribute value cannot contain");
    assert_rejected("<div a=b`c></div>", "unquoted attribute value cannot contain");
    assert_accepted(r#"<div a=b></div>"#);
    assert_accepted(r#"<div a=b/c></div>"#);
}

#[test]
fn rejects_compound_equals_in_attributes() {
    assert_rejected("<div a==b></div>", "unexpected `=` in attribute");
}

#[test]
fn rejects_an_unterminated_start_tag() {
    // A `<` inside a start tag means the tag was never closed, so the next tag must not be
    // swallowed as attributes.
    assert_rejected(r#"<div a="1""#, "unexpected `<` in tag");
}

#[test]
fn rejects_invalid_end_tags() {
    assert_rejected("</div>", "invalid end tag");
    assert_rejected("<div></section>", "invalid end tag");
}

#[test]
fn rejects_an_unclosed_element() {
    // Vue: `X_MISSING_END_TAG`.
    assert_rejected("<div>x", "element is missing end tag");
    assert_rejected("<div>", "element is missing end tag");
}

#[test]
fn accepts_quoted_values_and_adjacent_attributes() {
    assert_accepted(r#"<div a="<b>">x</div>"#);
    assert_accepted(r#"<div a=">">x</div>"#);
    assert_accepted(r#"<div a="1"b="2"></div>"#);
    assert_accepted(r#"<div .foo="1"></div>"#);
    assert_accepted(r#"<div @="x"></div>"#);
}

#[test]
fn accepts_void_element_close_tags() {
    // Browsers drop `</img>` and Vue reports no diagnostic for it.
    assert_accepted("<img></img>");
    assert_accepted("<br></br>");
    assert_accepted("<input></input>");
    assert_accepted("<template><img></img></template>");
}

#[test]
fn rejects_side_effect_tags_in_templates() {
    assert_rejected("<script>x</script>", "is ignored in client component templates");
    assert_rejected("<style>x</style>", "is ignored in client component templates");
}

#[test]
fn accepts_v_pre() {
    // `v-pre` is valid Vue syntax. VMZ accepts it as `Directive::Custom`; the
    // runtime still compiles `{{ … }}`, so the author must know the directive is
    // treated as an attribute rather than a verbatim block.
    assert_accepted(r#"<div v-pre>{{ x }}</div>"#);
    assert_accepted(r#"<div v-pre>plain</div>"#);
    assert_accepted(r#"<p v-pre :id="x">{{ y }}</p>"#);
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
