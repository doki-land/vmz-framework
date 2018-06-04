//! Production [`TwCompiler`]: registered tokens → Style Theme projection → Engine → CSS.
//!
//! Engine theme is a **projection** of the compiler Style Theme (`var(--vmz-…)`),
//! not a second product-level theme. Runtime theme activation then applies to TW
//! utilities and SCSS alike.

use std::collections::BTreeSet;
use std::sync::Arc;

use tailwind::{ColorValue, LengthValue, ThemeEntry, ThemeInput, ThemeKey, ThemeValue};
use vmz_compiler::{
    ReportedDiagnostic, StyleTheme, StyleTokenLeaf, TwCompiler, TwCompilerHandle, TwEmitRequest,
    TwEmitResult,
};

use crate::collect::TwCollection;
use crate::designs::{load_theme_from_designs, scan_designs_dir};
use crate::engine_bridge::{compile_registrations, map_engine_diagnostics};

/// Production TW compiler linked into the `vmz` binary.
#[derive(Debug, Default, Clone, Copy)]
pub struct ProductionTwCompiler;

impl TwCompiler for ProductionTwCompiler {
    fn emit_project(&self, req: &TwEmitRequest) -> TwEmitResult {
        emit_project_impl(req)
    }
}

/// Default TW compiler handle for linking into the `vmz` binary.
pub fn default_tw_compiler() -> TwCompilerHandle {
    Arc::new(ProductionTwCompiler)
}

fn emit_project_impl(req: &TwEmitRequest) -> TwEmitResult {
    let mut diagnostics = Vec::new();
    let mut token_set = BTreeSet::new();
    for r in &req.registrations {
        if !r.token.is_empty() {
            token_set.insert(r.token.clone());
        }
    }
    let static_tokens: Vec<String> = token_set.into_iter().collect();
    if static_tokens.is_empty() {
        return TwEmitResult {
            css: String::new(),
            css_relative: "vmz-tw.css".into(),
            diagnostics,
            static_tokens: Vec::new(),
        };
    }

    let theme = theme_from_request(req, &mut diagnostics);

    let lowering = compile_registrations(&req.registrations, theme);
    let collection = TwCollection {
        path: req.project_root.join("<tw-registrations>"),
        sites: Vec::new(),
        static_tokens: static_tokens.clone(),
    };
    diagnostics.extend(map_engine_diagnostics(&collection, &lowering));

    TwEmitResult {
        css: lowering.reference_css,
        css_relative: "vmz-tw.css".into(),
        diagnostics,
        static_tokens,
    }
}

fn theme_from_request(
    req: &TwEmitRequest,
    diagnostics: &mut Vec<ReportedDiagnostic>,
) -> ThemeInput {
    if !req.style_theme.is_empty() {
        return project_style_theme(&req.style_theme);
    }
    let designs = scan_designs_dir(&req.project_root);
    match load_theme_from_designs(&designs) {
        Ok(t) => t,
        Err(e) => {
            diagnostics.push(ReportedDiagnostic::warning(
                &req.project_root,
                format!("designs theme load: {e}"),
            ));
            ThemeInput::default()
        }
    }
}

fn project_style_theme(theme: &StyleTheme) -> ThemeInput {
    let leaves = theme.project_var_refs(&theme.default_id);
    leaves_to_theme_input(&leaves)
}

fn leaves_to_theme_input(leaves: &[StyleTokenLeaf]) -> ThemeInput {
    let mut entries = Vec::with_capacity(leaves.len());
    for t in leaves {
        let key = ThemeKey::from_path(t.path.iter().map(|s| s.as_str()));
        let value = classify_var_ref(&t.path, &t.value);
        entries.push(ThemeEntry { key, value });
    }
    ThemeInput { entries }
}

fn classify_var_ref(path: &[String], css: &str) -> ThemeValue {
    match path.first().map(|s| s.as_str()) {
        Some("colors" | "color" | "backgroundColor" | "fill" | "stroke") => {
            ThemeValue::Color(ColorValue { css: css.to_string() })
        }
        Some("spacing" | "size" | "width" | "height" | "gap" | "padding" | "margin") => {
            ThemeValue::Length(LengthValue { css: css.to_string() })
        }
        _ => ThemeValue::Keyword(css.to_string()),
    }
}
