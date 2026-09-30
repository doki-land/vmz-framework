use vmz_compiler::parse_vmz;
use vmz_oak_frontend_adapter::{parse_template_cst, project_parsed_vmz, BlockKind};

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
fn oak_parses_vmz_template_body() {
    let source = r#"<template>
  <div class="v2-feature__icon">
    <span data-name="feature.incremental">icon</span>
  </div>
</template>
<script client>
export default class Icon {}
</script>
"#;
    let parsed = parse_vmz("Icon.vmz", source).expect("parse vmz");
    let cst = parse_template_cst(&parsed.template);
    assert!(cst.ok, "oak CST parse failed: {:?}", cst.diagnostics);
    assert!(cst.shell_source.starts_with("<template>"));
}

#[test]
fn oak_parses_void_elements_in_template() {
    let source = r#"<template>
  <input v-model="name">
  <img :src="url">
  <br>
</template>
<script client>
export default class Page {
  name = '';
  url = '/x';
}
</script>
"#;
    let parsed = parse_vmz("Void.vmz", source).expect("parse vmz");
    let cst = parse_template_cst(&parsed.template);
    assert!(cst.ok, "void elements should parse: {:?}", cst.diagnostics);
}
