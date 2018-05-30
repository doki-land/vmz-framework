//! Moved from `src/parse/format.rs` (cargo-cry: tests next to Cargo.toml).

use vmz_compiler::parse::format::*;

#[test]
fn formats_script_block() {
    let src = "export default class A{count=0;}";
    let out = format_script(src).unwrap();
    assert!(out.contains("class A"));
    assert!(out.contains("count"));
}
