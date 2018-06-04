//! Transpile TypeScript script blocks to JS via oxc parser + transformer + codegen.

use std::path::Path;

use oxc_allocator::Allocator;
use oxc_codegen::Codegen;
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::SourceType;
use oxc_transformer::{TransformOptions, Transformer};

/// Transpile a TypeScript source string to JavaScript via oxc parse/transform/codegen.
///
/// `filename` is used only for transform diagnostics paths. Returns an error when
/// the parser panics; non-fatal parse diagnostics are ignored and codegen still runs.
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
