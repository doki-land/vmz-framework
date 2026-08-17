//! Production TwCompiler: Style Theme projection -> CSS.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use vmz_compiler::{
    StyleTheme, StyleThemeTable, StyleTokenLeaf, TwCompiler, TwEmitRequest, TwRegKind,
    TwRegistration,
};
use vmz_plugin_tailwind::ProductionTwCompiler;

fn fixture_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

fn theme_from_fixture(root: &Path) -> StyleTheme {
    // Prefer compiler-loaded theme; for unit tests build a minimal Style Theme
    // that mirrors designs/tokens colors.action.
    let designs = vmz_compiler::load_designs(root);
    if !designs.theme.is_empty() {
        return designs.theme;
    }
    StyleTheme {
        default_id: "default".into(),
        activation_attr: "data-theme".into(),
        prefers_color_scheme: Default::default(),
        tables: vec![StyleThemeTable {
            id: "default".into(),
            entries: vec![
                StyleTokenLeaf {
                    path: vec!["colors".into(), "action".into()],
                    value: "#3366ff".into(),
                },
                StyleTokenLeaf { path: vec!["spacing".into(), "4".into()], value: "1rem".into() },
            ],
        }],
    }
}

#[test]
fn production_emit_from_registrations() {
    let root = fixture_root();
    let result = ProductionTwCompiler.emit_project(&TwEmitRequest {
        project_root: root.clone(),
        out_dir: root.join("dist-unused"),
        registrations: vec![
            TwRegistration {
                token: "px-4".into(),
                path: root.join("Application.vmz"),
                kind: TwRegKind::StyleTw,
            },
            TwRegistration {
                token: "bg-action".into(),
                path: root.join("Application.vmz"),
                kind: TwRegKind::StyleTw,
            },
        ],
        style_theme: theme_from_fixture(&root),
    });

    assert!(!result.css.is_empty(), "diags={:?}", result.diagnostics);
    assert_eq!(result.css_relative, "vmz-tw.css");
    assert!(
        result.css.contains("var(--vmz-colors-action)")
            || result.css.contains("#3366ff")
            || result.css.contains("3366ff")
            || result.css.contains("padding"),
        "css={}",
        result.css
    );
}

#[test]
fn production_bg_action_uses_style_theme_vars() {
    let root = fixture_root();
    let result = Arc::new(ProductionTwCompiler).emit_project(&TwEmitRequest {
        project_root: root.clone(),
        out_dir: root.join("dist-unused"),
        registrations: vec![TwRegistration {
            token: "bg-action".into(),
            path: root.join("tmp.vmz"),
            kind: TwRegKind::StyleTw,
        }],
        style_theme: theme_from_fixture(&root),
    });

    assert!(
        result.static_tokens.iter().any(|t| t == "bg-action"),
        "tokens={:?}",
        result.static_tokens
    );
    assert!(
        result.css.contains("var(--vmz-colors-action)")
            || result.css.contains("#3366ff")
            || result.css.contains("3366ff"),
        "expected Style Theme projection; css={}",
        result.css
    );
}
