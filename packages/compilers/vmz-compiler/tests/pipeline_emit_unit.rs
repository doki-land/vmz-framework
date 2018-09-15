//! Moved from `src/pipeline/emit.rs` (cargo-cry: tests next to Cargo.toml).

use vmz_types::MethodDecl;

use vmz_compiler::analyze::analyze_script;
use vmz_compiler::pipeline::emit::*;
use vmz_compiler::sfc::ScriptKind;
use vmz_compiler::template::parse_template;

#[test]
fn emits_onmount_and_server_stub() {
    let src = r#"
import type { User } from '#server/db/users';
import { UserCardServer } from '#server/components/UserCard';
export default class UserCard {
  user!: User;
  async onMount() {
this.user = await UserCardServer.fetchUser();
  }
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let ir = parse_template("<p>{user.name}</p>");
    let bridge = ServerBridge {
        module_id: "#server/components/UserCard".into(),
        class_name: "UserCardServer".into(),
        methods: vec![MethodDecl {
            name: "fetchUser".into(),
            is_async: true,
            is_static: false,
            is_private: false,
            http: None,
            reads: vec![],
            writes: vec![],
            calls: vec![],
            opaque_callee: false,
            star_reasons: Vec::new(),
            span: oxc_span::Span::default(),
        }],
    };
    let js = emit_client_js(src, &client, &ir, Some(&bridge)).unwrap();
    assert!(js.contains("onMount"));
    assert!(js.contains("UserCardServer.fetchUser"));
    assert!(js.contains("callServer"));
    assert!(js.contains("vmz:runtime"));
    assert!(js.contains("static fetchUser"));
    assert!(!js.contains("from \"#server/components/UserCard\""));
    assert!(!js.contains("prototype.render"));
    assert!(js.contains("__vmzApplyProps"));
    assert!(js.contains("constructor(props = {})"));
    assert!(js.contains("__vmzCtorAppliesProps = true"));
    assert!(js.contains("__vmzDirect = true"));
    assert!(js.contains("api.bindText(this,"));
    assert!(js.contains("\"user.name\""));
    assert!(js.contains("__vmzMethodRw"));
    assert!(js.contains("\"onMount\""));
    assert!(js.contains("writes:"));
    assert!(js.contains("async: true"), "{js}");
    assert!(js.contains("__vmzRunTask"), "{js}");
    assert!(js.contains("vmz:dom"), "{js}");
    assert_eq!(js.matches("export default").count(), 1);
}

#[test]
fn preserves_source_constructor_without_injecting_a_duplicate() {
    let fields =
        (0..48).map(|index| format!("  field{index} = {index};")).collect::<Vec<_>>().join("\n");
    let src = format!(
        "export default class LargeComponent {{\n{fields}\n  constructor() {{ this.field0 = 99; }}\n}}"
    );
    let client = analyze_script(ScriptKind::Client, &src);
    let template = parse_template("<p>{field0}</p>");
    let js = emit_client_js(&src, &client, &template, None).unwrap();

    assert_eq!(js.matches("constructor(").count(), 1, "{js}");
    assert!(js.contains("__vmzCtorAppliesProps = false"), "{js}");
    assert!(js.contains("this.field0 = 99"), "{js}");
}

#[test]
fn emit_consumes_shared_reactive_view_deps() {
    use vmz_compiler::reactive_build::build_reactive_module;

    let src = "export default class Card { user = { name: \"a\", bio: \"b\" }; }";
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template("<h2>{user.name}</h2><p>{user.bio}</p>");
    let reactive = build_reactive_module("Card.vmz", &client.decl, &tpl);
    let comp = &reactive.components[0];
    let js = emit_client_js_with_ir(src, &client, &tpl, None, Some(comp), None, None).unwrap();
    assert!(js.contains("\"user.name\"") || js.contains("'user.name'"), "{js}");
    assert!(js.contains("\"user.bio\"") || js.contains("'user.bio'"), "{js}");
    // IR BindingId must be emitted on Direct binds (hot path keys).
    let name_id = comp
        .bindings
        .iter()
        .find(|b| {
            b.reads().iter().any(|r| {
                r.to_stable_string(&comp.state_slots, &comp.properties, &comp.exprs) == "user.name"
            })
        })
        .map(|b| b.id().0)
        .expect("user.name binding");
    let bio_id = comp
        .bindings
        .iter()
        .find(|b| {
            b.reads().iter().any(|r| {
                r.to_stable_string(&comp.state_slots, &comp.properties, &comp.exprs) == "user.bio"
            })
        })
        .map(|b| b.id().0)
        .expect("user.bio binding");
    assert!(
        js.contains(&format!("api.bindText(this, {name_id},")),
        "missing bindingId {name_id}: {js}"
    );
    assert!(
        js.contains(&format!("api.bindText(this, {bio_id},")),
        "missing bindingId {bio_id}: {js}"
    );
}

#[test]
fn emits_if_directive() {
    let src = "export default class Card { user = null; }";
    let client = analyze_script(ScriptKind::Client, src);
    let ir = parse_template(r#"<p if={!user}>Loading</p><div if={user}>{user.name}</div>"#);
    let js = emit_client_js(src, &client, &ir, None).unwrap();
    assert!(js.contains("api.ifBlock(this,"), "{js}");
    assert!(js.contains("!this.user") || js.contains("!(this.user)"), "{js}");
    assert!(js.contains("\"user\""), "{js}");
    assert!(!js.contains("prototype.render"), "{js}");
}

#[test]
fn emits_conditional_bind_cf() {
    let src = "export default class T { enabled = true; user = { name: \"a\" }; account = { name: \"b\" }; }";
    let client = analyze_script(ScriptKind::Client, src);
    let ir = parse_template(r#"{enabled ? user.name : account.name}"#);
    let js = emit_client_js(src, &client, &ir, None).unwrap();
    assert!(js.contains("api.bindText(this,"), "{js}");
    assert!(js.contains("stable:"), "{js}");
    assert!(js.contains("branches:"), "{js}");
    assert!(js.contains("user.name"), "{js}");
    assert!(js.contains("account.name"), "{js}");
    assert!(!js.contains("prototype.render"), "{js}");
}

#[test]
fn if_deps_come_from_control_region_only() {
    let src = "export default class T { show = true; aText = \"A\"; bText = \"B\"; }";
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(r#"<div><p if={show}>{aText}</p><p else>{bText}</p></div>"#);
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    // Structural if deps = stable cond only (show), not body texts.
    assert!(
        js.contains("api.ifBlock(this,") && js.contains("[\"show\"]"),
        "if deps must be region stable only: {js}"
    );
    assert!(!js.contains("prototype.render"), "{js}");
}

#[test]
fn emits_if_else_elseif_and_each_key() {
    let src = r#"
export default class Card {
  user = null;
  error = null;
  tags = [];
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let ir = parse_template(
        r#"<p if={!user}>Loading</p><p else-if={error}>{error}</p><div else><li each={tags} as="tag" key={tag}>{tag}</li></div>"#,
    );
    let js = emit_client_js(src, &client, &ir, None).unwrap();
    assert!(js.contains("api.ifBlock(this,"), "{js}");
    assert!(js.contains("this.error") || js.contains("(this.error)"), "{js}");
    assert!(js.contains("api.eachBlock(this,"), "{js}");
    assert!(js.contains("createItem:") || js.contains("createItem"), "{js}");
    assert!(js.contains("box") && js.contains(".item"), "{js}");
    assert!(!js.contains("prototype.render"), "{js}");
}

#[test]
fn emits_apply_props_for_initial_count() {
    let src = r#"
export default class CounterButton {
  public initial: number = 0;
  count = this.initial;
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let ir = parse_template("<button>{count}</button>");
    let js = emit_client_js(src, &client, &ir, None).unwrap();
    assert!(js.contains("__vmzProps = [\"initial\"]"));
    assert!(js.contains("__vmzState = [\"count\"]"));
    assert!(js.contains("this.count = this.initial"));
    assert!(js.contains("props.initial !== undefined"));
}

#[test]
fn emits_component_and_event_handler() {
    let src = r#"
export default class IndexPage {
  count = 0;
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let ir = parse_template(
        r#"<main><CounterButton /><button type="button" onClick={() => count++}>{count}</button></main>"#,
    );
    let js = emit_client_js(src, &client, &ir, None).unwrap();
    assert!(js.contains("api.component(this,"), "{js}");
    assert!(js.contains("\"CounterButton\""), "{js}");
    assert!(js.contains("api.on(") || js.contains("api.on(e"), "{js}");
    assert!(js.contains("this.count++"), "{js}");
    assert!(js.contains("api.bindText(this,"), "{js}");
    assert!(js.contains("\"count\""), "{js}");
    assert!(!js.contains("this.() =>"));
    assert!(!js.contains("prototype.render"), "{js}");
}

#[test]
fn wraps_bare_method_ref_on_component_event_prop() {
    let src = r#"
export default class Page {
  onSelect(_id) {}
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let ir = parse_template(r#"<Select onChange={onSelect} />"#);
    let js = emit_client_js(src, &client, &ir, None).unwrap();
    assert!(js.contains(r#""onChange": (ev) => this.onSelect(ev)"#), "{js}");
}

#[test]
fn emits_client_idle_directive() {
    let src = "export default class IndexPage { title = 'x'; }";
    let client = analyze_script(ScriptKind::Client, src);
    let ir = parse_template(r#"<LikeButton client:idle label="Like" />"#);
    let js = emit_client_js(src, &client, &ir, None).unwrap();
    assert!(js.contains("api.component(this,"), "{js}");
    assert!(js.contains("\"idle\"") || js.contains("'idle'"), "{js}");
    assert!(js.contains("Like") || js.contains("\"label\""), "{js}");
    assert!(!js.contains("prototype.render"), "{js}");
}

#[test]
fn emits_server_methods_and_hash_imports() {
    let src = r#"
import type { User } from '#server/db/users';
import { UsersRepository } from '#server/db/users';
import { Get } from 'vmz:http';
export default class UserCardServer {
  #users = new UsersRepository();
  @Get('/api/users/me')
  async fetchUser(): Promise<User> {
return this.#users.findDefault();
  }
}
"#;
    let server = analyze_script(ScriptKind::Server, src);
    let js = emit_server_js(src, &server, "#server/components/UserCard").unwrap();
    assert!(js.contains("async fetchUser()"));
    assert!(js.contains("../db/users.js"));
    assert!(js.contains("// virtual: #server/components/UserCard"));
    assert!(js.contains("#users"));
    assert!(!js.contains("@Get"));
    assert!(!js.contains("vmz:http"));
    assert_eq!(js.matches("export default").count(), 1);
}

#[test]
fn emits_server_when_http_decorator_shares_method_line() {
    let src = r#"
import { Get } from 'vmz:http';
export default class UserCardServer {
  @Get('/api/users/me') async getMe() {
    return this.fetchUser();
  }
  async fetchUser() {
    return null;
  }
}
"#;
    let server = analyze_script(ScriptKind::Server, src);
    let js = emit_server_js(src, &server, "#server/components/UserCard").unwrap();
    assert!(js.contains("async getMe()"), "{js}");
    assert!(js.contains("async fetchUser()"), "{js}");
    assert!(js.contains("return this.fetchUser()"), "{js}");
    assert!(!js.contains("@Get"), "{js}");
    assert!(!js.contains("vmz:http"), "{js}");
}
