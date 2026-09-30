use vmz_compiler::oak::project_nyar_from_vmz;
use vmz_oak_frontend_adapter::{NyarMemberKind, NyarProgramRole};

#[test]
fn nyar_projection_maps_client_props_and_server_boundary() {
    let source = r#"<template>
  <p>{{ title }}</p>
</template>
<script client>
export default class Page {
  public title = 'hi';
  count = 0;
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
    let input = project_nyar_from_vmz("Page.vmz", source).expect("project nyar");
    assert!(input.has_server_boundary);
    assert_eq!(input.programs.len(), 2);

    let client = &input.programs[0];
    assert_eq!(client.role, NyarProgramRole::Client);
    assert_eq!(client.component_name, "Page");
    let prop = client
        .members
        .iter()
        .find(|m| m.name == "title")
        .expect("title prop");
    assert_eq!(prop.kind, NyarMemberKind::Prop);
    let state = client
        .members
        .iter()
        .find(|m| m.name == "count")
        .expect("count state");
    assert_eq!(state.kind, NyarMemberKind::State);

    let server = &input.programs[1];
    assert_eq!(server.role, NyarProgramRole::Server);
    let ping = server
        .members
        .iter()
        .find(|m| m.name == "ping")
        .expect("ping method");
    assert_eq!(ping.kind, NyarMemberKind::Method);
    assert!(ping.is_async);
    let route = ping.http_route.as_ref().expect("http route");
    assert_eq!(route.verb, "GET");
    assert_eq!(route.path, "/api/ping");
}

#[test]
fn nyar_projection_preserves_sfc_block_regions() {
    let source = r#"<router>{ path: "/" }</router>
<template><div /></template>
<script client>
export default class Home {}
</script>
"#;
    let input = project_nyar_from_vmz("Home.vmz", source).expect("project nyar");
    assert!(!input.has_server_boundary);
    assert_eq!(input.document.blocks.len(), 3);
}
