//! Moved from `src/parse/transpile.rs` (cargo-cry: tests next to Cargo.toml).

use vmz_compiler::parse::transpile::*;

#[test]
fn strips_types() {
    let js = transpile_ts(
        r#"
export default class Card {
  public title: string = "x";
  async onMount(): Promise<void> {
this.title = "y";
  }
}
"#,
        "card.ts",
    )
    .unwrap();
    assert!(js.contains("class Card"));
    assert!(js.contains("onMount"));
    assert!(!js.contains("Promise<void>"));
    assert!(!js.contains("public title: string"));
}
