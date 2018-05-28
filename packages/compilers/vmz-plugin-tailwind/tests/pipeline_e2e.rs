//! Full pipeline against git `tailwind-rs` `dev`.

use std::path::PathBuf;

use vmz_plugin_tailwind::{PipelineOptions, run_pipeline_source};

fn fixture_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

#[test]
fn full_pipeline_collect_theme_engine_css() {
    let root = fixture_root();
    let source =
        std::fs::read_to_string(root.join("Application.vmz")).expect("read Application.vmz");
    let result = run_pipeline_source(
        root.join("Application.vmz"),
        source,
        &PipelineOptions { project_root: Some(root.clone()) },
    )
    .expect("pipeline");

    assert!(
        result.collection.static_tokens.iter().any(|t| t == "px-4"),
        "tokens={:?}",
        result.collection.static_tokens
    );
    assert!(
        result.collection.static_tokens.iter().any(|t| t == "rounded"),
        "from @apply: {:?}",
        result.collection.static_tokens
    );
    assert!(!result.designs.missing, "designs stub should see fixtures/designs");
    assert!(result.theme_entry_count >= 2, "theme entries={}", result.theme_entry_count);

    // Engine must produce structured rules; spacing.4 override → 2rem on p-related tokens.
    assert!(
        !result.lowering.response.module.rules.is_empty(),
        "module empty; diags={:?}",
        result.lowering.response.diagnostics
    );
    assert!(result.lowering.reference_css.contains('{'), "css={}", result.lowering.reference_css);
    assert!(
        result.lowering.reference_css.contains("padding")
            || result.lowering.reference_css.contains("background"),
        "css={}",
        result.lowering.reference_css
    );

    // Theme override: p-4 / px-4 should see spacing.4 = 2rem somewhere.
    let css = &result.lowering.reference_css;
    let module = &result.lowering.response.module;
    let has_2rem = module.rules.iter().any(|r| {
        r.declarations.iter().any(|d| match &d.value {
            tailwind::CssValue::Length(l) => l.css.contains("2rem"),
            _ => false,
        })
    }) || css.contains("2rem");
    assert!(has_2rem, "expected spacing.4 override in module/css; css={css}");
}
