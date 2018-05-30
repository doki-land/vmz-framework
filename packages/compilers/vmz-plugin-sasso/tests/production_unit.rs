//! Moved from `src/production.rs` (cargo-cry: tests next to Cargo.toml).

use vmz_plugin_sasso::production::*;

#[test]
fn strips_at_tailwind_block() {
    let src = ".a{color:red}\n@tailwind {\n  .x { @apply px-2; }\n}\n.b{color:blue}\n";
    let out = strip_at_tailwind(src);
    assert!(out.contains(".a{color:red}"));
    assert!(out.contains(".b{color:blue}"));
    assert!(!out.contains("@tailwind"));
    assert!(!out.contains("@apply"));
}

#[test]
fn compiles_nested_scss() {
    let css = compile_source(
        ".save-button {\n  color: #333;\n  &:hover { color: #111; }\n}\n".into(),
        StyleLanguage::Scss,
        Path::new("t.vmz"),
        Path::new("."),
    )
    .expect("compile");
    assert!(css.contains(".save-button"));
    assert!(css.contains(":hover") || css.contains(".save-button:hover"));
}
