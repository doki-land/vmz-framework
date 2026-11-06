//! `v-model` on a `multiple` select writes back every selected option, and a
//! `v-model` argument on a native form control is rejected structurally.

use vmz_compiler::analyze::analyze_script;
use vmz_compiler::emit::emit_client_js;
use vmz_compiler::pipeline::emit_direct::is_direct_eligible;
use vmz_compiler::reactive_build::build_program_module;
use vmz_compiler::sfc::ScriptKind;
use vmz_compiler::template::parse_template;

#[test]
fn multiple_select_writes_back_every_selected_option() {
    let src = r#"
export default class MultiSelect {
  multi = ["a", "c"];
  plan = "";
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(
        r#"<div>
  <select multiple v-model="multi">
    <option value="a">A</option>
    <option value="b">B</option>
    <option value="c">C</option>
  </select>
  <select v-model="plan">
    <option value="dev">dev</option>
    <option value="prod">prod</option>
  </select>
</div>"#,
    )
    .unwrap();
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    // `multiple` is applied as a boolean attribute before the model patch.
    assert!(js.contains(r#""multiple", true"#), "missing multiple attr: {js}");
    // Every selected option is written back as an array.
    assert!(
        js.contains(r#"Array.from($event.target.selectedOptions, (__vmzO) => __vmzO.value)"#),
        "multiple select does not write back an array: {js}"
    );
    // A single select keeps the native string write-back.
    assert!(
        js.contains(r#"((this.plan) = $event.target.value)"#),
        "single select lost its string write-back: {js}"
    );
    assert!(
        !js.contains(r#"this.plan) = Array.from"#),
        "single select picked up array semantics: {js}"
    );
}

#[test]
fn file_input_v_model_is_a_structured_error() {
    let err = parse_template(r#"<input type="file" v-model="pickedFile" />"#).unwrap_err();
    assert_eq!(err.code, "vmz::template::v_model_on_file_input");

    // `v-model` arguments on plain elements stay rejected instead of falling
    // through to the component `arg` / `update:arg` contract.
    let err = parse_template(r#"<select v-model:plan="plan" />"#).unwrap_err();
    assert_eq!(err.code, "vmz::template::parse_failed");
    assert!(err.render_plain().contains("argument is not supported on plain elements"));

    // Text inputs and components keep binding.
    assert!(parse_template(r#"<input type="text" v-model="text" />"#).is_ok());
    assert!(parse_template(r#"<ChildCard v-model:plan="plan" />"#).is_ok());
}
