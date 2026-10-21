//! Moved from `src/parse/sfc.rs` (cargo-cry: tests next to Cargo.toml).

use vmz_compiler::parse::sfc::*;

#[test]
fn parses_router_before_template() {
    let src = r#"
<router>
{ id: "home", path: "/" }
</router>
<template><h1>hi</h1></template>
<script client>
export default class IndexPage {}
</script>
"#;
    let parsed = parse_vmz("x.vmz", src).unwrap();
    assert!(parsed.router.as_ref().unwrap().content.contains("home"));
    assert!(parsed.meta.is_none());
}

#[test]
fn parses_router_path_attr_shorthand() {
    let src = r#"
<router path="/docs" />
<template><h1>hi</h1></template>
<script client>
export default class DocsPage {}
</script>
"#;
    let parsed = parse_vmz("x.vmz", src).unwrap();
    let router = parsed.router.as_ref().unwrap();
    assert!(router.content.trim().is_empty());
    assert!(router.attrs.contains("path"));
}

#[test]
fn parses_client_only() {
    let src = r#"
<template><h1>hi</h1></template>
<script client>
export default class Application {}
</script>
"#;
    let parsed = parse_vmz("x.vmz", src).unwrap();
    assert!(parsed.server.is_none());
    assert!(parsed.client.content.contains("export default class Application"));
}

#[test]
fn preserves_script_language_attribute() {
    let src = r#"
<template><h1>hi</h1></template>
<script client>
export default class Application {}
</script>
<script server lang="rust">
fn main() {}
</script>
"#;
    let parsed = parse_vmz("x.vmz", src).unwrap();
    assert_eq!(parsed.server.unwrap().lang, ScriptLanguage::Rust);
}

#[test]
fn rejects_server_before_client() {
    let src = r#"
<template></template>
<script server>
export default class S {}
</script>
<script client>
export default class C {}
</script>
"#;
    assert!(parse_vmz("x.vmz", src).is_err());
}

#[test]
fn keeps_nested_template_slot_fillers_in_the_template_block() {
    let src = r#"
<template>
  <Comp>
    <template #header><h1>t</h1></template>
    <template v-slot:footer="p"><p>{{ p.n }}</p></template>
  </Comp>
</template>
<script client>
export default class IndexPage {}
</script>
"#;
    let parsed = parse_vmz("x.vmz", src).unwrap();
    assert!(parsed.template.content.contains("#header"));
    assert!(parsed.template.content.contains("v-slot:footer"));
    assert!(parsed.template.content.contains("{{ p.n }}"));
}

#[test]
fn keeps_nested_template_fragment_roots_in_the_template_block() {
    let src = r#"
<template>
  <template v-if="ok"><p>a</p></template>
  <template v-for="i in xs" :key="i"><p>{{ i }}</p></template>
</template>
<script client>
export default class IndexPage {}
</script>
"#;
    let parsed = parse_vmz("x.vmz", src).unwrap();
    assert!(parsed.template.content.contains("v-if=\"ok\""));
    assert!(parsed.template.content.contains("v-for=\"i in xs\""));
}

#[test]
fn ignores_template_closing_text_inside_comments_and_attribute_values() {
    let src = r#"
<template>
  <!-- </template> -->
  <p :title="'</template>'">x</p>
</template>
<script client>
export default class IndexPage {}
</script>
"#;
    let parsed = parse_vmz("x.vmz", src).unwrap();
    assert!(parsed.template.content.contains("</template>"));
    assert!(parsed.template.content.contains("x</p>"));
}
