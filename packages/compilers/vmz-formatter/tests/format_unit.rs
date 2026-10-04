//! Unit tests for vmz-formatter (Oak CST formatting + EditorConfig + SFC assemble).

use std::fs;
use std::path::PathBuf;

use vmz_formatter::{FormatOptions, format_path};

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("vmz-formatter-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn write(path: &std::path::Path, text: &str) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(path, text).unwrap();
}

#[test]
fn formats_script_with_oak_keeps_comment() {
    let dir = temp_dir("script");
    write(
        &dir.join(".editorconfig"),
        "root = true\n[*]\nindent_style = space\nindent_size = 2\nend_of_line = lf\ninsert_final_newline = true\n",
    );
    let file = dir.join("Comp.vmz");
    write(
        &file,
        r#"<template>
  <div>{{ count }}</div>
</template>

<script client>
export default class Comp{/* keep */count=0;}
</script>
"#,
    );

    let report = format_path(&file, &FormatOptions { check: false }).unwrap();
    assert_eq!(report.files_checked, 1);
    assert!(report.files_written >= 1, "expected write: {:?}", report.diagnostics);
    assert!(!report.has_errors(), "{:?}", report.diagnostics);

    let out = fs::read_to_string(&file).unwrap();
    assert!(
        out.contains("/* keep */"),
        "formatter must preserve comments (not codegen strip): {out}"
    );
    assert!(out.contains("class Comp"), "{out}");
    assert!(out.contains("<template>"), "{out}");
}

#[test]
fn preserves_router_meta_and_style_lang() {
    let dir = temp_dir("router");
    write(
        &dir.join(".editorconfig"),
        "root = true\n[*]\nindent_size = 2\nend_of_line = lf\ninsert_final_newline = true\n",
    );
    let file = dir.join("Page.vmz");
    write(
        &file,
        r#"<router path="/x" />
<meta>
{ title: "Hi" }
</meta>
<template>
  <div />
</template>
<style lang="css">
.a{color:red}
</style>
<script client>
export default class Page {}
</script>
"#,
    );

    format_path(&file, &FormatOptions { check: false }).unwrap();
    let out = fs::read_to_string(&file).unwrap();
    assert!(out.contains("<router"), "{out}");
    assert!(out.contains("path=\"/x\"") || out.contains("path='/x'"), "{out}");
    assert!(out.contains("<meta>"), "{out}");
    assert!(out.contains("lang=\"css\""), "{out}");
    assert!(out.contains("<script client>"), "{out}");
}

#[test]
fn editorconfig_indent_size_affects_template_envelope() {
    let dir = temp_dir("indent4");
    write(
        &dir.join(".editorconfig"),
        "root = true\n[*]\nindent_style = space\nindent_size = 4\nend_of_line = lf\ninsert_final_newline = true\n",
    );
    let file = dir.join("A.vmz");
    write(
        &file,
        "<template>\n<div/>\n</template>\n\n<script client>\nexport default class A {}\n</script>\n",
    );

    format_path(&file, &FormatOptions { check: false }).unwrap();
    let out = fs::read_to_string(&file).unwrap();
    assert!(
        out.contains("\n    <div"),
        "expected 4-space template indent from EditorConfig: {out:?}"
    );
}

#[test]
fn editorconfig_vmz_glob_overrides_star() {
    let dir = temp_dir("vmz-glob");
    write(
        &dir.join(".editorconfig"),
        "root = true\n[*]\nindent_size = 2\nend_of_line = lf\ninsert_final_newline = true\n\n[*.vmz]\nindent_size = 4\n",
    );
    let file = dir.join("G.vmz");
    write(
        &file,
        "<template>\n<div/>\n</template>\n\n<script client>\nexport default class G {}\n</script>\n",
    );

    format_path(&file, &FormatOptions { check: false }).unwrap();
    let out = fs::read_to_string(&file).unwrap();
    assert!(out.contains("\n    <div"), "expected [*.vmz] indent_size=4 to win over [*]: {out:?}");
}

#[test]
fn editorconfig_end_of_line_crlf() {
    let dir = temp_dir("crlf");
    write(
        &dir.join(".editorconfig"),
        "root = true\n[*]\nindent_size = 2\nend_of_line = crlf\ninsert_final_newline = true\n",
    );
    let file = dir.join("C.vmz");
    write(
        &file,
        "<template>\n  <div/>\n</template>\n\n<script client>\nexport default class C {}\n</script>\n",
    );

    format_path(&file, &FormatOptions { check: false }).unwrap();
    let out = fs::read_to_string(&file).unwrap();
    assert!(out.contains("\r\n"), "expected CRLF from EditorConfig: {out:?}");
    assert!(!out.replace("\r\n", "").contains('\n'), "unexpected bare LF: {out:?}");
}

#[test]
fn format_is_idempotent() {
    let dir = temp_dir("idempotent");
    write(
        &dir.join(".editorconfig"),
        "root = true\n[*]\nindent_style = space\nindent_size = 2\nend_of_line = lf\ninsert_final_newline = true\n",
    );
    let file = dir.join("Nest.vmz");
    write(
        &file,
        "<template>\n<main>\n  <h1>Hi</h1>\n</main>\n</template>\n\n<script client>\nexport default class Nest {}\n</script>\n",
    );

    format_path(&file, &FormatOptions { check: false }).unwrap();
    let once = fs::read_to_string(&file).unwrap();
    let report = format_path(&file, &FormatOptions { check: false }).unwrap();
    let twice = fs::read_to_string(&file).unwrap();
    assert_eq!(once, twice, "second format must not change output");
    assert_eq!(report.files_written, 0);
    assert_eq!(report.files_need_write, 0);
}

#[test]
fn check_mode_does_not_write() {
    let dir = temp_dir("check");
    write(
        &dir.join(".editorconfig"),
        "root = true\n[*]\nindent_size = 2\nend_of_line = lf\ninsert_final_newline = true\n",
    );
    let file = dir.join("B.vmz");
    let original = "<template>\n  <div/>\n</template>\n\n<script client>\nexport default class B{x=1;}\n</script>\n";
    write(&file, original);

    let report = format_path(&file, &FormatOptions { check: true }).unwrap();
    assert_eq!(report.files_written, 0);
    let after = fs::read_to_string(&file).unwrap();
    assert_eq!(after, original);
    if report.files_need_write > 0 {
        assert!(report.has_errors());
    }
}

#[test]
fn class_bind_string_concat_roundtrips_without_corruption() {
    let dir = temp_dir("class-bind");
    write(
        &dir.join(".editorconfig"),
        "root = true\n[*]\nindent_style = space\nindent_size = 2\nend_of_line = lf\ninsert_final_newline = true\n",
    );
    let file = dir.join("Select.vmz");
    let src = r#"<template>
  <div :class="'vmz-ui-select' + (open ? ' is-opened' : '')" />
</template>

<script client>
export default class Select {}
</script>
"#;
    write(&file, src);

    format_path(&file, &FormatOptions { check: false }).unwrap();
    let once = fs::read_to_string(&file).unwrap();
    assert!(!once.contains(":class=\"\""), "formatter must not corrupt nested quotes: {once}");
    format_path(&file, &FormatOptions { check: false }).unwrap();
    let twice = fs::read_to_string(&file).unwrap();
    assert_eq!(once, twice, "class bind format must be idempotent");
}

#[test]
fn router_json5_block_format_is_idempotent() {
    let dir = temp_dir("router-idempotent");
    write(
        &dir.join(".editorconfig"),
        "root = true\n[*]\nindent_style = space\nindent_size = 4\nend_of_line = lf\ninsert_final_newline = true\n",
    );
    let file = dir.join("landing.vmz");
    write(
        &file,
        r#"<router>
{
  path: "/welcome",
}
</router>
<template>
  <main />
</template>
<script client>
export default class LandingPage {}
</script>
"#,
    );

    format_path(&file, &FormatOptions { check: false }).unwrap();
    let once = fs::read_to_string(&file).unwrap();
    format_path(&file, &FormatOptions { check: false }).unwrap();
    let twice = fs::read_to_string(&file).unwrap();
    assert_eq!(
        once, twice,
        "router block must not drift on second format:\nonce={once:?}\ntwice={twice:?}"
    );
    let report = format_path(&file, &FormatOptions { check: true }).unwrap();
    assert_eq!(report.files_need_write, 0, "check after format: {:?}", report.diagnostics);
    assert!(!report.has_errors(), "{:?}", report.diagnostics);
}

#[test]
fn template_multiline_text_format_is_idempotent() {
    let dir = temp_dir("template-text");
    write(
        &dir.join(".editorconfig"),
        "root = true\n[*]\nindent_style = space\nindent_size = 4\nend_of_line = lf\ninsert_final_newline = true\n",
    );
    let file = dir.join("Planner.vmz");
    write(
        &file,
        r#"<template>
  <p class="lede">
    line one
    line two indented
  </p>
</template>
<script client>
export default class Planner {}
</script>
"#,
    );

    format_path(&file, &FormatOptions { check: false }).unwrap();
    let once = fs::read_to_string(&file).unwrap();
    format_path(&file, &FormatOptions { check: false }).unwrap();
    let twice = fs::read_to_string(&file).unwrap();
    assert_eq!(once, twice, "multiline text must not drift:\nonce={once:?}\ntwice={twice:?}");
}

#[test]
fn style_block_format_is_idempotent() {
    let dir = temp_dir("style-idempotent");
    write(
        &dir.join(".editorconfig"),
        "root = true\n[*]\nindent_style = space\nindent_size = 4\nend_of_line = lf\ninsert_final_newline = true\n",
    );
    let file = dir.join("Monaco.vmz");
    write(
        &file,
        r#"<template>
  <div class="monaco-host" />
</template>
<style>
.monaco-host {
  display: block;
}
</style>
<script client>
export default class Monaco {}
</script>
"#,
    );

    format_path(&file, &FormatOptions { check: false }).unwrap();
    let once = fs::read_to_string(&file).unwrap();
    format_path(&file, &FormatOptions { check: false }).unwrap();
    let twice = fs::read_to_string(&file).unwrap();
    assert_eq!(once, twice, "style block must not drift:\nonce={once:?}\ntwice={twice:?}");
}

#[test]
fn autocomplete_page_format_does_not_hang() {
    let source_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../ui/vmz-ui/src/components/Autocomplete.vmz");
    if !source_path.exists() {
        eprintln!("skip autocomplete fixture: {}", source_path.display());
        return;
    }
    let dir = temp_dir("autocomplete-format");
    write(
        &dir.join(".editorconfig"),
        "root = true\n[*]\nindent_style = space\nindent_size = 4\nend_of_line = lf\ninsert_final_newline = true\n",
    );
    let file = dir.join("Autocomplete.vmz");
    fs::write(&file, fs::read_to_string(&source_path).unwrap()).unwrap();

    format_path(&file, &FormatOptions { check: false }).unwrap();
    let once = fs::read_to_string(&file).unwrap();
    assert!(
        !once.contains("\\\"true\\\"") && !once.contains(":aria-invalid=\"\""),
        "formatter must not corrupt aria-invalid ternary: {once}"
    );

    format_path(&file, &FormatOptions { check: false }).unwrap();
    let twice = fs::read_to_string(&file).unwrap();
    assert_eq!(once, twice, "autocomplete format must be idempotent");

    let report = format_path(&file, &FormatOptions { check: true }).unwrap();
    assert!(!report.has_errors(), "{:?}", report.diagnostics);
}

#[test]
fn deploy_planner_page_format_is_idempotent() {
    let source_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../homepage/src/pages/deploy-planner.vmz");
    if !source_path.exists() {
        eprintln!("skip deploy-planner fixture: {}", source_path.display());
        return;
    }
    let dir = temp_dir("deploy-planner");
    write(
        &dir.join(".editorconfig"),
        "root = true\n[*]\nindent_style = space\nindent_size = 4\nend_of_line = lf\ninsert_final_newline = true\n",
    );
    let file = dir.join("deploy-planner.vmz");
    fs::write(&file, fs::read_to_string(&source_path).unwrap()).unwrap();

    format_path(&file, &FormatOptions { check: false }).unwrap();
    let once = fs::read_to_string(&file).unwrap();
    format_path(&file, &FormatOptions { check: false }).unwrap();
    let twice = fs::read_to_string(&file).unwrap();
    assert_eq!(once, twice, "deploy-planner must not drift on second format");
    let report = format_path(&file, &FormatOptions { check: true }).unwrap();
    assert_eq!(report.files_need_write, 0, "check after format: {:?}", report.diagnostics);
    assert!(!report.has_errors(), "{:?}", report.diagnostics);
}

#[test]
fn non_ts_server_lang_is_not_rewritten_by_js_formatter() {
    let dir = temp_dir("rust-server");
    write(
        &dir.join(".editorconfig"),
        "root = true\n[*]\nindent_size = 2\nend_of_line = lf\ninsert_final_newline = true\n",
    );
    let file = dir.join("S.vmz");
    // Deliberately odd spacing that JS formatter would collapse if it ran.
    let body = "  fn  weird ( ) {  }";
    write(
        &file,
        &format!(
            "<template>\n  <div/>\n</template>\n\n<script client>\nexport default class S {{}}\n</script>\n\n<script server lang=\"rust\">\n{body}\n</script>\n"
        ),
    );

    format_path(&file, &FormatOptions { check: false }).unwrap();
    let out = fs::read_to_string(&file).unwrap();
    assert!(out.contains("lang=\"rust\""), "{out}");
    assert!(out.contains("fn  weird"), "non-TS body must stay: {out}");
}
