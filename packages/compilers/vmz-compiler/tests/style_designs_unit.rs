//! Moved from `src/style/designs.rs` (cargo-cry: tests next to Cargo.toml).

use std::collections::BTreeMap;
use vmz_compiler::style::designs::*;

#[test]
fn css_var_naming() {
    assert_eq!(css_var_name(&["colors".into(), "action".into()]), "--vmz-colors-action");
}

#[test]
fn resolve_merges_overlay() {
    let theme = StyleTheme {
        default_id: "default".into(),
        activation_attr: "data-theme".into(),
        prefers_color_scheme: BTreeMap::new(),
        tables: vec![
            StyleThemeTable {
                id: "default".into(),
                entries: vec![
                    StyleTokenLeaf {
                        path: vec!["colors".into(), "action".into()],
                        value: "#3366ff".into(),
                    },
                    StyleTokenLeaf {
                        path: vec!["spacing".into(), "4".into()],
                        value: "1rem".into(),
                    },
                ],
            },
            StyleThemeTable {
                id: "dark".into(),
                entries: vec![StyleTokenLeaf {
                    path: vec!["colors".into(), "action".into()],
                    value: "#93c5fd".into(),
                }],
            },
        ],
    };
    let dark = theme.resolve("dark");
    let action =
        dark.iter().find(|e| e.path == ["colors".to_string(), "action".to_string()]).unwrap();
    assert_eq!(action.value, "#93c5fd");
    let spacing = dark.iter().find(|e| e.path == ["spacing".to_string(), "4".to_string()]).unwrap();
    assert_eq!(spacing.value, "1rem");
}

#[test]
fn project_var_refs_for_engine() {
    let theme = StyleTheme {
        default_id: "default".into(),
        activation_attr: "data-theme".into(),
        prefers_color_scheme: BTreeMap::new(),
        tables: vec![StyleThemeTable {
            id: "default".into(),
            entries: vec![StyleTokenLeaf {
                path: vec!["colors".into(), "action".into()],
                value: "#3366ff".into(),
            }],
        }],
    };
    let projected = theme.project_var_refs("default");
    assert_eq!(projected[0].value, "var(--vmz-colors-action)");
}

#[test]
fn emit_uses_activation_attr() {
    let theme = StyleTheme {
        default_id: "default".into(),
        activation_attr: "data-theme".into(),
        prefers_color_scheme: BTreeMap::new(),
        tables: vec![
            StyleThemeTable {
                id: "default".into(),
                entries: vec![StyleTokenLeaf {
                    path: vec!["colors".into(), "action".into()],
                    value: "#3366ff".into(),
                }],
            },
            StyleThemeTable {
                id: "dark".into(),
                entries: vec![StyleTokenLeaf {
                    path: vec!["colors".into(), "action".into()],
                    value: "#93c5fd".into(),
                }],
            },
        ],
    };
    let css = emit_style_theme_css(&theme);
    assert!(css.contains(":root"));
    assert!(css.contains("[data-theme=\"dark\"]"));
    assert!(css.contains("[data-theme=\"default\"]"));
    assert!(css.contains("--vmz-colors-action: #3366ff"));
    assert!(css.contains("--vmz-colors-action: #93c5fd"));
}

#[test]
fn emit_prefers_color_scheme_media() {
    let theme = StyleTheme {
        default_id: "default".into(),
        activation_attr: "data-theme".into(),
        prefers_color_scheme: BTreeMap::from([("dark".into(), "dark".into())]),
        tables: vec![
            StyleThemeTable {
                id: "default".into(),
                entries: vec![StyleTokenLeaf {
                    path: vec!["colors".into(), "action".into()],
                    value: "#3366ff".into(),
                }],
            },
            StyleThemeTable {
                id: "dark".into(),
                entries: vec![StyleTokenLeaf {
                    path: vec!["colors".into(), "action".into()],
                    value: "#93c5fd".into(),
                }],
            },
        ],
    };
    let css = emit_style_theme_css(&theme);
    assert!(css.contains("@media (prefers-color-scheme: dark)"));
    assert!(css.contains("--vmz-colors-action: #93c5fd"));
}

#[test]
fn content_hash_stable_and_sensitive() {
    let a = StyleTheme {
        default_id: "default".into(),
        activation_attr: "data-theme".into(),
        prefers_color_scheme: BTreeMap::new(),
        tables: vec![StyleThemeTable {
            id: "default".into(),
            entries: vec![StyleTokenLeaf {
                path: vec!["colors".into(), "action".into()],
                value: "#3366ff".into(),
            }],
        }],
    };
    let b = a.clone();
    assert_eq!(a.content_hash(), b.content_hash());
    let mut c = a.clone();
    c.tables[0].entries[0].value = "#000000".into();
    assert_ne!(a.content_hash(), c.content_hash());
    let mut d = a.clone();
    d.prefers_color_scheme.insert("dark".into(), "dark".into());
    assert_ne!(a.content_hash(), d.content_hash());
}
