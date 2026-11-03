//! Moved from `src/style/tw.rs` (cargo-cry: tests next to Cargo.toml).

use vmz_compiler::sfc::parse_vmz;
use vmz_compiler::style::tw::*;

#[test]
fn registers_style_tw_and_apply() {
    let src = r#"
<template><button style:tw="px-4 bg-action">x</button></template>
<style>
@tailwind { .chip { @apply rounded px-2; } }
</style>
<script client>
export default class T {}
</script>
"#;
    let parsed = parse_vmz("t.vmz", src).unwrap();
    let mut regs = Vec::new();
    register_tw_from_parsed(&parsed, &mut regs);
    let tokens: Vec<_> = regs.iter().map(|r| r.token.as_str()).collect();
    assert!(tokens.contains(&"px-4") && tokens.contains(&"bg-action"));
    assert!(tokens.contains(&"rounded") && tokens.contains(&"px-2"));
}

/// `style:tw={expr}` is a runtime class list: its braces must not leak into
/// static registrations.
#[test]
fn skips_dynamic_style_tw_values() {
    let src = r#"
<template><button style:tw="px-4">x</button><div style:tw={dynamicClass}>y</div></template>
<script client>
export default class T {}
</script>
"#;
    let parsed = parse_vmz("t.vmz", src).unwrap();
    let mut regs = Vec::new();
    register_tw_from_parsed(&parsed, &mut regs);
    let tokens: Vec<_> = regs.iter().map(|r| r.token.as_str()).collect();
    assert_eq!(tokens, vec!["px-4"]);
}
