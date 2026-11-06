//! `v-model` target contract: checkbox array models and structured rejection of
//! non-assignable targets.

use vmz_compiler::analyze::analyze_script;
use vmz_compiler::emit::emit_client_js;
use vmz_compiler::pipeline::emit_direct::is_direct_eligible;
use vmz_compiler::reactive_build::build_program_module;
use vmz_compiler::sfc::ScriptKind;
use vmz_compiler::template::parse_template;

#[test]
fn checkbox_value_binds_array_membership_and_toggles_entries() {
    let src = r#"
export default class ArrayModel {
  form = { picked: ["a"] };
  checked = false;
}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(
        r#"<div>
  <input type="checkbox" value="a" v-model="form.picked" />
  <input type="checkbox" :value="'b'" v-model="form.picked" />
  <input type="checkbox" v-model="checked" />
</div>"#,
    )
    .unwrap();
    let program = build_program_module("t.vmz", &client.decl, &tpl);
    assert!(is_direct_eligible(&program.units[0].view));
    let js = emit_client_js(src, &client, &tpl, None).unwrap();
    // `checked` is membership while the model is an array, not the raw array value.
    assert!(
        js.contains(r#"Array.isArray(__vmzM) ? __vmzM.indexOf("a") > -1"#),
        "static `value` does not drive membership: {js}"
    );
    assert!(
        js.contains(r#"Array.isArray(__vmzM) ? __vmzM.indexOf('b') > -1"#),
        "bound `:value` does not drive membership: {js}"
    );
    // Write-back toggles one entry and keeps the array identity contract.
    assert!(
        js.contains(r#"const __vmzI = __vmzM.indexOf(__vmzV)"#),
        "checkbox handler does not locate the entry: {js}"
    );
    assert!(
        js.contains(r#"__vmzM.concat([__vmzV])"#) && js.contains(r#"__vmzM.slice(0, __vmzI)"#),
        "checkbox handler does not add / remove entries: {js}"
    );
    // A boolean model keeps the old write-back semantics.
    assert!(
        js.contains(r#"if (!Array.isArray(__vmzM)) return __vmzOn"#),
        "boolean checkbox model lost its branch: {js}"
    );
}

#[test]
fn non_assignable_v_model_target_is_a_structured_error() {
    let err = parse_template(r#"<input v-model="(count + 1)" />"#).unwrap_err();
    assert_eq!(err.code, "vmz::template::v_model_invalid_target");
    assert_eq!(err.args.get("expr").map(String::as_str), Some("(count + 1)"));

    // Components share the same write-back contract.
    let err = parse_template(r#"<ChildCard v-model="count + 1" />"#).unwrap_err();
    assert_eq!(err.code, "vmz::template::v_model_invalid_target");

    // Identifiers, member chains and nested computed members stay assignable.
    assert!(parse_template(r#"<input v-model="count" />"#).is_ok());
    assert!(parse_template(r#"<input v-model="form.items[0].name" />"#).is_ok());
}
