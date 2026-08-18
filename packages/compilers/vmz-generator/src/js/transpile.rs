//! Transpile TypeScript script blocks to JS via oxc parser + transformer + codegen.

use std::path::Path;

use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::SourceType;
use oxc_transformer::{TransformOptions, Transformer};

use super::print::{EmittedJs, JsPrintOptions, print_js_program};

/// Transpile result with optional source map JSON.
pub type TranspileOutput = EmittedJs;

/// Transpile a TypeScript source string to JavaScript via oxc parse/transform/codegen.
///
/// `filename` is used only for transform diagnostics paths. Returns an error when
/// the parser panics; non-fatal parse diagnostics are ignored and codegen still runs.
pub fn transpile_ts(source: &str, filename: &str) -> Result<String, String> {
    Ok(transpile_ts_printed(source, filename, &JsPrintOptions::default())?.code)
}

/// Transpile with source map (`source_map_path` sets the map `sources` hint).
pub fn transpile_ts_with_map(
    source: &str,
    filename: &str,
    source_map_path: Option<&Path>,
) -> Result<TranspileOutput, String> {
    transpile_ts_printed(
        source,
        filename,
        &JsPrintOptions { minify: false, source_map_path: source_map_path.map(|p| p.to_path_buf()) },
    )
}

/// Parse + transform TypeScript, then [`print_js_program`] (minify and map are independent).
pub fn transpile_ts_printed(
    source: &str,
    filename: &str,
    print: &JsPrintOptions,
) -> Result<EmittedJs, String> {
    let allocator = Allocator::default();
    let source_type = SourceType::ts();
    let parsed = Parser::new(&allocator, source, source_type).parse();
    if parsed.panicked {
        let msgs: Vec<_> = parsed.diagnostics.iter().map(|d| d.to_string()).collect();
        return Err(msgs.join("; "));
    }

    let mut program = parsed.program;
    let semantic_ret = SemanticBuilder::new().build(&program);
    let options = TransformOptions::default();
    let transformer = Transformer::new(&allocator, Path::new(filename), &options);
    let _ = transformer.build_with_scoping(semantic_ret.semantic.into_scoping(), &mut program);
    Ok(print_js_program(&allocator, &mut program, print))
}
