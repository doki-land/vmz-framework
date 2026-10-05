use vmz_compiler::{TemplateBlock, parse_vmz};
use vmz_oak_frontend_adapter::{
    ScriptRole, ScriptShellInput, TemplateShellInput, parse_expression_snippet, parse_script_ast,
    parse_template_ast, parse_template_cst,
};

fn template_shell(block: &TemplateBlock) -> TemplateShellInput {
    TemplateShellInput { content: block.content.clone(), content_start: block.content_start }
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
fn oak_cst_parses_pascal_case_link_component_without_hang() {
    let source = r#"<template>
  <main>
    <Link to="IndexPage">
      Home
    </Link>
  </main>
</template>
<script client>
export default class AboutPage {}
</script>
"#;
    let parsed = parse_vmz("About.vmz", source).expect("parse vmz");
    let cst = parse_template_cst(&template_shell(&parsed.template));
    assert!(cst.ok, "PascalCase Link must not be treated as void <link>: {:?}", cst.diagnostics);
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

#[test]
fn oak_cst_parses_keyword_for_attr_without_hang() {
    let source = r#"<template>
  <label :for="controlId">{{ label }}</label>
</template>
<script client>
export default class Field {
  controlId = 'x';
  label = 'Name';
}
</script>
"#;
    let parsed = parse_vmz("Field.vmz", source).expect("parse vmz");
    let shell = template_shell(&parsed.template);
    let cst = parse_template_cst(&shell);
    assert!(cst.ok, "`:for` must not hang CST: {:?}", cst.diagnostics);
    let ast = parse_template_ast(&shell);
    assert!(ast.ok, "`:for` must not hang AST: {:?}", ast.diagnostics);
}

#[test]
fn oak_cst_parses_ternary_interpolation_without_hang() {
    let source = r#"<template>
  <button>{{ armed ? "ON" : "OFF" }}</button>
</template>
<script client>
export default class EventButton {
  armed = false;
}
</script>
"#;
    let parsed = parse_vmz("EventButton.vmz", source).expect("parse vmz");
    let cst = parse_template_cst(&template_shell(&parsed.template));
    assert!(cst.ok, "ternary interpolation CST failed: {:?}", cst.diagnostics);
}

#[test]
fn oak_cst_parses_autocomplete_template_without_hang() {
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../ui/vmz-ui/src/components/Autocomplete.vmz");
    if !path.exists() {
        eprintln!("skip autocomplete fixture: {}", path.display());
        return;
    }
    let source = std::fs::read_to_string(&path).expect("read Autocomplete.vmz");
    let parsed = parse_vmz(&path, source).expect("parse vmz");
    let cst = parse_template_cst(&template_shell(&parsed.template));
    assert!(cst.ok, "Autocomplete template CST failed: {:?}", cst.diagnostics);
}

fn script_shell(block: &vmz_compiler::ScriptBlock, role: ScriptRole) -> ScriptShellInput {
    ScriptShellInput { content: block.content.clone(), content_start: block.content_start, role }
}

#[test]
fn oak_parses_client_and_server_script_blocks() {
    let source = r#"<template><p>{{ title }}</p></template>
<script client>
export default class Page {
  public title = 'hi';
}
</script>
<script server>
export default class PageServer {
  @Get('/api/ping')
  async ping() {
    return { ok: true };
  }
}
</script>
"#;
    let parsed = parse_vmz("Page.vmz", source).expect("parse vmz");
    let client = parse_script_ast(&script_shell(&parsed.client, ScriptRole::Client));
    assert!(client.ok, "client script AST failed: {:?}", client.diagnostics);
    assert_eq!(client.default_export_class.as_deref(), Some("Page"));

    let server = parsed.server.as_ref().expect("server block");
    let server_ast = parse_script_ast(&script_shell(server, ScriptRole::Server));
    assert!(server_ast.ok, "server script AST failed: {:?}", server_ast.diagnostics);
    assert_eq!(server_ast.default_export_class.as_deref(), Some("PageServer"));
}

#[test]
fn oak_expression_snippet_accepts_member_and_ternary() {
    for expr in ["user.name", "a ? b : c", "tags.length"] {
        let parsed = parse_expression_snippet(expr);
        assert!(parsed.ok, "{expr}: {:?}", parsed.diagnostics);
        let span = parsed.root_span.expect("span");
        assert_eq!(&expr[span.start..span.end], expr);
    }
}

#[test]
fn oak_expression_snippet_accepts_vue_expression_boundaries() {
    for expr in ["type", "(() => toggle(item.id))", "({ id: \"sku-1\" })"] {
        let parsed = parse_expression_snippet(expr);
        assert!(parsed.ok, "{expr}: {:?}", parsed.diagnostics);
    }
}

#[test]
fn oak_expression_snippet_rejects_incomplete_binary() {
    let parsed = parse_expression_snippet("1 +");
    assert!(!parsed.ok, "incomplete binary must fail even if Oak is silent");
    assert!(!parsed.diagnostics.is_empty());
}
