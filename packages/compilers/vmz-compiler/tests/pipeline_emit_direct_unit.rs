//! Moved from `src/pipeline/emit_direct.rs` (cargo-cry: tests next to Cargo.toml).

use vmz_protocol::*;

use vmz_compiler::analyze::analyze_script;
use vmz_compiler::emit::emit_client_js;
use vmz_compiler::pipeline::emit_direct::*;
use vmz_compiler::reactive_build::build_program_module;
use vmz_compiler::sfc::ScriptKind;
use vmz_compiler::template::parse_template;

#[test]
fn leaf_button_emits_vmz_create() {
    let src = r#"
export default class CounterButton {
  public initial: number = 0;
  count = this.initial;
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl =
        parse_template(r#"<button type="button" onClick={() => count++}>count: {count}</button>"#);
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    let view = &program.units[0].view;
    assert_eq!(view.status, ViewStatus::Native);
    assert!(is_direct_eligible(view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    assert!(js.contains("__vmzDirect = true"), "{js}");
    assert!(js.contains("__vmzCreate = function __vmzCreate(api)"), "{js}");
    assert!(js.contains("api.bindText(this,"), "{js}");
    assert!(js.contains("api.bindText(this, 1,"), "{js}");
    assert!(!js.contains("prototype.render"), "{js}");
}

#[test]
fn if_else_emits_if_block() {
    let src = r#"
export default class BranchDemo {
  showA = true;
  aText = "A";
  bText = "B";
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(r#"<div><p if={showA}>{aText}</p><p else>{bText}</p></div>"#);
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    assert!(js.contains("api.ifBlock(this,"), "{js}");
    assert!(js.contains("__vmzDirect = true"), "{js}");
}

#[test]
fn each_emits_each_block() {
    let src = r#"
export default class ListDemo {
  tags: { id: string; label: string }[] = [];
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(r#"<ul><li each={tags} as="tag" key={tag.id}>{tag.label}</li></ul>"#);
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    assert!(js.contains("api.eachBlock(this,"), "{js}");
    assert!(js.contains("createItem:"), "{js}");
}

#[test]
fn component_tag_is_eligible() {
    let src = r#"
export default class Host {
  x = 1;
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(r#"<div><Child count={x} /></div>"#);
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    assert!(program.units[0]
        .view
        .roots
        .iter()
        .any(|n| matches!(n, ViewNode::Element { children, .. } if children.iter().any(|c| matches!(c, ViewNode::Component { .. })))));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    assert!(js.contains("api.component(this,"), "{js}");
}

#[test]
fn ternary_emits_cf_bind_text() {
    let src = r#"
export default class LikeButton {
  liked = false;
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(r#"<button>{liked ? '♥' : '♡'}</button>"#);
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    assert!(js.contains("__vmzDirect = true"), "{js}");
    assert!(js.contains("api.bindText(this,"), "{js}");
    assert!(js.contains("stable:"), "{js}");
    assert!(js.contains("branches:"), "{js}");
    assert!(!js.contains("prototype.render"), "{js}");
}

#[test]
fn slot_is_eligible() {
    let src = r#"
export default class Application {}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(r#"<div><slot /></div>"#);
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    assert!(js.contains("api.el(\"slot\")"), "{js}");
}

#[test]
fn if_chain_eligible() {
    let src = r#"
export default class BranchDemo {
  showA = true;
  aText = "A";
  bText = "B";
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(r#"<div><p if={showA}>{aText}</p><p else>{bText}</p></div>"#);
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    assert!(program.units[0].view.roots.iter().any(|n| {
        matches!(n, ViewNode::Element { children, .. } if children.iter().any(|c| matches!(c, ViewNode::If { .. })))
    }));
}

#[test]
fn html_attr_emits_bind_html() {
    let src = r#"
export default class HtmlDemo {
  markup = "<b>x</b>";
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(r#"<div html={markup}></div>"#);
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    assert!(js.contains("api.bindHtml(this,"), "{js}");
    assert!(!js.contains("api.bindAttr(this,"), "{js}");
}
