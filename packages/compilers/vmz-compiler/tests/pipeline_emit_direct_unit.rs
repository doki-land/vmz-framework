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
    assert!(js.contains("api.specFieldText(this,") || js.contains("api.trackPatch(this,"), "{js}");
    assert!(
        js.contains("api.specFieldText(this, 1,") || js.contains("api.trackPatch(this,"),
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
    assert!(js.contains(r#"api.comment("vmz-if")"#), "{js}");
    assert!(js.contains("api.trackPatch(inst,"), "{js}");
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
    assert!(js.contains("api.trackPatch(inst,"), "{js}");
    assert!(js.contains("createItem:"), "{js}");
    assert!(!js.contains("api.eachBlock(this,"), "{js}");
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
    assert!(
        js.contains("api.trackPatch(this,") || js.contains("api.specFieldText(this,"),
        "serializeItem body uses specialized patch: {js}"
    );
}

#[test]
fn v_once_region_emits_create_time_writes_without_any_subscription() {
    let src = r#"
export default class OnceDemo {
  title = "t";
  label = "hi";
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl =
        parse_template(r#"<div v-once :title="title">{{ label }}<span v-text="label"></span></div>"#)
            .unwrap();
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    // Create-once: attributes / text are written once, no patch or dep subscription.
    assert!(!js.contains("api.trackPatch("), "v-once region must not subscribe: {js}");
    assert!(!js.contains("api.specField"), "v-once region must not specialize fields: {js}");
    assert!(js.contains("api.attr("), "expected create-time attr write: {js}");
    assert!(js.contains(".textContent = String("), "expected create-time text write: {js}");
    assert!(!js.contains(r#""v-once""#), "marker must not leak as a DOM attribute: {js}");
}

#[test]
fn v_once_does_not_freeze_parent_or_siblings() {
    let src = r#"
export default class OnceSiblings {
  live = "a";
  frozen = "b";
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(r#"<div><p>{{ live }}</p><span v-once>{{ frozen }}</span></div>"#).unwrap();
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    // Only the sibling keeps a reactive patch; the once subtree writes once.
    assert_eq!(
        js.matches("api.specFieldText(this,").count()
            + js.matches("api.trackPatch(this,").count(),
        1,
        "exactly one sibling patch expected: {js}"
    );
}

#[test]
fn v_once_if_freeze_keeps_structure_but_drops_condition_patch() {
    let src = r#"
export default class OnceBranch {
  show = true;
  label = "a";
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(r#"<div><p v-if="show" v-once>{{ label }}</p></div>"#).unwrap();
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    assert!(js.contains(r#"api.comment("vmz-if")"#), "if structure must stay: {js}");
    assert!(js.contains("apply();"), "branch create still runs once: {js}");
    assert!(!js.contains("], apply, "), "v-once if must not subscribe cond: {js}");
}

#[test]
fn v_once_each_freezes_rows_and_drops_row_kernel() {
    let src = r#"
export default class OnceList {
  tags: { id: string; label: string }[] = [];
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl =
        parse_template(r#"<ul><li v-for="tag in tags" :key="tag.id" v-once>{{ tag.label }}</li></ul>"#)
            .unwrap();
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    assert!(!js.contains("rowKernel:"), "row kernel must be disabled for frozen rows: {js}");
    assert!(js.contains("createItem: function("), "fat item create expected: {js}");
    assert!(!js.contains("], apply, "), "v-once each must not subscribe the list: {js}");
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
    assert!(js.contains("api.trackPatch(this,"), "{js}");
    assert!(js.contains("stable:"), "{js}");
    assert!(js.contains("branches:"), "{js}");
    assert!(!js.contains("api.bindText(this,"), "{js}");
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
fn class_static_and_bind_emit_merge_class() {
    let src = r#"
export default class ClassMergeDemo {
  gameRootClass = "game theme-factory-idle";
  rowClass = "ready";
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(
        r#"<div class="game theme-factory-idle" :class="gameRootClass"><button class="bp-build" :class="{ ready: true }"></button></div>"#,
    )
    .unwrap();
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    assert!(js.contains("api.mergeClass("), "expected merged class emit, got: {js}");
    assert!(!js.contains("[object Object]"), "emit must not stringify object bindings: {js}");
    assert!(
        js.contains("game theme-factory-idle"),
        "static class tokens must survive merge emit: {js}"
    );
}

#[test]
fn style_static_and_object_bind_emit_merge_style() {
    let src = r#"
export default class StyleMergeDemo {
  lockFillStyle = "width: 40%";
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(r#"<div style="color: red" :style="lockFillStyle"></div>"#).unwrap();
    let _program = build_program_module("t.vmz", &client.decl, &tpl);
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    assert!(js.contains("api.mergeStyle("), "{js}");
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
    assert!(js.contains("api.trackPatch(this,"), "{js}");
    assert!(!js.contains("api.bindHtml(this,"), "{js}");
    assert!(!js.contains("api.bindAttr(this,"), "{js}");
    assert!(!js.contains("api.bindText(this,"), "{js}");
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
    assert!(js.contains("api.on(") || js.contains("api.onMethod("), "{js}");
    assert!(js.contains("\"click\""), "{js}");
    assert!(
        js.contains("this.selectFirst")
            || js.contains("selectFirst(ev)")
            || js.contains("api.onMethod(") && js.contains("\"selectFirst\""),
        "{js}"
    );
    assert!(!js.contains("api.text(\"@click=\")"), "{js}");
}

#[test]
fn v_show_reactive_emits_display_toggle_patch() {
    let src = r#"
export default class ShowDemo {
  ok = true;
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(r#"<div v-show="ok">hi</div>"#).unwrap();
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    assert!(js.contains("api.trackPatch(this,"), "reactive v-show must trackPatch: {js}");
    assert!(
        js.contains("style.display") || js.contains("el.style.display"),
        "v-show patch must toggle style.display: {js}"
    );
    assert!(
        !js.contains("api.attr(") || !js.contains("\"show\""),
        "v-show must not emit api.attr(el, \"show\", ...): {js}"
    );
}

#[test]
fn v_text_reactive_emits_textcontent_patch() {
    let src = r#"
export default class TextDemo {
  msg = "hello";
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(r#"<div v-text="msg"></div>"#).unwrap();
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    assert!(js.contains("api.trackPatch(this,"), "reactive v-text must trackPatch: {js}");
    assert!(
        js.contains("textContent") || js.contains(".textContent"),
        "v-text patch must write textContent: {js}"
    );
    assert!(
        !js.contains("api.attr(") || !js.contains("\"text\""),
        "v-text must not emit api.attr(el, \"text\", ...): {js}"
    );
}

#[test]
fn v_text_static_emits_setText() {
    let src = r#"export default class T {}"#;
    let client = analyze_script(ScriptKind::Client, src);
    // Static v-text authoring is unusual (Vue author would just write the text), but
    // Template lowering still accepts `text="literal"` as Static attr.
    let tpl = parse_template(r#"<div text="literal">ignored</div>"#).unwrap();
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    assert!(js.contains("api.setText("), "static v-text must emit api.setText(el, ...): {js}");
}

#[test]
fn v_on_with_stop_prevents_propagation() {
    let src = r#"
export default class StopDemo {
  count = 0;
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(r#"<div @click.stop="() => count++">stop</div>"#).unwrap();
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    // modifier: .stop → handler wrapper must call ev.stopPropagation()
    assert!(
        js.contains("ev.stopPropagation()"),
        ".stop modifier must inline ev.stopPropagation() into handler: {js}"
    );
    assert!(js.contains("api.on("), "expect api.on call for event with modifiers: {js}");
    // .stop-only → no addEventListener options (opts_str should be undefined)
    assert!(!js.contains("capture: true"), "unexpected capture option: {js}");
}

#[test]
fn v_model_with_lazy_uses_change_event() {
    let src = r#"
export default class LazyDemo {
  name = "";
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(r#"<input v-model.lazy="name" />"#).unwrap();
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    // .lazy → api.on must listen to "change" event (not "input")
    assert!(js.contains(r#", "change","#), "v-model.lazy must api.on(event=\"change\"): {js}");
    // ensure NO api.on with "input" event (v-model default)
    assert!(!js.contains(r#", "input", $"#), "v-model.lazy must NOT api.on(event=\"input\"): {js}");
}

#[test]
fn v_model_without_lazy_defaults_to_input_event() {
    let src = r#"
export default class PlainDemo {
  value = "";
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(r#"<input v-model="value" />"#).unwrap();
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    // plain v-model → api.on must listen to "input" event
    assert!(js.contains(r#", "input","#), "plain v-model must api.on(event=\"input\"): {js}");
    // :value prop bind + @input event
    assert!(js.contains("api.on("), "expect api.on for v-model update event: {js}");
}

#[test]
fn v_model_trim_and_number_rewrite_handler() {
    let src = r#"
export default class TrimNumberDemo {
  text = "";
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(r#"<input v-model.trim="text" />"#).unwrap();
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    // .trim → handler body must reference .trim()
    assert!(js.contains(".trim()"), "v-model.trim must rewrite handler to call .trim(): {js}");
}

#[test]
fn getter_binding_emits_instance_property_not_free_identifier() {
    let src = r#"
export default class MarkupPanel {
  spec = null;
  get markup() {
    return `<b>${this.spec}</b>`;
  }
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(r#"<div v-html="markup"></div>"#).unwrap();
    let program = build_program_module("MarkupPanel.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    assert!(js.contains("this.markup"), "getter binding must read the instance: {js}");
    assert!(!js.contains("= markup"), "bare member identifier emitted: {js}");
}
