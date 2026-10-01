//! Oak-primary script surface analysis (phase B2).

use vmz_compiler::analyze::analyze_script;
use vmz_compiler::parse::analyze_oak::try_component_decl_via_oak;
use vmz_compiler::sfc::ScriptKind;
use vmz_types::FieldKind;

#[test]
fn oak_lowers_default_export_props_and_state() {
    let src = r#"
export default class Page {
  public title = 'hi';
  count = 0;
  onClick() {}
}
"#;
    let oak = try_component_decl_via_oak(ScriptKind::Client, src).expect("oak surface");
    assert_eq!(oak.name, "Page");
    assert!(oak.properties.iter().any(|f| f.name == "title" && f.kind == FieldKind::Prop));
    assert!(oak.fields.iter().any(|f| f.name == "count" && f.kind == FieldKind::State));
    assert!(oak.methods.iter().any(|m| m.name == "onClick"));
}

#[test]
fn analyze_script_prefers_oak_surface_with_method_rw() {
    let src = r#"
export default class Page {
  public title = 'hi';
  count = 0;
  bump() {
    this.count++;
  }
}
"#;
    let analyzed = analyze_script(ScriptKind::Client, src);
    assert_eq!(analyzed.decl.name, "Page");
    assert!(analyzed.decl.properties.iter().any(|f| f.name == "title"));
    assert!(analyzed.decl.fields.iter().any(|f| f.name == "count"));
    let bump = analyzed.decl.methods.iter().find(|m| m.name == "bump").expect("bump");
    assert!(bump.writes.iter().any(|w| w == "count"), "writes={:?}", bump.writes);
}

#[test]
fn oak_lowers_server_http_decorator() {
    let src = r#"
export default class PageServer {
  @Get('/api/ping')
  async ping() {
    return { ok: true };
  }
}
"#;
    let oak = try_component_decl_via_oak(ScriptKind::Server, src).expect("oak server");
    let ping = oak.methods.iter().find(|m| m.name == "ping").expect("ping");
    assert!(ping.is_async);
    let http = ping.http.as_ref().expect("http");
    assert_eq!(http.verb, "GET");
    assert_eq!(http.path, "/api/ping");
}
