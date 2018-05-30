//! Moved from `src/parse/analyze.rs` (cargo-cry: tests next to Cargo.toml).

use vmz_compiler::ScriptKind;

use vmz_compiler::parse::analyze::*;

#[test]
fn public_is_prop() {
    let src = r#"
export default class Card {
  public title: string;
  count = 0;
}
"#;
    let analyzed = analyze_script(ScriptKind::Client, src);
    assert_eq!(analyzed.decl.name, "Card");
    assert_eq!(analyzed.decl.props.len(), 1);
    assert_eq!(analyzed.decl.props[0].name, "title");
    assert_eq!(analyzed.decl.fields.len(), 1);
    assert_eq!(analyzed.decl.fields[0].name, "count");
    assert_eq!(analyzed.decl.fields[0].init_text.as_deref(), Some("0"));
}

#[test]
fn captures_prop_default_init() {
    let src = r#"
export default class CounterButton {
  public initial: number = 0;
  count = this.initial;
}
"#;
    let analyzed = analyze_script(ScriptKind::Client, src);
    assert_eq!(analyzed.decl.props[0].init_text.as_deref(), Some("0"));
    assert_eq!(analyzed.decl.fields[0].init_text.as_deref(), Some("this.initial"));
}

#[test]
fn collects_server_methods() {
    let src = r#"
export default class UserCardServer {
  #users = null;
  async fetchUser() { return null; }
  async getMe() { return this.fetchUser(); }
}
"#;
    let analyzed = analyze_script(ScriptKind::Server, src);
    let names: Vec<_> = analyzed.decl.methods.iter().map(|m| m.name.as_str()).collect();
    assert!(names.contains(&"fetchUser"));
    assert!(names.contains(&"getMe"));
    assert!(analyzed.decl.methods.iter().any(|m| m.name == "fetchUser" && m.is_async));
}

#[test]
fn tracks_method_field_writes() {
    let src = r#"
export default class UserCard {
  user = null;
  tags = [];
  async onMount() {
    this.user = await fetchUser();
    this.tags = ['a'];
  }
}
"#;
    let analyzed = analyze_script(ScriptKind::Client, src);
    let m = analyzed.decl.methods.iter().find(|m| m.name == "onMount").expect("onMount");
    assert!(m.writes.iter().any(|w| w == "user"), "{:?}", m.writes);
    assert!(m.writes.iter().any(|w| w == "tags"), "{:?}", m.writes);
}

#[test]
fn tracks_alias_and_destructure_paths_in_methods() {
    let src = r#"
export default class UserCard {
  user = { name: '', bio: '', profile: { name: '' } };
  rename() {
    const u = this.user;
    u.name = 'Ada';
    const profile = this.user.profile;
    const { name } = profile;
    return name;
  }
}
"#;
    let analyzed = analyze_script(ScriptKind::Client, src);
    let m = analyzed.decl.methods.iter().find(|m| m.name == "rename").expect("rename");
    assert!(m.writes.iter().any(|w| w == "user.name"), "writes={:?}", m.writes);
    assert!(m.reads.iter().any(|r| r == "user.profile.name"), "reads={:?}", m.reads);
}

#[test]
fn tracks_sibling_method_calls() {
    let src = r#"
export default class Card {
  user = { name: '' };
  onClick() {
    this.refresh();
    this.#load();
  }
  refresh() {
    this.user.name = 'x';
  }
  #load() {
    return this.user;
  }
}
"#;
    let analyzed = analyze_script(ScriptKind::Client, src);
    let m = analyzed.decl.methods.iter().find(|m| m.name == "onClick").expect("onClick");
    assert_eq!(m.calls, vec!["refresh".to_string(), "#load".to_string()]);
    assert!(
        m.writes.iter().any(|w| w == "user.name"),
        "composed writes from refresh: {:?}",
        m.writes
    );
    assert!(m.reads.iter().any(|r| r == "user"), "composed reads from #load: {:?}", m.reads);
    let refresh = analyzed.decl.methods.iter().find(|m| m.name == "refresh").expect("refresh");
    assert!(refresh.calls.is_empty());
    assert!(refresh.writes.iter().any(|w| w == "user.name"), "{:?}", refresh.writes);
}

#[test]
fn opaque_dynamic_callee_widens_field_stars() {
    let src = r#"
export default class Card {
  user = { name: '' };
  count = 0;
  run(name) {
    this[name]();
  }
}
"#;
    let analyzed = analyze_script(ScriptKind::Client, src);
    let m = analyzed.decl.methods.iter().find(|m| m.name == "run").expect("run");
    assert!(m.opaque_callee, "dynamic this[name]() must be opaque");
    assert!(m.reads.iter().any(|r| r == "user.*"), "reads={:?}", m.reads);
    assert!(m.writes.iter().any(|w| w == "count.*"), "writes={:?}", m.writes);
}

#[test]
fn unresolved_this_method_is_opaque_not_silent() {
    let src = r#"
export default class Card {
  user = { name: '' };
  onClick() {
    this.maybeHelper();
  }
}
"#;
    let analyzed = analyze_script(ScriptKind::Client, src);
    let m = analyzed.decl.methods.iter().find(|m| m.name == "onClick").expect("onClick");
    assert!(m.calls.is_empty(), "unknown callee must not stay as edge");
    assert!(m.opaque_callee, "unresolved this.maybeHelper() must widen");
    assert!(m.writes.iter().any(|w| w == "user.*"), "writes={:?}", m.writes);
}

#[test]
fn rejects_use_factory() {
    let src = r#"
export default class Bad {
  count = useCounter(0);
}
"#;
    let analyzed = analyze_script(ScriptKind::Client, src);
    assert!(
        analyzed.forbidden_factories.iter().any(|f| f.name == "useCounter"),
        "{:?}",
        analyzed.forbidden_factories
    );
}

#[test]
fn collects_http_decorators() {
    let src = r#"
import { Get } from "vmz:http";
export default class UserCardServer {
  @Get("/api/users/me")
  async getMe() { return null; }
}
"#;
    let analyzed = analyze_script(ScriptKind::Server, src);
    let me = analyzed.decl.methods.iter().find(|m| m.name == "getMe").expect("getMe");
    let http = me.http.as_ref().expect("http route");
    assert_eq!(http.verb, "GET");
    assert_eq!(http.path, "/api/users/me");
}
