//! Moved from `src/collect.rs` (cargo-cry: tests next to Cargo.toml).

use vmz_plugin_tailwind::collect::*;

const SAMPLE: &str = r#"<template>
  <button class="save" style:tw="px-4 py-2 rounded">Save</button>
  <div style:tw={dynamicClass}>x</div>
</template>
<style>
@tailwind {
  .btn { @apply px-4 font-bold; }
}
</style>
<script client>
export default class Application {}
</script>
"#;

#[test]
fn collects_style_tw_and_at_tailwind() {
    let (col, diags) = collect_from_source("x.vmz", SAMPLE).expect("parse");
    assert!(
        col.sites.iter().any(|s| s.kind == TwTokenKind::StyleTw && !s.dynamic),
        "{:?}",
        col.sites
    );
    assert!(
        col.sites.iter().any(|s| s.kind == TwTokenKind::StyleTw && s.dynamic),
        "expected dynamic site"
    );
    assert!(col.sites.iter().any(|s| s.kind == TwTokenKind::AtTailwind), "{:?}", col.sites);
    assert!(col.static_tokens.iter().any(|t| t == "px-4"));
    assert!(col.static_tokens.iter().any(|t| t == "font-bold"));
    assert!(diags.iter().any(|d| d.message().contains("dynamic boundary")), "{diags:?}");
}
