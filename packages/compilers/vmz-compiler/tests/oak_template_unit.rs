use vmz_compiler::{
    oak::project_parsed_vmz, parse_template_concrete, parse_template_concrete_via_oak, parse_vmz,
};
use vmz_oak_frontend_adapter::BlockKind;

#[test]
fn project_vmz_regions_orders_blocks() {
    let source = r#"<router>{}</router>
<template>
  <div>{{ label }}</div>
</template>
<style>
.x {}
</style>
<script client>
export default class Page {
  label = 'hi';
}
</script>
"#;
    let parsed = parse_vmz("Page.vmz", source).expect("parse vmz");
    let view = project_parsed_vmz(&parsed);
    assert_eq!(view.blocks.len(), 4);
    assert_eq!(view.blocks[0].kind, BlockKind::Router);
    assert_eq!(view.blocks[1].kind, BlockKind::Template);
    assert_eq!(view.blocks[2].kind, BlockKind::Style);
    assert_eq!(view.blocks[3].kind, BlockKind::ScriptClient);
}

#[test]
fn oak_lowers_to_concrete_ir_for_void_elements() {
    let body = r#"
  <input v-model="name">
  <img :src="url">
  <br>
"#;
    let _legacy = parse_template_concrete(body).expect("legacy concrete");
    let source = format!(
        r#"<template>{body}</template>
<script client>
export default class Page {{ name = ''; url = '/x'; }}
</script>
"#,
        body = body
    );
    let parsed = parse_vmz("Void.vmz", source).expect("parse vmz");
    let oak = parse_template_concrete_via_oak(&parsed.template).expect("oak concrete");
    assert_eq!(oak.roots.len(), 3, "expected input, img, br as sibling roots");
    let tags: Vec<_> = oak
        .roots
        .iter()
        .filter_map(|n| match n {
            vmz_compiler::ConcreteNode::Element { tag, .. } => Some(tag.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(tags, ["input", "img", "br"]);
}

#[test]
fn oak_lowers_interpolation_to_concrete() {
    let source = r#"<template>
  <p>{{ title }}</p>
</template>
<script client>
export default class Page {
  title = 'hi';
}
</script>
"#;
    let parsed = parse_vmz("Interp.vmz", source).expect("parse vmz");
    let oak = parse_template_concrete_via_oak(&parsed.template).expect("oak concrete");
    assert_eq!(oak.roots.len(), 1);
    let vmz_compiler::ConcreteNode::Element { children, .. } = &oak.roots[0] else {
        panic!("expected element root");
    };
    assert_eq!(children.len(), 1);
    let vmz_compiler::ConcreteNode::Interpolation { expr, .. } = &children[0] else {
        panic!("expected interpolation child");
    };
    assert_eq!(expr.trim(), "title");
}

#[test]
fn oak_lowers_v_if_directive() {
    let source = r#"<template>
  <p v-if="show">x</p>
</template>
<script client>
export default class Page { show = true; }
</script>
"#;
    let parsed = parse_vmz("If.vmz", source).expect("parse vmz");
    let oak = parse_template_concrete_via_oak(&parsed.template).expect("oak concrete");
    let vmz_compiler::ConcreteNode::Element { attrs, .. } = &oak.roots[0] else {
        panic!("expected element");
    };
    let v_if = attrs
        .iter()
        .find(|a| {
            matches!(
                a,
                vmz_compiler::ConcreteAttr::Directive {
                    dir: vmz_compiler::Directive::If { .. },
                    ..
                }
            )
        })
        .expect("v-if directive");
    let vmz_compiler::ConcreteAttr::Directive {
        dir: vmz_compiler::Directive::If { test },
        ..
    } = v_if
    else {
        unreachable!();
    };
    assert_eq!(test, "show");
}

#[test]
fn oak_primary_falls_back_on_dynamic_bind_arg() {
    let body = r#"<button :[attrName]="val" @[eventName]="onEv">x</button>"#;
    let source = format!(
        r#"<template>{body}</template>
<script client>
export default class Page {{ val = 1; onEv() {{}} }}
</script>
"#,
        body = body
    );
    let parsed = parse_vmz("Dyn.vmz", source).expect("parse vmz");
    let primary = vmz_compiler::parse_template_concrete_primary(&parsed.template).expect("primary");
    let legacy = parse_template_concrete(body).expect("legacy");
    assert_eq!(primary.roots.len(), legacy.roots.len());
}
