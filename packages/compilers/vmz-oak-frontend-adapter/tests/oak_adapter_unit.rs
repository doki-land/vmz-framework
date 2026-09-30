use vmz_compiler::{parse_vmz, TemplateBlock};
use vmz_oak_frontend_adapter::{parse_template_ast, parse_template_cst, TemplateShellInput};

fn template_shell(block: &TemplateBlock) -> TemplateShellInput {
    TemplateShellInput {
        content: block.content.clone(),
        content_start: block.content_start,
    }
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
    let cst = parse_template_cst(&template_shell(&parsed.template));
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
    let cst = parse_template_cst(&template_shell(&parsed.template));
    assert!(cst.ok, "void elements should parse: {:?}", cst.diagnostics);
}

#[test]
fn oak_builds_ast_for_void_elements() {
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
    let ast = parse_template_ast(&template_shell(&parsed.template));
    assert!(ast.ok, "oak AST build failed: {:?}", ast.diagnostics);
    let root = ast.root.expect("vue root");
    let template_block = root
        .blocks
        .iter()
        .find(|b| ast.shell_source.get(b.name.clone()) == Some("template"))
        .expect("template block");
    assert!(!template_block.children.is_empty(), "expected void element children");
}
