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
fn bare_static_attrs_emit_empty_attribute_writes() {
    let src = r#"
export default class BareAttrs {
  count = 0;
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(r#"<div><button disabled>off</button><option value>—</option></div>"#)
        .unwrap();
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    // A value-less template attribute is still an empty-valued DOM attribute.
    assert!(js.contains(r#""disabled", true);"#), "bare `disabled` dropped: {js}");
    assert!(js.contains(r#""value", true);"#), "bare `value` dropped: {js}");
}

#[test]
fn component_host_attrs_do_not_become_props() {
    let src = r#"
export default class HostAttrsPage {
  cardId = "card";
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(
        r#"<ChildCard id="card" data-testid="card" aria-label="card" :data-live="cardId" />"#,
    )
    .unwrap();
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    assert!(
        js.contains(
            r#""__hostAttrs":{"id":"card","data-testid":"card","aria-label":"card","data-live":"#
        ),
        "fallthrough attrs missing from `__hostAttrs`: {js}"
    );
    assert!(!js.contains("dataTestid"), "`data-testid` camelized into a prop: {js}");
    assert!(js.contains(r#""data-live""#), "interpolated host attr dropped: {js}");
}

#[test]
fn key_modifiers_and_exact_emit_guards() {
    let src = r#"
export default class KeyDemo {
  enterHits = 0;
  exactHits = 0;
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(
        r#"<input @keyup.enter="(() => enterHits++)" @keyup.delete="(() => enterHits++)" @keyup.ctrl.exact="(() => exactHits++)" />"#,
    )
    .unwrap();
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    assert!(js.contains(r#"["enter"].indexOf(__vmzKey) < 0"#), "`.enter` unfiltered: {js}");
    assert!(
        js.contains(r#"["delete","backspace"].indexOf(__vmzKey) < 0"#),
        "`.delete` should accept backspace: {js}"
    );
    assert!(js.contains("if (!ev.ctrlKey) return;"), "`.ctrl` not required: {js}");
    assert!(js.contains("if (ev.altKey) return;"), "`.exact` allows alt: {js}");
    assert!(js.contains("if (ev.shiftKey) return;"), "`.exact` allows shift: {js}");
    assert!(js.contains("if (ev.metaKey) return;"), "`.exact` allows meta: {js}");
}

#[test]
fn v_model_number_keeps_empty_and_non_numeric_strings() {
    let src = r#"
export default class NumberModel {
  count = 0;
  label = "";
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl =
        parse_template(r#"<input v-model.number="count" /><input v-model.trim.number="label" />"#)
            .unwrap();
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    assert!(
        js.contains(r#"__vmzV === "" || Number.isNaN(__vmzN)"#),
        "`.number` must keep empty / non-numeric strings: {js}"
    );
    assert!(!js.contains("Number($event.target.value)"), "empty stays `0`: {js}");
    assert!(
        js.contains("$event.target.value.trim()"),
        "`.trim.number` must trim before casting: {js}"
    );
}

#[test]
fn dynamic_event_name_rekeys_listener() {
    let src = r#"
export default class DynamicEvent {
  evt = "click";
  hits = 0;
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(r#"<button @[evt]="(() => hits++)">go</button>"#).unwrap();
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    assert!(js.contains("api.bindObjectListeners("), "no dynamic listener: {js}");
    assert!(js.contains(r#"[String(__vmzEvtName"#), "name not resolved at patch: {js}");
    assert!(js.contains("api.trackPatch(this, ["), "name changes are not tracked: {js}");
    assert!(!js.contains(r#""[evt]""#), "literal `[evt]` used as event type: {js}");
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
fn each_on_component_evaluates_item_scope_inside_item_closure() {
    // `v-for` on a component must iterate like on an element: the item alias
    // (`panel`) is only bound inside the item closure, so the component create
    // may never evaluate `panel` / `panel.id` eagerly in the outer scope.
    let src = r#"
export default class PanelGrid {
  panels: { id: string; title: string }[] = [];
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(
        r#"<div><PanelCard v-for="panel in panels" :key="panel.id" :panel="panel" /></div>"#,
    )
    .unwrap();
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    // Iteration happens through the each schedule, never through leaked props.
    assert!(js.contains("createItem:"), "component v-for must lower to an each schedule: {js}");
    assert!(!js.contains("\"each\":"), "`each` must never leak into component props: {js}");
    assert!(!js.contains("\"as\":"), "`as` must never leak into component props: {js}");
    // The item closure is the only place the alias is in scope.
    let item_fn = js.find("function(api, box").map(|at| &js[at..]).unwrap_or("");
    assert!(!item_fn.is_empty(), "each item closure must exist: {js}");
    assert!(
        item_fn.contains("api.component(this,"),
        "component must be created inside the item closure: {js}"
    );
    assert!(
        item_fn.contains("\"panel\":box1.item"),
        "prop must evaluate the item alias inside the closure: {js}"
    );
    assert!(
        js.contains("key: function(box1) { return (box1.item.id); }"),
        "key must evaluate the item alias per row inside the schedule: {js}"
    );
    // Outer scope never touches the alias eagerly.
    let outer = &js[..js.find("function(api, box").unwrap_or(0)];
    assert!(!outer.contains("panel.id"), "eager `panel.id` outside the item closure: {js}");
    assert!(!outer.contains(":panel"), "eager `panel` prop outside the item closure: {js}");
}

#[test]
fn each_on_component_binds_props_for_host_fields_and_item_scope() {
    // `v-for` on a component must keep two kinds of props live: host-field props
    // (`theme` switches must reach every row) and item-scoped props (a replaced
    // row object must reach its child).
    let src = r#"
export default class PanelGrid {
  panels: { id: string; title: string }[] = [];
  theme = "light";
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(
        r#"<div><PanelCard v-for="panel in panels" :key="panel.id" :panel="panel" :theme="theme" /></div>"#,
    )
    .unwrap();
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    let item_fn = js.find("function(api, box").map(|at| &js[at..]).unwrap_or("");
    assert!(!item_fn.is_empty(), "each item closure must exist: {js}");
    // Host-field prop: subscribes `theme` and reads it inside the row closure.
    let theme_bind = item_fn
        .split("api.bindComponentProp(this,")
        .skip(1)
        .find(|s| s.contains(r#""theme""#))
        .unwrap_or_else(|| panic!("row component must bind `theme`: {js}"));
    let theme_deps = theme_bind.split('[').nth(1).unwrap_or("").split(']').next().unwrap_or("");
    assert!(theme_deps.contains(r#""theme""#), "theme must be a dep: {js}");
    // Item-scoped prop: no host dep, still bound so list applies replay it.
    let panel_bind = item_fn
        .split("api.bindComponentProp(this,")
        .skip(1)
        .find(|s| s.contains(r#""panel""#))
        .unwrap_or_else(|| panic!("row component must bind `panel`: {js}"));
    assert!(panel_bind.contains("box1.item"), "panel getter reads the row item: {js}");
}

#[test]
fn v_model_on_native_elements_emits_dom_value_bindings() {
    let src = r#"
export default class NoteForm {
  msg = "hello";
  agree = false;
  kind = "a";
  tags = "one";
}
"#;
    let cases: [(&str, &[&str]); 5] = [
        (
            r#"<div><textarea v-model="msg"></textarea></div>"#,
            &[
                r#"api.specFieldAttr(this, 0, "msg", e1, "value")"#,
                r#"api.on(e1, "input", $event => ((this.msg) = $event.target.value))"#,
            ],
        ),
        (
            r#"<div><input v-model.trim="msg" /></div>"#,
            &[r#"((this.msg) = $event.target.value.trim())"#],
        ),
        (
            r#"<div><input type="checkbox" v-model="agree" /></div>"#,
            &[
                r#"api.attr(e1, "checked", __v)"#,
                r#"Array.isArray(__vmzM) ? __vmzM.indexOf("on") > -1"#,
                r#"if (!Array.isArray(__vmzM)) return __vmzOn"#,
            ],
        ),
        (
            r#"<div><input type="radio" value="a" v-model="kind" /></div>"#,
            &[r#""checked""#, r#"(this.kind) === ("a")"#, r#"((this.kind) = ("a"))"#],
        ),
        (
            r#"<div><select v-model="tags"><option>one</option></select></div>"#,
            &[r#""change""#, r#"((this.tags) = $event.target.value)"#],
        ),
    ];
    for (tpl_src, needles) in cases {
        let client = analyze_script(ScriptKind::Client, src);
        let tpl = parse_template(tpl_src).unwrap();
        let program = build_program_module("t.vmz", &client.decl, &tpl);
        assert!(is_direct_eligible(&program.units[0].view), "{tpl_src}");
        let js = emit_client_js(src, &client, &tpl, None).unwrap();
        for needle in needles {
            assert!(js.contains(needle), "{tpl_src} must emit {needle}\n{js}");
        }
        assert!(!js.contains("modelValue"), "{tpl_src} must not use the prop contract\n{js}");
    }
}

#[test]
fn v_model_on_component_emits_prop_and_update_event() {
    let src = r#"
export default class NoteForm {
  msg = "hello";
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(r#"<div><Widget v-model="msg" /></div>"#).unwrap();
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    assert!(js.contains(r#"{"modelValue":this.msg}"#), "{js}");
    assert!(js.contains(r#"onComponentEvent(c1, "update:modelValue""#), "{js}");
    assert!(!js.contains(r#""value", e1"#), "{js}");
}

/// Vue resolves `v-bind:[expr]` at patch time. Keeping `[expr]` as the literal
/// attribute name writes a bogus attribute (`[keyName]`) and never touches the
/// intended one, so the earlier name must also be retired when it changes.
#[test]
fn dynamic_attribute_argument_resolves_name_at_patch_time() {
    let src = r#"
export default class DynamicAttr {
  keyName = "title";
  val = "hello";
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(r#"<div :[keyName]="val">x</div>"#).unwrap();
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    assert!(!js.contains(r#""[keyName]""#), "literal dynamic arg reached emit: {js}");
    assert!(
        js.contains("api.attr(e0, __n, __v)") && js.contains("api.attr(e0, __prevName, null)"),
        "resolved name must be written and the previous one retired: {js}"
    );
    assert!(js.contains(r#"["val", "keyName"]"#), "name and value deps must both subscribe: {js}");
}

#[test]
fn dynamic_attribute_argument_under_v_once_writes_once_with_resolved_name() {
    let src = r#"
export default class DynamicAttrOnce {
  keyName = "title";
  val = "hello";
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(r#"<div v-once :[keyName]="val">x</div>"#).unwrap();
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    assert!(!js.contains("api.trackPatch("), "v-once must not subscribe: {js}");
    assert!(
        js.contains("if (__n != null) api.attr(e0, String(__n), __v)"),
        "v-once dynamic arg must resolve before writing: {js}"
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
    let tpl = parse_template(
        r#"<div v-once :title="title">{{ label }}<span v-text="label"></span></div>"#,
    )
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
    let tpl =
        parse_template(r#"<div><p>{{ live }}</p><span v-once>{{ frozen }}</span></div>"#).unwrap();
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    // Only the sibling keeps a reactive patch; the once subtree writes once.
    assert_eq!(
        js.matches("api.specFieldText(this,").count() + js.matches("api.trackPatch(this,").count(),
        1,
        "exactly one sibling patch expected: {js}"
    );
}

#[test]
fn v_memo_gates_subtree_patches_with_snapshot_and_root_dep() {
    let src = r#"
export default class MemoDemo {
  dep = 0;
  label = "a";
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(r#"<div v-memo="[dep]">{{ label }}</div>"#).unwrap();
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    // 快照变量 + 浅比较函数（每个补丁一份快照）。
    assert!(js.contains("Object.is("), "expected shallow memo comparison: {js}");
    assert!(js.contains("function memoSame"), "expected inline memo comparison: {js}");
    assert!(js.contains("var memoSnap"), "expected a per-patch snapshot: {js}");
    assert!(js.contains("memoSet"), "expected a snapshot-init flag: {js}");
    // 子节点补丁依赖里含 memo 根依赖 `dep`，自身依赖 `label` 仍在。
    let patch = js
        .split("api.trackPatch(this, [")
        .skip(1)
        .find(|s| s.contains("label"))
        .unwrap_or_else(|| panic!("expected gated interpolation patch: {js}"));
    let deps = patch.split(']').next().unwrap_or("");
    assert!(deps.contains("\"label\""), "own dep must stay: {js}");
    assert!(deps.contains("\"dep\""), "memo root dep must be appended: {js}");
    // 门控在补丁体内，先比较再应用。
    assert!(patch.contains("memoSame"), "{js}");
    assert!(!js.contains(r#""v-memo""#), "marker must not leak as a DOM attribute: {js}");
}

#[test]
fn v_memo_gates_show_and_html_patches_with_own_snapshots() {
    let src = r#"
export default class MemoShow {
  dep = 0;
  on = true;
  html = "<b>x</b>";
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(
        r#"<div v-memo="[dep]"><span v-show="on">x</span><p v-html="html"></p></div>"#,
    )
    .unwrap();
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    assert!(js.contains(".style.display ="), "v-show keeps its patch: {js}");
    assert!(js.contains("api.html("), "v-html keeps its patch: {js}");
    // v-show 与 v-html 两个补丁都被门控，且各自持有独立快照。
    assert_eq!(js.matches("var memoSnap").count(), 2, "one snapshot per patch: {js}");
    assert_eq!(js.matches("__memoNext)) return;").count(), 2, "both patches gated: {js}");
}

#[test]
fn v_once_inside_v_memo_still_registers_no_patch() {
    let src = r#"
export default class MemoOnce {
  dep = 0;
  frozen = "a";
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl =
        parse_template(r#"<div v-memo="[dep]"><span v-once>{{ frozen }}</span></div>"#).unwrap();
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    // v-once 优先：冻结子树不产生任何补丁，因此外层 memo 没有可门控的补丁。
    assert!(!js.contains("api.trackPatch("), "v-once subtree must stay patch-free: {js}");
    assert!(js.contains(".textContent = String("), "expected create-time text write: {js}");
}

#[test]
fn nested_v_memo_uses_nearest_dependency_array() {
    let src = r#"
export default class NestedMemo {
  outer = 0;
  inner = 0;
  label = "a";
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(
        r#"<div v-memo="[outer]"><section v-memo="[inner]">{{ label }}</section></div>"#,
    )
    .unwrap();
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view), "nested memo must stay Direct-eligible");
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    let patch = js
        .split("api.trackPatch(this, [")
        .skip(1)
        .find(|s| s.contains("label"))
        .unwrap_or_else(|| panic!("expected gated interpolation patch: {js}"));
    let deps = patch.split(']').next().unwrap_or("");
    assert!(deps.contains("\"inner\""), "nearest memo dep expected: {js}");
    assert!(!deps.contains("\"outer\""), "outer memo must not gate inner patches: {js}");
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
fn if_branch_switch_disposes_before_detach() {
    // Vue `v-if` unmounts the outgoing branch: its child instances and
    // subscriptions must be disposed, not parked in the cache for a later replay.
    let src = r#"
export default class BranchDispose {
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
    assert!(
        js.contains("api.disposeTree(cached[active]);"),
        "branch switch must dispose the outgoing subtree: {js}"
    );
    assert!(js.contains("cached[active] = null;"), "disposed branch must not be reused: {js}");
    assert!(
        js.contains("branchBinds[active] = [];"),
        "disposed branch bindings must be dropped: {js}"
    );
    let dispose_at = js.find("api.disposeTree(cached[active]);").unwrap();
    let remove_at = js.find("api.removeNode(cached[active]);").unwrap();
    assert!(dispose_at < remove_at, "dispose must run before detach: {js}");
}

#[test]
fn v_once_each_freezes_rows_and_drops_row_kernel() {
    let src = r#"
export default class OnceList {
  tags: { id: string; label: string }[] = [];
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(
        r#"<ul><li v-for="tag in tags" :key="tag.id" v-once>{{ tag.label }}</li></ul>"#,
    )
    .unwrap();
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    assert!(!js.contains("rowKernel:"), "row kernel must be disabled for frozen rows: {js}");
    assert!(js.contains("createItem: function("), "fat item create expected: {js}");
    assert!(!js.contains("], apply, "), "v-once each must not subscribe the list: {js}");
}

/// Non-kernel rows have no clone template, so the row key must reach the root
/// node: SSR writes `data-vmz-key` and resume reclaims the row by identity
/// instead of by the order its tag happens to appear in.
#[test]
fn v_once_rows_pass_the_key_to_the_root_element() {
    let src = r#"
export default class OnceKeys {
  tags: { id: string; label: string }[] = [];
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(
        r#"<ul><li v-for="tag in tags" :key="tag.id" v-once>{{ tag.label }}</li></ul>"#,
    )
    .unwrap();
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    assert!(
        js.contains("var box = { item: item, index: i, __vmzKey: key };"),
        "row box must carry the key: {js}"
    );
    assert!(js.contains(r#"api.el("li", box1.__vmzKey);"#), "row root must receive the key: {js}");
    assert!(!js.contains("], apply, "), "v-once must keep the no-resubscribe semantics: {js}");
}

#[test]
fn component_rows_pass_the_key_to_the_host() {
    let src = r#"
export default class ComponentKeys {
  items: { id: string; label: string }[] = [];
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl =
        parse_template(r#"<ul><Child v-for="i in items" :key="i.id" :label="i.label" /></ul>"#)
            .unwrap();
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    assert!(
        js.contains("var box = { item: item, index: i, __vmzKey: key };"),
        "row box must carry the key: {js}"
    );
    assert!(js.contains(", box1.__vmzKey);"), "component host must receive the row key: {js}");
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

/// `<component :is>` used to fall through to `api.el("component")` and mint an
/// unknown DOM element. It must become a dynamic boundary: the `is` expression
/// resolves at runtime and `is` never leaks into props.
#[test]
fn component_is_emits_dynamic_boundary() {
    let src = r#"
export default class DynHost {
  kind = "ChildA";
  label = "hi";
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl =
        parse_template(r#"<section><component :is="kind" :label="label" /></section>"#).unwrap();
    let program = build_program_module("DynHost.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    assert!(
        program.units[0].view.roots.iter().any(|n| {
            matches!(n, ViewNode::Element { children, .. }
                if children.iter().any(|c| matches!(c, ViewNode::Component { tag, .. } if tag == "component")))
        }),
        "`<component :is>` must build a component node"
    );
    assert!(js.contains("api.dynamicComponent(this,"), "dynamic boundary expected: {js}");
    assert!(
        js.contains("function() { return this.kind; }"),
        "the `:is` getter must re-evaluate at switch time: {js}"
    );
    assert!(
        js.contains(r#"function() { return {"label":this.label}; }"#),
        "props must be re-evaluated per mount: {js}"
    );
    assert!(
        !js.contains(r#"api.el("component")"#),
        "`<component>` must never become an unknown DOM element: {js}"
    );
    assert!(!js.contains(r#""is":"#), "the `is` selector must not leak into props: {js}");
    assert!(
        js.contains("api.bindComponentProp")
            || js.contains("api.onComponentEvent")
            || !js.contains(":label"),
        "user props stay ordinary bindings: {js}"
    );
}

/// A static `is="ChildA"` value resolves through the component registry.
#[test]
fn component_static_is_uses_registry_lookup() {
    let src = r#"
export default class DynHost {
  label = "hi";
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl =
        parse_template(r#"<section><component is="ChildA" :label="label" /></section>"#).unwrap();
    let program = build_program_module("DynHost.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    assert!(
        js.contains(r#"function() { return "ChildA"; }"#),
        "static `is` must resolve by name: {js}"
    );
    assert!(
        js.contains("api.dynamicComponent(this, null, [],"),
        "a static `is` has no reactive deps: {js}"
    );
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
    // Re-assigning the same string re-parses the SSR subtree that hydrate adopted.
    assert!(
        js.contains("api.html(e0, __s)"),
        "v-html must go through the digest-aware write: {js}"
    );
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

#[test]
fn constant_bindings_fold_to_static_writes() {
    let src = r#"
export default class ConstAttrDemo {
  seed = "seed";
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(
        r#"<div :title="'a' + 'b'" :data-n="1 + 2" :hidden="!false">{{ 'x' + 'y' }}</div>"#,
    )
    .unwrap();
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    assert!(js.contains(r#", "title", "ab");"#), "constant attr must be static: {js}");
    assert!(js.contains(r#", "data-n", "3");"#), "constant number must be static: {js}");
    assert!(js.contains(r#", "hidden", "true");"#), "constant boolean must be static: {js}");
    assert!(js.contains(r#"api.text("xy")"#), "constant interpolation must be static text: {js}");
    assert!(!js.contains("api.trackPatch"), "constant bindings must not patch: {js}");
}

#[test]
fn constant_v_if_drops_dead_branches() {
    let src = r#"
export default class ConstBranchDemo {
  seed = "seed";
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(
        r#"<div><p v-if="false">dead-a</p><p v-else-if="true">live-b</p><p v-else>dead-c</p></div>"#,
    )
    .unwrap();
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    assert!(!js.contains("dead-a"), "constant-false branch dropped: {js}");
    assert!(!js.contains("dead-c"), "branch after constant-true dropped: {js}");
    assert!(js.contains(r#"api.text("live-b")"#), "surviving branch stays static: {js}");
    assert!(!js.contains("vmz-if"), "no runtime if region: {js}");
    assert!(!js.contains("api.trackPatch"), "no runtime condition subscription: {js}");
}

#[test]
fn non_constant_method_call_keeps_runtime_binding() {
    let src = r#"
export default class RuntimeAttrDemo {
  title = "t";
  titleOf() {
    return this.title;
  }
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(r#"<div :title="this.titleOf()"></div>"#).unwrap();
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    assert!(js.contains("api.trackPatch"), "method call must stay runtime: {js}");
}

#[test]
fn static_named_slot_projects_named_and_is_transparent() {
    let src = r#"
export default class SlotHost {
  title = "hello";
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(
        r#"<section><Card class="c"><template #header><h2>{{ title }}</h2></template><p>body</p></Card></section>"#,
    )
    .unwrap();
    let program = build_program_module("SlotHost.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    assert!(js.contains("api.projectNamedSlot("), "expected named projection: {js}");
    assert!(js.contains(r#", "header", "#), "static slot name must be a literal: {js}");
    assert!(js.contains("api.projectDefaultSlot("), "default child stays default: {js}");
    assert!(
        !js.contains(r#"api.el("template")"#),
        "`<template #header>` must stay transparent: {js}"
    );
    assert!(!js.contains("#header"), "slot marker must not reach props: {js}");
}

#[test]
fn dynamic_named_slot_projects_bound_expression() {
    let src = r#"
export default class DynamicSlotHost {
  currentTab = "header";
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl =
        parse_template(r#"<div><Card><template #[currentTab]><h2>H</h2></template></Card></div>"#)
            .unwrap();
    let program = build_program_module("DynamicSlotHost.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    assert!(js.contains("api.projectNamedSlot("), "expected named projection: {js}");
    assert!(js.contains("this.currentTab"), "dynamic name must bind `this`: {js}");
    assert!(!js.contains("#[currentTab]"), "dynamic marker must not leak: {js}");
    assert!(!js.contains(r#"api.el("template")"#), "`<template #[x]>` must stay transparent: {js}");
}

#[test]
fn component_level_slot_marker_moves_all_children_into_named_slot() {
    let src = r#"
export default class MarkerSlotHost {
  seed = "x";
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(r#"<div><Card #header><h2>H</h2><p>P</p></Card></div>"#).unwrap();
    let program = build_program_module("MarkerSlotHost.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    assert!(
        js.matches("api.projectNamedSlot(").count() == 2,
        "both children belong to the named slot: {js}"
    );
    assert!(!js.contains("api.projectDefaultSlot("), "no default projection: {js}");
    assert!(!js.contains("#header"), "component slot marker must not reach props: {js}");
}

#[test]
fn root_field_updates_and_template_handler_emit_no_empty_write_path() {
    let src = r#"
export default class CounterDemo {
  count = 0;
  user = { count: 0 };
  bumpPost() {
    this.count++;
  }
  bumpPre() {
    ++this.count;
  }
  drop() {
    this.count--;
  }
  bumpNested() {
    this.user.count++;
  }
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(
        r#"<section><strong>{{ count }}</strong><button type="button" @click="count++">+</button></section>"#,
    )
    .unwrap();
    let program = build_program_module("CounterDemo.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    assert!(
        !js.contains(", [], ") && !js.contains(", [])"),
        "empty write path must never be emitted: {js}"
    );
    assert!(js.contains("this.count++"), "method root update stays plain: {js}");
    assert!(js.contains("++this.count"), "prefix root update stays plain: {js}");
    assert!(js.contains("this.count--"), "root decrement stays plain: {js}");
    assert!(
        js.contains("__vmzWritePathCompound(this, \"user\", [\"count\"], \"+\", 1)"),
        "nested update still lowers to the write path: {js}"
    );
    assert!(
        js.contains("(this.count++)"),
        "template inline handler stays a plain root update: {js}"
    );
}

const SPREAD_SRC: &str = r#"
export default class SpreadDemo {
  props: Record<string, unknown> = {};
  listeners: Record<string, unknown> = {};
  panelProps: Record<string, unknown> = {};
  panelEvents: Record<string, unknown> = {};
  fixed = "f";
  extra = "x";
  onClick() {}
}
"#;

fn spread_js(template: &str) -> String {
    let client = analyze_script(ScriptKind::Client, SPREAD_SRC);
    let tpl = parse_template(template).unwrap();
    emit_client_js(SPREAD_SRC, &client, &tpl, None).unwrap()
}

/// `v-bind="obj"` on an element spreads real attributes, keeps class/style in the
/// ordered merge sources, defers to a later explicit attribute, and removes keys
/// that leave the object instead of leaving zombies.
#[test]
fn bind_object_spreads_element_attributes_with_removal() {
    let js = spread_js(
        r#"<div><section v-bind="props" :title="fixed" :class="extra" class="base" style="color: red"></section></div>"#,
    );
    // No literal `v-bind` attribute: the object never reaches `api.attr` as a name.
    assert!(!js.contains("\"v-bind\""), "element spread must not emit a `v-bind` attribute: {js}");
    assert!(
        js.contains("var __blocked = Object.create(null); __blocked[\"title\"] = 1;"),
        "a later explicit attribute wins over the spread: {js}"
    );
    assert!(
        js.contains("if (__fallback[__pk]) api.attr(e1, __pk, __fallback[__pk].call(this));")
            && js.contains("else api.attr(e1, __pk, null);"),
        "a key that leaves the object is removed (restored when an earlier explicit source owns it): {js}"
    );
    assert!(
        js.contains("api.trackPatch(this, [\"props\"], __patchBindObj0, 0);"),
        "the spread patches on the object expression deps: {js}"
    );
    assert!(
        js.contains("api.mergeClass(__v0, __v1, \"base\")")
            && js.contains("__o0.class != null ? __o0.class : __o0.className"),
        "object `class` joins the ordered class merge sources: {js}"
    );
    assert!(
        js.contains("api.mergeStyle(__v0, \"color: red\")") && js.contains("(__o0.style)"),
        "object `style` joins the ordered style merge sources: {js}"
    );
    assert!(
        js.contains("api.bindObjectListeners(e1, \"e1:b0\", __src, this, 'bind');"),
        "`onXxx` keys inside `v-bind` route through the call-site listener bag: {js}"
    );

    // An explicit attribute that comes *before* the spread loses to it and is
    // restored when the object drops the key.
    let js = spread_js(r#"<div><section :title="fixed" v-bind="props"></section></div>"#);
    assert!(
        js.contains("__fallback[\"title\"] = function() { return this.fixed; };")
            && !js.contains("__blocked[\"title\"]"),
        "an earlier explicit attribute is the fallback, not a block: {js}"
    );
}

/// `v-on="obj"` attaches and detaches listeners per call site, with no global
/// `off` semantics and no literal `v-on` attribute.
#[test]
fn bind_object_listeners_use_call_site_scope() {
    let js = spread_js(r#"<div><button v-on="listeners" @click="onClick">go</button></div>"#);
    assert!(
        !js.contains("\"v-on\""),
        "element event object must not emit a `v-on` attribute: {js}"
    );
    assert!(
        js.contains("api.bindObjectListeners(e1, \"e1:o0\", __src, this, 'on');"),
        "event keys attach through the per-element bag: {js}"
    );
    assert!(
        js.contains("api.trackPatch(this, [\"listeners\"], function __patchObjEvt"),
        "the listener bag is reapplied on the object expression deps: {js}"
    );
}

/// Component hosts take the spread as props, never as a prop named `vBind` /
/// `vOn`, and keep a per-key binder plus a per-call-site event bag.
#[test]
fn bind_object_spreads_component_props_and_events() {
    let js = spread_js(r#"<div><PanelCard v-bind="panelProps" v-on="panelEvents" /></div>"#);
    assert!(
        js.contains("{...api.spreadProps(this.panelProps)}"),
        "component spread joins create props in source order: {js}"
    );
    assert!(
        js.contains("api.bindComponentProps(this, c1, \"pcobj0\", [\"panelProps\"], function() { return this.panelProps; });"),
        "component spread updates and removals land on the prop binder: {js}"
    );
    assert!(
        js.contains("api.bindComponentEvents(this, c1, \"pcev0\", [\"panelEvents\"], function() { return this.panelEvents; });"),
        "component event object keeps a call-site listener bag: {js}"
    );
    assert!(
        !js.contains("\"vBind\"") && !js.contains("\"vOn\""),
        "object host attrs must not become props named `vBind` / `vOn`: {js}"
    );
}

/// SSR runs the same create function (`__vmzSerialize = __vmzCreate`), so the
/// object spread is applied at create time and no `v-bind="[object Object]"`
/// attribute can reach the markup.
#[test]
fn bind_object_spread_is_ssr_safe() {
    let js = spread_js(r#"<div><section v-bind="props"></section></div>"#);
    assert!(
        js.contains("SpreadDemo.__vmzSerialize = SpreadDemo.__vmzCreate;"),
        "SSR reuses the same create tree: {js}"
    );
    assert!(
        !js.contains("[object Object]") && !js.contains("\"v-bind\""),
        "no object-valued `v-bind` attribute reaches the SSR string path: {js}"
    );
}

/// `<template v-for #default>` must iterate the slot body. The wrapper used to
/// match the named-slot branch and drop its `each`, so the slot received one
/// static copy with the item alias left unbound (`i.label` was a free variable
/// and the catch-all text binder rendered empty output).
#[test]
fn template_v_for_named_slot_projects_each_iteration() {
    let src = r#"
export default class SlotEachHost {
  items = [{ id: 1, label: "one" }, { id: 2, label: "two" }];
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(
        r#"<section><NavList><template v-for="i in items" :key="i.id" #default><li>{{ i.label }}</li></template></NavList></section>"#,
    )
    .unwrap();
    let program = build_program_module("SlotEachHost.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    assert!(
        js.contains("api.projectDefaultSlot("),
        "the loop fragment must project into the default slot: {js}"
    );
    assert!(
        js.contains("createItem:"),
        "`<template v-for>` must lower to a keyed each schedule: {js}"
    );
    assert!(
        js.contains("key: function(box1) { return (box1.item.id); }"),
        "the wrapper `:key` must bind through the item box: {js}"
    );
    assert!(
        !js.contains("i.label"),
        "item alias must bind through `box1.item`, never stay a free variable: {js}"
    );
    assert!(js.contains("box1.item.label"), "iteration scope must reach the interp: {js}");
    assert!(
        !js.contains(r#"api.el("template")"#),
        "the `<template>` wrapper must stay transparent: {js}"
    );
}

/// A plain `<template v-for>` (no slot marker) is also transparent: rows are
/// fragment-rooted so a multi-root body keeps one keyed row per item.
#[test]
fn template_v_for_body_is_a_multi_root_row() {
    let src = r#"
export default class TemplateEachHost {
  rows = [{ id: 1, label: "one" }];
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(
        r#"<ul><template v-for="r in rows" :key="r.id"><em>{{ r.label }}</em><span>{{ r.id }}</span></template></ul>"#,
    )
    .unwrap();
    let program = build_program_module("TemplateEachHost.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    assert!(js.contains("createItem:"), "expected an each schedule: {js}");
    assert!(
        js.contains("dom.nodeType === 11"),
        "fragment rows need the node-list row bookkeeping: {js}"
    );
    assert!(
        !js.contains(r#"api.el("template")"#),
        "`<template v-for>` must not render a literal template element: {js}"
    );
    assert!(!js.contains("r.label"), "row alias stays a free variable: {js}");
}

/// Every `v-html` write path compares against the live `innerHTML` first, so a
/// hydrate whose SSR markup already matches never re-parses the adopted subtree.
#[test]
fn html_writes_skip_unchanged_markup_on_all_paths() {
    let src = r#"
export default class HtmlPaths {
  markup = "<b>x</b>";
  on = true;
  a = "<i>a</i>";
  b = "<i>b</i>";
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let cases = [
        r#"<div v-html="markup"></div>"#,
        r#"<div v-html="markup" v-once></div>"#,
        r#"<div v-html="on ? a : b"></div>"#,
    ];
    for tpl_src in cases {
        let tpl = parse_template(tpl_src).unwrap();
        let js = emit_client_js(src, &client, &tpl, None).unwrap();
        assert!(
            js.contains("api.html(e0, __s)"),
            "{tpl_src} must go through the digest-aware write: {js}"
        );
        assert!(
            !js.contains("e0.innerHTML ="),
            "{tpl_src} still writes unconditionally: {js}"
        );
    }
}

#[test]
fn plain_template_wrapper_is_transparent() {
    let src = r#"
export default class PlainTemplateHost {
  title = "hello";
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl =
        parse_template(r#"<section><template><h2>{{ title }}</h2></template></section>"#).unwrap();
    let program = build_program_module("PlainTemplateHost.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    assert!(
        !js.contains(r#"api.el("template")"#),
        "`<template>` must stay a transparent fragment: {js}"
    );
    assert!(js.contains("api.frag()"), "expected a fragment wrapper: {js}");
}
