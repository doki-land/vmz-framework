use vmz_compiler::oak::project_nyar_from_vmz;
use vmz_oak_frontend_adapter::{NyarBindingKind, NyarImportKind, NyarMemberKind, NyarProgramRole};

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
    let prop = client.members.iter().find(|m| m.name == "title").expect("title prop");
    assert_eq!(prop.kind, NyarMemberKind::Prop);
    let state = client.members.iter().find(|m| m.name == "count").expect("count state");
    assert_eq!(state.kind, NyarMemberKind::State);

    let server = &input.programs[1];
    assert_eq!(server.role, NyarProgramRole::Server);
    let ping = server.members.iter().find(|m| m.name == "ping").expect("ping method");
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

#[test]
fn nyar_projection_collects_static_imports() {
    let source = r#"<template><div /></template>
<script client>
import { helper } from './lib';
import type { T } from '@pkg/types';
import * as ns from '../ns';
export default class Page {
  public x = 1;
}
</script>
"#;
    let input = project_nyar_from_vmz("Page.vmz", source).expect("project nyar");
    let client = &input.programs[0];
    assert_eq!(client.imports.len(), 3, "imports={:?}", client.imports);

    let named = &client.imports[0];
    assert_eq!(named.module_specifier, "./lib");
    assert!(!named.is_type_only);
    assert_eq!(named.kind, NyarImportKind::Static);
    assert_eq!(named.specifiers.len(), 1);
    assert_eq!(named.specifiers[0].local, "helper");
    assert_eq!(named.specifiers[0].imported.as_deref(), Some("helper"));
    assert_eq!(named.specifiers[0].binding_kind, NyarBindingKind::Named);
    assert!(named.decl_span.start >= client.content_span.start);
    assert!(named.specifier_span.start >= named.decl_span.start);

    let type_only = &client.imports[1];
    assert_eq!(type_only.module_specifier, "@pkg/types");
    assert!(type_only.is_type_only);

    let ns = &client.imports[2];
    assert_eq!(ns.module_specifier, "../ns");
    assert_eq!(ns.specifiers.len(), 1);
    assert_eq!(ns.specifiers[0].local, "ns");
    assert_eq!(ns.specifiers[0].binding_kind, NyarBindingKind::Namespace);
}

#[test]
fn oak_static_import_collect_fills_module_specifier() {
    use vmz_compiler::parse::analyze_oak::collect_static_imports_via_oak;
    use vmz_compiler::sfc::ScriptKind;

    let source = r#"
import { helper } from './lib';
import type { T } from '@pkg/types';
export default class Page {}
"#;
    let imports = collect_static_imports_via_oak(ScriptKind::Client, source);
    assert!(
        imports.iter().any(|i| i.module_specifier == "./lib"),
        "expected Oak path to fill module_specifier, got {imports:?}"
    );
    assert!(
        imports.iter().any(|i| i.module_specifier == "@pkg/types" && i.is_type_only),
        "expected type-only import via Oak, got {imports:?}"
    );
}
