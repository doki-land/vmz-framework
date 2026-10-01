//! `template-vue-oak-surface` — Oak layers Semantic must match legacy Concrete→Semantic
//! on a Vue author-syntax matrix (stage C conformance).

use vmz_compiler::{
    SemanticIr, SemanticNode, SemanticProp, TemplateBlock, lower_concrete_to_semantic,
    parse_template_concrete, parse_template_layers_primary, parse_template_semantic_primary,
    semantic_ast_stats,
};

fn body_block(body: &str) -> TemplateBlock {
    TemplateBlock { content: body.to_string(), content_start: 0 }
}

fn legacy_semantic(body: &str) -> SemanticIr {
    let concrete = parse_template_concrete(body).expect("legacy concrete");
    lower_concrete_to_semantic(&concrete).expect("legacy semantic")
}

fn oak_semantic(body: &str) -> SemanticIr {
    parse_template_semantic_primary(&body_block(body)).expect("oak semantic")
}

/// Compare Semantic shape (tags / control-flow / prop kinds), ignoring span offsets
/// which may differ between Oak shell mapping and the legacy body scanner.
fn assert_semantic_shape_eq(oak: &SemanticIr, legacy: &SemanticIr, case: &str) {
    assert_eq!(
        semantic_ast_stats(oak),
        semantic_ast_stats(legacy),
        "{case}: semantic_ast_stats mismatch oak={oak:?} legacy={legacy:?}"
    );
    assert_eq!(
        shape_nodes(&oak.roots),
        shape_nodes(&legacy.roots),
        "{case}: shape mismatch\noak={:?}\nlegacy={:?}",
        oak.roots,
        legacy.roots
    );
}

#[derive(Debug, PartialEq, Eq)]
enum Shape {
    Text(String),
    Interp(String),
    Element { tag: String, props: Vec<String>, children: Vec<Shape> },
    IfChain { branch_tests: Vec<Option<String>>, bodies: Vec<Shape> },
    For {
        source: String,
        value_alias: String,
        key_alias: Option<String>,
        index_alias: Option<String>,
        key: Option<String>,
        body: Box<Shape>,
    },
    SlotOutlet { name: Option<String>, children: Vec<Shape> },
    SlotTemplate { name: String, body: Box<Shape> },
}

fn shape_nodes(nodes: &[SemanticNode]) -> Vec<Shape> {
    nodes.iter().map(shape_node).collect()
}

fn shape_node(node: &SemanticNode) -> Shape {
    match node {
        SemanticNode::Text { value, .. } => Shape::Text(value.clone()),
        SemanticNode::Interpolation { expr, .. } => Shape::Interp(expr.clone()),
        SemanticNode::Element { tag, props, children, .. } => Shape::Element {
            tag: tag.clone(),
            props: props.iter().map(prop_label).collect(),
            children: shape_nodes(children),
        },
        SemanticNode::IfChain { branches, .. } => Shape::IfChain {
            branch_tests: branches.iter().map(|b| b.test.clone()).collect(),
            bodies: branches.iter().map(|b| shape_node(&b.body)).collect(),
        },
        SemanticNode::ForNode {
            source,
            value_alias,
            key_alias,
            index_alias,
            key,
            body,
            ..
        } => Shape::For {
            source: source.clone(),
            value_alias: value_alias.clone(),
            key_alias: key_alias.clone(),
            index_alias: index_alias.clone(),
            key: key.clone(),
            body: Box::new(shape_node(body)),
        },
        SemanticNode::SlotOutlet { name, children, .. } => {
            Shape::SlotOutlet { name: name.clone(), children: shape_nodes(children) }
        }
        SemanticNode::SlotTemplate { name, body, .. } => Shape::SlotTemplate {
            name: match name {
                vmz_compiler::DirectiveArg::Static(s) => s.clone(),
                vmz_compiler::DirectiveArg::Dynamic(e) => format!("[{e}]"),
            },
            body: Box::new(shape_node(body)),
        },
    }
}

fn prop_label(p: &SemanticProp) -> String {
    match p {
        SemanticProp::Static { name, value, .. } => format!("static:{name}={value}"),
        SemanticProp::Bind { arg, expr, .. } => match arg {
            vmz_compiler::DirectiveArg::Static(a) => format!("bind:{a}={expr}"),
            vmz_compiler::DirectiveArg::Dynamic(e) => format!("bind:[{e}]={expr}"),
        },
        SemanticProp::BindObject { expr, .. } => format!("bindObject={expr}"),
        SemanticProp::On { arg, handler, .. } => match arg {
            vmz_compiler::DirectiveArg::Static(a) => format!("on:{a}={handler}"),
            vmz_compiler::DirectiveArg::Dynamic(e) => format!("on:[{e}]={handler}"),
        },
        SemanticProp::OnObject { expr, .. } => format!("onObject={expr}"),
        SemanticProp::Model { arg, expr, .. } => match arg {
            None => format!("model={expr}"),
            Some(a) => format!("model:{a}={expr}"),
        },
        SemanticProp::ClassPlan { .. } => "classPlan".into(),
        SemanticProp::StylePlan { .. } => "stylePlan".into(),
        SemanticProp::Directive { dir, .. } => format!("dir:{dir:?}"),
    }
}

/// Cases where Oak layers Semantic must match legacy Concrete→Semantic today.
const AGREED: &[(&str, &str)] = &[
    ("text_interp", r#"<p>Hi {{ name }}</p>"#),
    ("void_input", r#"<input type="text" />"#),
    ("bind_on", r#"<button :disabled="busy" @click="go">Go</button>"#),
    ("v_if_else", r#"<p v-if="a">A</p><p v-else>B</p>"#),
    (
        "v_if_elseif_else",
        r#"
<p v-if="a">A</p>
<p v-else-if="b">B</p>
<p v-else>C</p>
"#,
    ),
    ("v_for_key", r#"<li v-for="tag in tags" :key="tag.id">{{ tag.label }}</li>"#),
    ("slot_outlet", r#"<slot name="footer"><p>fallback</p></slot>"#),
    ("v_model", r#"<input v-model="q" />"#),
    ("component_link", r#"<Link to="Home">Go</Link>"#),
    ("dynamic_bind_on", r#"<button :[attrName]="val" @[eventName]="onEv">x</button>"#),
    ("ternary_interp", r#"<span>{{ ok ? 'y' : 'n' }}</span>"#),
];

/// Documented Oak Vue gaps — tracked for oaks, not VMZ XML workarounds.
const OAK_GAPS: &[(&str, &str)] = &[
    // oak-vue does not yet lower `<template #name>` / `v-slot` into a usable AST.
    ("hash_slot", r#"<Comp><template #title>T</template></Comp>"#),
];

#[test]
fn oak_and_legacy_semantic_agree_on_vue_surface_matrix() {
    for (name, body) in AGREED {
        let oak = oak_semantic(body);
        let legacy = legacy_semantic(body);
        assert_semantic_shape_eq(&oak, &legacy, name);
    }
}

#[test]
fn layers_primary_concrete_lowers_to_same_semantic_as_oak_primary() {
    for (name, body) in AGREED {
        let (concrete, semantic) =
            parse_template_layers_primary(&body_block(body)).expect(name);
        let from_concrete = lower_concrete_to_semantic(&concrete).expect(name);
        assert_eq!(
            shape_nodes(&semantic.roots),
            shape_nodes(&from_concrete.roots),
            "{name}: layers semantic != concrete→semantic"
        );
        let oak_only = oak_semantic(body);
        assert_semantic_shape_eq(&semantic, &oak_only, name);
    }
}

#[test]
fn oak_gaps_are_documented_not_silently_equal() {
    for (name, body) in OAK_GAPS {
        let oak = oak_semantic(body);
        let legacy = legacy_semantic(body);
        assert_ne!(
            shape_nodes(&oak.roots),
            shape_nodes(&legacy.roots),
            "{name}: unexpectedly matches legacy — remove from OAK_GAPS"
        );
    }
}
