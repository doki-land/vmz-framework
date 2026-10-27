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
    parse_template_semantic_primary(&body_block(body)).map_err(|e| e.render_plain())
}

/// Concrete → Semantic adapter parse (must agree with the Oak-direct path).
fn adapter_semantic(body: &str) -> Result<vmz_compiler::SemanticIr, String> {
    let concrete = parse_template_concrete_body_primary(body).map_err(|e| e.render_plain())?;
    lower_concrete_to_semantic(&concrete).map_err(|e| e.render_plain())
}

/// Vue rejects the template, so both VMZ layers must fail with the same diagnostic.
///
/// VMZ's Oak parser rejects malformed template syntax at the CST level with stable
/// `oak::syntax` / `oak::expected_token` codes (see `vmz-oak-frontend-adapter::describe`).
/// We pin two invariants here:
///   1. Both the Oak-direct and Concrete→Semantic paths reject the same body.
///   2. The two paths surface the same **set** of Oak diagnostic kinds — parity is
///      tracked at the diagnostic-code level, not by Vue's human-readable message
///      (which VMZ intentionally leaves to catalog localization).
fn assert_rejected(body: &str) {
    let oak = oak_semantic(body).expect_err(&format!("oak accepted: {body}"));
    let adapter = adapter_semantic(body).expect_err(&format!("adapter accepted: {body}"));

    let extract_codes = |rendered: &str| -> Vec<String> {
        let mut v: Vec<String> = rendered
            .split("; ")
            .filter_map(|part| {
                let trimmed = part.trim();
                if let Some((head, _)) = trimmed.split_once(' ') {
                    Some(head.to_string())
                } else if !trimmed.is_empty() {
                    Some(trimmed.to_string())
                } else {
                    None
                }
            })
            .collect();
        v.sort();
        v.dedup();
        v
    };

    let oak_codes = extract_codes(&oak);
    let adapter_codes = extract_codes(&adapter);

    assert_eq!(
        oak_codes, adapter_codes,
        "oak vs adapter code mismatch for {body}\n  oak:     {oak}\n  adapter: {adapter}"
    );
}

/// Vue accepts the template, so both VMZ layers must parse it.
fn assert_accepted(body: &str) {
    oak_semantic(body).unwrap_or_else(|e| panic!("oak rejected: {body}: {e}"));
    adapter_semantic(body).unwrap_or_else(|e| panic!("adapter rejected: {body}: {e}"));
}

#[test]
fn rejects_duplicate_attribute_names() {
    assert_rejected(r#"<p title="a" title="b">x</p>"#);
    assert_rejected(r#"<p class="a" class="b">x</p>"#);
    assert_rejected(r#"<p v-if="a" v-if="b">x</p>"#);
    assert_rejected(r#"<p :title="a" :title="b">x</p>"#);
}

#[test]
fn rejects_v_slot_on_native_elements() {
    assert_rejected(r#"<div v-slot="p">x</div>"#);
    assert_rejected(r#"<slot v-slot="p"></slot>"#);
}

#[test]
fn rejects_template_v_slot_outside_a_component() {
    // Vue has no slot host here: it reports `X_V_SLOT_MISPLACED` or fails in codegen.
    assert_rejected(r#"<template v-slot="p">x</template>"#);
    assert_rejected(r#"<template v-slot:footer="p">x</template>"#);
    assert_rejected(r#"<div><template v-slot:x="p">x</template></div>"#);
    assert_rejected(r#"<div><section><template v-slot="p">x</template></section></div>"#);
}

#[test]
fn rejects_mixed_v_slot_usage() {
    // `X_V_SLOT_MIXED_SLOT_USAGE`: `<Comp v-slot>` plus nested `<template #x>`.
    assert_rejected(r#"<Comp v-slot="p"><template #a>x</template></Comp>"#);
    assert_rejected(r#"<Comp v-slot="p"><template #default>x</template></Comp>"#);
}

#[test]
fn rejects_duplicate_slot_names() {
    assert_rejected(r#"<Comp><template #a>1</template><template #a>2</template></Comp>"#);
    assert_rejected(r#"<Comp><template #a>1</template><template v-slot:a>2</template></Comp>"#);
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
    assert_rejected(r#"<Comp><template #default>1</template>{{ x }}</Comp>"#);
    assert_rejected(r#"<Comp><template #default>1</template>text</Comp>"#);
    assert_rejected(r#"<Comp><template #default>1</template><template>2</template></Comp>"#);
    // Whitespace-only text and comments are not children for this check.
    assert_accepted(r#"<Comp><template #default>1</template> </Comp>"#);
    assert_accepted(r#"<Comp><template #default>1</template><!-- c --></Comp>"#);
    // Only an explicit `default` slot makes siblings dead.
    assert_accepted(r#"<Comp><template #a>1</template>text</Comp>"#);
}

#[test]
fn rejects_slash_inside_start_tags() {
    // Vue reports `Illegal '/' in tags`; only `/>` may close a start tag.
    assert_rejected(r#"<div a/b="c"></div>"#);
    assert_rejected(r#"<div a/b></div>"#);
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
    assert_rejected(r#"<p v-="a"></p>"#);
    assert_rejected(r#"<p v-></p>"#);
    assert_rejected(r#"<p v-.mod="a"></p>"#);
}

#[test]
fn rejects_attribute_names_with_quotes_or_a_leading_equals() {
    // Vue: `X_INVALID_ATTRIBUTE_NAME` and `X_ATTRIBUTE_NAME_CANNOT_START_WITH_EQUAL`.
    assert_rejected(r#"<div "x"></div>"#);
    assert_rejected("<div 'x'></div>");
    assert_rejected(r#"<div a"b"></div>"#);
    assert_rejected("<div =x></div>");
    // Vue's tokenizer keeps a quoted directive argument legal, so that spelling must pass.
    assert_accepted(r#"<div :"x"></div>"#);
}

#[test]
fn rejects_unquoted_attribute_values_with_forbidden_characters() {
    // Vue: `X_UNEXPECTED_CHARACTER_IN_UNQUOTED_ATTRIBUTE_VALUE`.
    assert_rejected(r#"<div a=b"c></div>"#);
    assert_rejected("<div a=b`c></div>");
    assert_accepted(r#"<div a=b></div>"#);
    assert_accepted(r#"<div a=b/c></div>"#);
}

#[test]
fn rejects_compound_equals_in_attributes() {
    assert_rejected("<div a==b></div>");
}

#[test]
fn rejects_an_unterminated_start_tag() {
    // A `<` inside a start tag means the tag was never closed, so the next tag must not be
    // swallowed as attributes.
    assert_rejected(r#"<div a="1""#);
}

#[test]
fn rejects_invalid_end_tags() {
    assert_rejected("</div>");
    assert_rejected("<div></section>");
}

#[test]
fn rejects_an_unclosed_element() {
    // Vue: `X_MISSING_END_TAG`.
    assert_rejected("<div>x");
    assert_rejected("<div>");
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
    assert_rejected("<script>x</script>");
    assert_rejected("<style>x</style>");
}

#[test]
fn accepts_v_pre() {
    // `v-pre` is valid Vue syntax. VMZ accepts it and treats it as a **verbatim region**
    // rather than a custom directive — see `verbatim_v_pre_skips_interpolation` and
    // `verbatim_v_pre_skips_directives` for semantic coverage.
    assert_accepted(r#"<div v-pre>{{ x }}</div>"#);
    assert_accepted(r#"<div v-pre>plain</div>"#);
    assert_accepted(r#"<p v-pre :id="x">{{ y }}</p>"#);
}

#[test]
fn verbatim_v_pre_skips_interpolation() {
    use vmz_compiler::SemanticIr;

    let body = r#"<div v-pre>{{ x }}<span>{{ y }}</span></div>"#;
    let oak = oak_semantic(body).expect("oak parse");
    let adapter = adapter_semantic(body).expect("adapter parse");

    for (label, semantic) in [("oak", oak), ("adapter", adapter)] {
        let SemanticIr { roots } = &semantic;
        let SemanticNode::Element { tag, props, children, .. } = &roots[0] else {
            panic!("{label}: expected root element");
        };
        assert_eq!(tag, "div");
        // v-pre attr is preserved as plain Static (source spelling).
        assert!(
            props.iter().any(|p| matches!(p, SemanticProp::Static { name, .. } if name == "v-pre")),
            "{label}: v-pre should be kept as Static prop"
        );
        // Verbatim subtree must contain NO Interpolation nodes — they became Text.
        let interp_count = count_interpolations(children);
        assert_eq!(interp_count, 0, "{label}: verbatim subtree must have zero Interpolation");
        // And the literal `{{ x }}` / `{{ y }}` must survive as Text nodes.
        let text_values = flatten_text_values(children);
        assert!(
            text_values.iter().any(|t| t == "{{ x }}"),
            "{label}: expected literal text `{{ x }}`, got {text_values:?}"
        );
        assert!(
            text_values.iter().any(|t| t == "{{ y }}"),
            "{label}: expected literal text `{{ y }}`, got {text_values:?}"
        );
    }
}

#[test]
fn verbatim_v_pre_skips_directives() {
    let body = r#"<div v-pre :class="cls" @click="fn" v-if="ok"><span v-for="i in xs">{{ i }}</span></div>"#;
    let semantic = oak_semantic(body).expect("oak parse");

    let SemanticNode::Element { tag, props, children, .. } = &semantic.roots[0] else {
        panic!("expected root element");
    };
    assert_eq!(tag, "div");

    // Every prop on the verbatim root must be Static — no Bind/On/Model/ClassPlan/StylePlan.
    for p in props {
        assert!(
            matches!(p, SemanticProp::Static { .. }),
            "verbatim root prop must be Static, got {p:?}"
        );
    }

    // And recursively through children: verbatim subtrees must have zero Interp/Bind/On/Model.
    assert!(!has_non_static_prop(children), "verbatim subtree must not contain reactive props");
    assert_eq!(count_interpolations(children), 0);
}

#[test]
fn v_pre_does_not_affect_siblings_or_parent() {
    let body = r#"<p>{{ a }}</p><div v-pre>{{ b }}</div><span :title="t">{{ c }}</span>"#;
    let semantic = oak_semantic(body).expect("oak parse");

    // Three roots:
    // 1. <p>{{ a }}</p> — NORMAL, should have one Interpolation child
    // 2. <div v-pre>{{ b }}</div> — VERBATIM
    // 3. <span :title="t">{{ c }}</span> — NORMAL, should have Bind + Interp
    assert_eq!(semantic.roots.len(), 3);

    // Root 1: normal interpolation
    let SemanticNode::Element { children, .. } = &semantic.roots[0] else {
        panic!("root 1");
    };
    let interp_count = count_interpolations(children);
    assert_eq!(interp_count, 1, "sibling <p> must keep its Interpolation");

    // Root 3: sibling with bind + interpolation
    let SemanticNode::Element { props, children, .. } = &semantic.roots[2] else {
        panic!("root 3");
    };
    assert!(
        props.iter().any(|p| matches!(p, SemanticProp::Bind { .. })),
        "sibling <span> must keep its Bind prop"
    );
    assert_eq!(count_interpolations(children), 1);
}

fn count_interpolations(nodes: &[SemanticNode]) -> usize {
    let mut n = 0;
    for node in nodes {
        match node {
            SemanticNode::Interpolation { .. } => n += 1,
            SemanticNode::Element { children, .. } | SemanticNode::SlotOutlet { children, .. } => {
                n += count_interpolations(children)
            }
            SemanticNode::IfChain { branches, .. } => {
                for b in branches {
                    n += count_interpolations(std::slice::from_ref(b.body.as_ref()));
                }
            }
            SemanticNode::ForNode { body, .. } | SemanticNode::SlotTemplate { body, .. } => {
                n += count_interpolations(std::slice::from_ref(body.as_ref()));
            }
            SemanticNode::Text { .. } => {}
        }
    }
    n
}

fn flatten_text_values(nodes: &[SemanticNode]) -> Vec<String> {
    let mut out = Vec::new();
    for node in nodes {
        match node {
            SemanticNode::Text { value, .. } => out.push(value.clone()),
            SemanticNode::Element { children, .. } | SemanticNode::SlotOutlet { children, .. } => {
                out.extend(flatten_text_values(children))
            }
            SemanticNode::IfChain { branches, .. } => {
                for b in branches {
                    out.extend(flatten_text_values(std::slice::from_ref(b.body.as_ref())));
                }
            }
            SemanticNode::ForNode { body, .. } | SemanticNode::SlotTemplate { body, .. } => {
                out.extend(flatten_text_values(std::slice::from_ref(body.as_ref())));
            }
            SemanticNode::Interpolation { .. } => {
                panic!(
                    "flatten_text_values: unexpected Interpolation — caller must filter verbatim first"
                )
            }
        }
    }
    out
}

fn has_non_static_prop(nodes: &[SemanticNode]) -> bool {
    for node in nodes {
        match node {
            SemanticNode::Element { props, children, .. } => {
                for p in props {
                    if !matches!(p, SemanticProp::Static { .. }) {
                        return true;
                    }
                }
                if has_non_static_prop(children) {
                    return true;
                }
            }
            SemanticNode::IfChain { branches, .. } => {
                for b in branches {
                    if has_non_static_prop(std::slice::from_ref(b.body.as_ref())) {
                        return true;
                    }
                }
            }
            SemanticNode::ForNode { body, .. } | SemanticNode::SlotTemplate { body, .. } => {
                if has_non_static_prop(std::slice::from_ref(body.as_ref())) {
                    return true;
                }
            }
            SemanticNode::SlotOutlet { children, .. } => {
                if has_non_static_prop(children) {
                    return true;
                }
            }
            SemanticNode::Text { .. } | SemanticNode::Interpolation { .. } => {}
        }
    }
    false
}

#[test]
fn rejects_v_html_and_v_text_with_children() {
    assert_rejected(r#"<p v-html="h">x</p>"#);
    assert_rejected(r#"<p v-html="h"><b>x</b></p>"#);
    assert_rejected(r#"<p v-text="t">x</p>"#);
}

#[test]
fn rejects_v_model_on_non_form_native_elements() {
    assert_rejected(r#"<div v-model="a"></div>"#);
    assert_rejected(r#"<template v-model="a"></template>"#);
    assert_rejected(r#"<svg v-model="a"></svg>"#);
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
    assert_rejected(r#"<p :[key]></p>"#);
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

#[test]
fn v_for_accepts_object_destructuring_aliases() {
    assert_accepted(r#"<div v-for="{ a, b } in items" :key="a">{{ a }} {{ b }}</div>"#);
    assert_accepted(r#"<div v-for="{ a = 1, b } in items" :key="a">{{ a }}</div>"#);
    assert_accepted(
        r#"<div v-for="{ a, b: { c } } in items" :key="a">{{ a }} {{ c }}</div>"#,
    );
}

#[test]
fn v_for_accepts_array_destructuring_aliases() {
    assert_accepted(r#"<div v-for="[ first, second ] in list" :key="first">{{ first }}</div>"#);
    assert_accepted(r#"<div v-for="[ first, ...rest ] in list" :key="first">{{ first }}</div>"#);
}

#[test]
fn v_for_rejects_same_element_v_if() {
    assert_rejected(r#"<div v-for="i in xs" v-if="ok">{{ i }}</div>"#);
    assert_rejected(r#"<div v-if="ok" v-for="i in xs">{{ i }}</div>"#);
}

#[test]
fn v_for_rejects_same_element_v_else_if() {
    assert_rejected(r#"<div v-for="i in xs" v-else-if="ok">{{ i }}</div>"#);
}

#[test]
fn v_for_rejects_same_element_v_else() {
    assert_rejected(r#"<div v-for="i in xs" v-else>{{ i }}</div>"#);
}
