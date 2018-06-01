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
