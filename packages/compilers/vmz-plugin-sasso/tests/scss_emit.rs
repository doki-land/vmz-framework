//! SCSS style plugin production emit.

use std::path::PathBuf;
use std::sync::Arc;

use vmz_compiler::{ScssCompiler, ScssEmitRequest};
use vmz_plugin_sasso::ProductionScssCompiler;

#[test]
fn emits_nested_scss_from_style_block() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    std::fs::create_dir_all(&dir).unwrap();
    let vmz = dir.join("Nested.vmz");
    std::fs::write(
        &vmz,
        r#"<template><button class="save-button">x</button></template>
<style>
.save-button {
  color: #333;
  &:hover { color: #111; }
}
</style>
<script client>
export default class Nested {}
</script>
"#,
    )
    .unwrap();

    let result = Arc::new(ProductionScssCompiler).emit_project(&ScssEmitRequest {
        project_root: dir.clone(),
        out_dir: dir.join("dist-unused"),
        sources: vec![vmz.clone()],
        designs_style_entry: None,
        designs_style_files: Vec::new(),
    });
    let _ = std::fs::remove_file(&vmz);

    assert!(
        result.diagnostics.iter().all(|d| !matches!(d.severity(), vmz_compiler::Severity::Error)),
        "diags={:?}",
        result.diagnostics
    );
    assert!(
        result.css.contains(".save-button")
            && (result.css.contains(":hover") || result.css.contains("hover")),
        "css={}",
        result.css
    );
    assert_eq!(result.css_relative, "vmz-style.css");
}

#[test]
fn strips_at_tailwind_before_scss() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    std::fs::create_dir_all(&dir).unwrap();
    let vmz = dir.join("TwMix.vmz");
    std::fs::write(
        &vmz,
        r#"<template><p class="a">x</p></template>
<style>
.a { color: red; }
@tailwind {
  .chip { @apply rounded; }
}
.b { color: blue; }
</style>
<script client>
export default class TwMix {}
</script>
"#,
    )
    .unwrap();

    let result = ProductionScssCompiler.emit_project(&ScssEmitRequest {
        project_root: dir.clone(),
        out_dir: dir.join("dist-unused"),
        sources: vec![vmz.clone()],
        designs_style_entry: None,
        designs_style_files: Vec::new(),
    });
    let _ = std::fs::remove_file(&vmz);

    assert!(
        result.diagnostics.iter().all(|d| !matches!(d.severity(), vmz_compiler::Severity::Error)),
        "diags={:?}",
        result.diagnostics
    );
    assert!(result.css.contains("color"), "css={}", result.css);
    assert!(!result.css.contains("@apply"), "css={}", result.css);
}
