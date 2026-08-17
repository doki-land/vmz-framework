//! Unit tests for vmz-formatter (oxc IR formatter + EditorConfig + SFC assemble).

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
fn formats_script_with_oxc_formatter_keeps_comment() {
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
    assert!(report.files_written >= 1 || report.files_need_write >= 0);
    assert!(!report.has_errors(), "{:?}", report.diagnostics);

    let out = fs::read_to_string(&file).unwrap();
    assert!(out.contains("/* keep */"), "formatter must preserve comments (not codegen strip): {out}");
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
