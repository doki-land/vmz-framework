//! Transpile TypeScript script blocks to JS via oxc parser + transformer + codegen.

use std::path::Path;

use oxc::allocator::Allocator;
use oxc::codegen::Codegen;
use oxc::parser::Parser;
use oxc::semantic::SemanticBuilder;
use oxc::span::SourceType;
use oxc::transformer::{TransformOptions, Transformer};

pub fn transpile_ts(source: &str, filename: &str) -> Result<String, String> {
    let allocator = Allocator::default();
    let source_type = SourceType::ts();
    let parsed = Parser::new(&allocator, source, source_type).parse();
    if !parsed.diagnostics.is_empty() {
        let msgs: Vec<_> = parsed.diagnostics.iter().map(|d| d.to_string()).collect();
        // Still try to transform if only warnings; bail on parse panic emptiness.
        if parsed.panicked {
            return Err(msgs.join("; "));
        }
    }

    let mut program = parsed.program;
    let semantic_ret = SemanticBuilder::new().build(&program);
    let _ = &semantic_ret.diagnostics;

    let options = TransformOptions::default();
    let transformer = Transformer::new(&allocator, Path::new(filename), &options);
    let transform_ret =
        transformer.build_with_scoping(semantic_ret.semantic.into_scoping(), &mut program);
    let _ = &transform_ret.diagnostics;

    let code = Codegen::new().build(&program).code;
    Ok(code)
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
