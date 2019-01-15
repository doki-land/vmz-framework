//! Moved from `src/pipeline/emit_direct.rs` (cargo-cry: tests next to Cargo.toml).

use vmz_compiler::analyze::analyze_script;
use vmz_compiler::emit::emit_client_js;
use vmz_compiler::pipeline::emit_direct::*;
use vmz_compiler::reactive_build::build_program_module;
use vmz_compiler::sfc::ScriptKind;
use vmz_compiler::template::parse_template;
use vmz_types::{ViewNode, ViewStatus};

#[test]
fn leaf_button_emits_vmz_create() {
    let src = r#"
export default class CounterButton {
  public initial: number = 0;
  count = this.initial;
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(
        r#"<button type="button" @click="() => count++">count: {{ count }}</button>"#,
    )
    .unwrap();
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    let view = &program.units[0].view;
    assert_eq!(view.status, ViewStatus::Native);
    assert!(is_direct_eligible(view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    assert!(js.contains("__vmzDirect = true"), "{js}");
    assert!(js.contains("__vmzCreate"), "expected __vmzCreate factory: {js}");
    assert!(
        js.contains("api.specFieldText(this,") || js.contains("api.bindText(this,"),
        "{js}"
    );
    assert!(
        js.contains("api.specFieldText(this, 1,") || js.contains("api.bindText(this, 1,"),
        "{js}"
    );
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
    let tpl =
        parse_template(r#"<div><p v-if="showA">{{ aText }}</p><p v-else>{{ bText }}</p></div>"#)
            .unwrap();
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
    let tpl =
        parse_template(r#"<ul><li v-for="tag in tags" :key="tag.id">{{ tag.label }}</li></ul>"#)
            .unwrap();
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    assert!(js.contains("api.eachBlock(this,"), "{js}");
    assert!(js.contains("createItem:"), "{js}");
}

#[test]
fn each_row_kernel_emits_serialize_item_with_null_create_item() {
    let src = r#"
export default class DealsPage {
  deals: { id: string; title: string; note: string }[] = [];
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(
        r#"<div><article class="deal" v-for="d in deals" :key="d.id"><h3>{{ d.title }}</h3><p>{{ d.note }}</p></article></div>"#,
    ).unwrap();
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    assert!(js.contains("rowKernel:"), "expected rowKernel for static deals row: {js}");
    assert!(js.contains("createItem: null"), "client createItem must be null: {js}");
    assert!(js.contains("serializeItem:"), "SSR must get IR-homologous serializeItem: {js}");
    assert!(js.contains("api.bindText(this,"), "serializeItem body uses bindText: {js}");
}

#[test]
fn component_tag_is_eligible() {
    let src = r#"
export default class Host {
  x = 1;
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(r#"<div><Child :count="x" /></div>"#).unwrap();
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
    let tpl = parse_template(r#"<button>{{ liked ? '♥' : '♡' }}</button>"#).unwrap();
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
    let tpl = parse_template(r#"<div><slot /></div>"#).unwrap();
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
    let tpl =
        parse_template(r#"<div><p v-if="showA">{{ aText }}</p><p v-else>{{ bText }}</p></div>"#)
            .unwrap();
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
    let tpl = parse_template(r#"<div v-html="markup"></div>"#).unwrap();
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    assert!(js.contains("api.bindHtml(this,"), "{js}");
    assert!(!js.contains("api.bindAttr(this,"), "{js}");
}

#[test]
fn at_click_method_emits_api_on() {
    let src = r#"
export default class CatalogList {
  selected = null;
  selectFirst() { this.selected = "Alpha"; }
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl =
        parse_template(r#"<button type="button" @click="selectFirst">select</button>"#).unwrap();
    let roots = &tpl.roots;
    assert_eq!(roots.len(), 1, "button must parse as one element, not text/@click split");
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    assert!(
        js.contains("api.on(") || js.contains("api.onMethod("),
        "{js}"
    );
    assert!(js.contains("\"click\""), "{js}");
    assert!(
        js.contains("this.selectFirst")
            || js.contains("selectFirst(ev)")
            || js.contains("api.onMethod(") && js.contains("\"selectFirst\""),
        "{js}"
    );
    assert!(!js.contains("api.text(\"@click=\")"), "{js}");
}
