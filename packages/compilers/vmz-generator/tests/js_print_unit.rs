use vmz_generator::js::{JsPrintOptions, print_js_source};

fn minified(source: &str) -> String {
    let options = JsPrintOptions { minify: true, ..JsPrintOptions::default() };
    print_js_source(source, "unit.js", &options)
        .unwrap_or_else(|error| panic!("print failed: {error}"))
        .code
}

#[test]
fn minify_keeps_string_and_template_literal_contents() {
    let source = concat!(
        "const plain = \"a   b\";\n",
        "const quoted = 'x\\ty';\n",
        "const template = `name   ${plain}   tail`;\n",
    );
    let code = minified(source);
    assert!(code.contains("\"a   b\""), "string literal whitespace must survive: {code}");
    assert!(code.contains("'x\\ty'"), "string escape must survive: {code}");
    assert!(code.contains("`name   ${plain}   tail`"), "template text must survive: {code}");
    assert!(!code.contains('\n') || code.contains("const quoted"), "{code}");
}

#[test]
fn minify_drops_comments_without_touching_module_strings() {
    let source = concat!(
        "// import shadow from \"./shadow.ts\"\n",
        "const value = 1; /* block note from './shadow.ts' */\n",
        "export { value };\n",
    );
    let code = minified(source);
    assert!(!code.contains("shadow"), "comments must be dropped: {code}");
    assert!(code.contains("const value=1"), "{code}");
    assert!(code.contains("export{value}") || code.contains("export {value}"), "{code}");
}

#[test]
fn minify_keeps_operators_and_numeric_separators_apart() {
    let code = minified(concat!(
        "const n = 1_000;\n",
        "const sum = a + +b;\n",
        "const diff = a - -b;\n",
        "const ratio = total / /re/.exec(text).length;\n",
    ));
    assert!(code.contains("1_000"), "numeric separators must not be split: {code}");
    assert!(code.contains("a+ +b"), "unary plus must not glue into ++: {code}");
    assert!(code.contains("a- -b"), "unary minus must not glue into --: {code}");
    assert!(!code.contains("total//re/"), "division must not become a comment: {code}");
}

#[test]
fn minify_keeps_generic_closure_after_type_erasure() {
    let code = minified("const cast = (value: Array<string>) => String(value);\n");
    assert!(!code.contains("Array"), "type-only generics must be erased: {code}");
    assert!(code.contains("=>String(value)"), "arrow body must stay intact: {code}");
}

#[test]
fn minify_preserves_restricted_line_breaks() {
    let code = minified(concat!(
        "function pick(flag) {\n",
        "  if (flag)\n",
        "    return\n",
        "  value\n",
        "  return value\n",
        "}\n",
        "async\n",
        "function notAsync() {}\n",
    ));
    assert!(code.contains("return\nvalue"), "newline after return must stay: {code}");
    assert!(
        code.contains("async\nfunction notAsync"),
        "newline after async must stay so it does not become an async function: {code}"
    );
}

#[test]
fn minified_output_reparses_with_oak() {
    let source = concat!(
        "const state = { count: 0, label: \"a   b\" };\n",
        "export function bump(step) {\n",
        "  if (step > 0)\n",
        "    return\n",
        "  state.count += step;\n",
        "  return state.count;\n",
        "}\n",
        "const labels = [1, 2, 3].map((n) => `${n}`);\n",
        "const ratio = state.count / 2 / 3;\n",
        "const pattern = /a b/g;\n",
    );
    let code = minified(source);
    let shell = vmz_oak_frontend_adapter::ScriptShellInput {
        content: code.clone(),
        content_start: 0,
        role: vmz_oak_frontend_adapter::ScriptRole::Client,
    };
    let parsed = vmz_oak_frontend_adapter::parse_script_ast(&shell);
    assert!(parsed.ok, "minified output must stay parseable: {code}\n{:?}", parsed.diagnostics);
}

#[test]
fn requested_source_map_is_real_v3_json() {
    let source = "const value = \"a   b\";\nconst other = value;\n";
    let options = JsPrintOptions::mapped("unit.js");
    let printed = print_js_source(source, "unit.js", &options).expect("print");
    let map: serde_json::Value =
        serde_json::from_str(printed.map.as_deref().expect("map must be emitted")).expect("json");
    assert_eq!(map["version"], 3);
    assert_eq!(map["sources"][0], "unit.js");
    assert_eq!(map["sourcesContent"][0], source);
    let mappings = map["mappings"].as_str().expect("mappings string");
    assert_ne!(mappings, "{}", "an empty fake map is not acceptable");
    assert!(!mappings.is_empty(), "mappings must describe generated positions");
    assert!(mappings.starts_with("AAAA"), "first segment must map 0:0 to 0:0: {mappings}");
    assert_eq!(
        mappings.matches(';').count(),
        printed.code.split('\n').count() - 1,
        "one mapping group per generated line: {mappings}"
    );
}

#[test]
fn minified_source_map_tracks_generated_positions() {
    let source = "const value = \"a   b\";\nconst other = value;\n";
    let options = JsPrintOptions::release_mapped("unit.js");
    let printed = print_js_source(source, "unit.js", &options).expect("print");
    let map: serde_json::Value =
        serde_json::from_str(printed.map.as_deref().expect("map must be emitted")).expect("json");
    assert_eq!(map["version"], 3);
    let mappings = map["mappings"].as_str().expect("mappings string");
    assert_ne!(mappings, "{}");
    assert!(mappings.starts_with("AAAA"), "{mappings}");
    assert!(printed.code.contains("\"a   b\""), "{}", printed.code);
}

#[test]
fn source_map_is_absent_when_not_requested() {
    let printed = print_js_source("const value = 1;\n", "unit.js", &JsPrintOptions::default())
        .expect("print");
    assert!(printed.map.is_none(), "no map was requested, so none must be claimed");
}
