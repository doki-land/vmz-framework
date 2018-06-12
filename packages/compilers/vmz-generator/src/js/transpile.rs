//! Transpile TypeScript script blocks to JS via oxc parser + transformer + codegen.

use std::path::{Path, PathBuf};

use oxc_allocator::Allocator;
use oxc_codegen::{Codegen, CodegenOptions, CodegenReturn};
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::SourceType;
use oxc_transformer::{TransformOptions, Transformer};

/// Transpile result with optional source map JSON.
#[derive(Debug, Clone)]
pub struct TranspileOutput {
    /// Generated JavaScript.
    pub code: String,
    /// Source map JSON when requested.
    pub map: Option<String>,
}

/// Transpile a TypeScript source string to JavaScript via oxc parse/transform/codegen.
///
/// `filename` is used only for transform diagnostics paths. Returns an error when
/// the parser panics; non-fatal parse diagnostics are ignored and codegen still runs.
pub fn transpile_ts(source: &str, filename: &str) -> Result<String, String> {
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
    let code = Codegen::new().build(&program).code;
    Ok(code)
}

/// Transpile with source map (`source_map_path` sets the map `file`/`sources` hint).
pub fn transpile_ts_with_map(
    source: &str,
    filename: &str,
    source_map_path: Option<&Path>,
) -> Result<TranspileOutput, String> {
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

    let path = source_map_path
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from(filename));
    let codegen_opts = CodegenOptions {
        source_map_path: Some(path),
        ..CodegenOptions::default()
    };
    let CodegenReturn { code, map, .. } = Codegen::new().with_options(codegen_opts).build(&program);
    let map = map.map(|m| m.to_json_string());
    Ok(TranspileOutput { code, map })
}
