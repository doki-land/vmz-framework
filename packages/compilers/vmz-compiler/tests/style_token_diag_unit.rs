//! Moved from `src/style/token_diag.rs` (cargo-cry: tests next to Cargo.toml).

use std::path::Path;
use vmz_compiler::{DesignsBundle, StyleTheme, parse_vmz};

use std::path::PathBuf;

use std::collections::BTreeMap;
use vmz_compiler::designs::{StyleThemeTable, StyleTokenLeaf};
use vmz_compiler::style::token_diag::*;

fn theme_with_action() -> StyleTheme {
    StyleTheme {
        default_id: "default".into(),
        activation_attr: "data-theme".into(),
        prefers_color_scheme: BTreeMap::new(),
        tables: vec![StyleThemeTable {
            id: "default".into(),
            entries: vec![
                StyleTokenLeaf {
                    path: vec!["colors".into(), "action".into()],
                    value: "#3366ff".into(),
                },
                StyleTokenLeaf {
                    path: vec!["colors".into(), "action-hover".into()],
                    value: "#254eda".into(),
                },
                StyleTokenLeaf { path: vec!["spacing".into(), "4".into()], value: "1rem".into() },
            ],
        }],
    }
}

#[test]
fn collect_var_refs_basic() {
    let refs = collect_vmz_css_var_refs(
        "color: var(--vmz-colors-action); border: var( --vmz-colors-action-hover , red);",
    );
    assert_eq!(
        refs,
        vec!["--vmz-colors-action".to_string(), "--vmz-colors-action-hover".to_string()]
    );
}

#[test]
fn known_token_ok_unknown_errors() {
    let theme = theme_with_action();
    let known = theme.known_css_vars();
    let path = PathBuf::from("styles/x.scss");
    let diags = validate_vmz_css_var_refs(
        &theme,
        &known,
        &path,
        "a { color: var(--vmz-colors-action); background: var(--vmz-colors-nope); }",
    );
    assert_eq!(diags.len(), 1);
    assert_eq!(diags[0].code(), DIAG_UNKNOWN_DESIGN_TOKEN);
    assert!(
        diags[0].args().is_some_and(|a| a.get("name").is_some_and(|n| n.contains("nope"))),
        "args={:?}",
        diags[0].args()
    );
}

#[test]
fn utility_maps_semantic_color_not_numeric() {
    assert_eq!(design_token_ref_from_utility("hover:bg-action"), Some(("colors", "action")));
    assert_eq!(design_token_ref_from_utility("bg-red-500"), None);
    assert_eq!(theme_leaf_ref_from_utility("px-4"), Some(("spacing", "4")));
}

#[test]
fn style_tw_unknown_design_token() {
    let theme = theme_with_action();
    let source = r#"<template>
  <button style:tw="px-4 bg-action bg-nope">x</button>
</template>
<script client>
export default class X {}
</script>
"#;
    let parsed = parse_vmz(PathBuf::from("pages/x.vmz"), source.to_string()).unwrap();
    let diags = validate_style_tw_design_token_refs(&theme, &parsed);
    assert_eq!(diags.len(), 1, "{diags:?}");
    assert_eq!(diags[0].code(), DIAG_UNKNOWN_DESIGN_TOKEN);
    assert!(
        diags[0].args().is_some_and(|a| a.get("token").is_some_and(|t| t.contains("bg-nope"))),
        "args={:?}",
        diags[0].args()
    );
}

#[test]
fn unused_design_token_warns() {
    let theme = StyleTheme {
        default_id: "default".into(),
        activation_attr: "data-theme".into(),
        prefers_color_scheme: BTreeMap::new(),
        tables: vec![StyleThemeTable {
            id: "default".into(),
            entries: vec![
                StyleTokenLeaf {
                    path: vec!["colors".into(), "action".into()],
                    value: "#3366ff".into(),
                },
                StyleTokenLeaf {
                    path: vec!["colors".into(), "orphan".into()],
                    value: "#000000".into(),
                },
            ],
        }],
    };
    let designs = DesignsBundle {
        root: PathBuf::from("designs"),
        missing: false,
        theme,
        style_entry: None,
        style_files: vec![],
        diagnostics: vec![],
    };
    let diags = validate_unused_design_tokens(Path::new("."), &designs);
    assert!(diags.iter().any(|d| {
        d.code() == DIAG_UNUSED_DESIGN_TOKEN
            && d.args().is_some_and(|a| a.get("name").is_some_and(|n| n.contains("orphan")))
    }));
    assert!(diags.iter().all(|d| !d.is_error()));
}

#[test]
fn collect_style_imports() {
    let specs = collect_style_import_specs(
        "@use './buttons';\n@import \"cards.scss\";\n@forward 'theme';\n",
    );
    assert!(specs.iter().any(|s| s.contains("buttons")));
    assert!(specs.iter().any(|s| s.contains("cards")));
    assert!(specs.iter().any(|s| s.contains("theme")));
}

#[test]
fn unreferenced_global_style_warns() {
    let dir = tempfile_styles();
    let entry = dir.join("index.scss");
    let orphan = dir.join("orphan.scss");
    std::fs::write(&entry, "body { color: red; }\n").unwrap();
    std::fs::write(&orphan, ".x { color: blue; }\n").unwrap();
    let designs = DesignsBundle {
        root: dir.parent().unwrap().to_path_buf(),
        missing: false,
        theme: StyleTheme::default(),
        style_entry: Some(entry.clone()),
        style_files: vec![entry, orphan.clone()],
        diagnostics: vec![],
    };
    let diags = validate_unreferenced_global_styles(&designs);
    assert_eq!(diags.len(), 1, "{diags:?}");
    assert_eq!(diags[0].code(), DIAG_UNREFERENCED_GLOBAL_STYLE);
    assert!(
        diags[0].args().is_some_and(|a| {
            a.values().any(|v| v.contains("orphan"))
                || a.get("rel").is_some_and(|r| r.contains("orphan"))
                || a.get("path").is_some_and(|r| r.contains("orphan"))
                || a.get("detail").is_some_and(|r| r.contains("orphan"))
        }),
        "args={:?}",
        diags[0].args()
    );
    let _ = std::fs::remove_dir_all(dir.parent().unwrap());
}

fn tempfile_styles() -> PathBuf {
    let root = std::env::temp_dir().join(format!("vmz-styles-{}", std::process::id()));
    let styles = root.join("styles");
    std::fs::create_dir_all(&styles).unwrap();
    styles
}
