//! Single JS print path: optional oxc minify (compress + mangle + DCE) then codegen + sourcemap.
//!
//! Author `.vmz` pretty-print is `vmz-formatter` (IR formatter). This module prints
//! **artifacts**. `minify` and `source_map_path` are independent: release can emit
//! minified JS and a `.js.map` in one pass.

use std::path::PathBuf;

use oxc_allocator::Allocator;
use oxc_ast::ast::Program;
use oxc_codegen::{Codegen, CodegenOptions, CodegenReturn, CommentOptions};
use oxc_minifier::{CompressOptions, MangleOptions, Minifier, MinifierOptions};
use oxc_parser::Parser;
use oxc_span::SourceType;

/// JS emit result (code + optional source map JSON).
#[derive(Debug, Clone)]
pub struct EmittedJs {
    /// Module source.
    pub code: String,
    /// Source map JSON when produced.
    pub map: Option<String>,
}

/// Print options for [`print_js_program`] / [`print_js_source`].
#[derive(Debug, Clone, Default)]
pub struct JsPrintOptions {
    /// Run oxc minifier (peephole / unused DCE / inner-scope mangle) then
    /// whitespace-minifying codegen. Top-level ESM bindings are **not** mangled
    /// (component registry keys / import locals). Property names are never
    /// renamed — no `__vmz*` reserve list.
    pub minify: bool,
    /// When `Some`, codegen emits a source map. Path sets the map `sources` hint.
    pub source_map_path: Option<PathBuf>,
}

impl JsPrintOptions {
    /// Dev artifact: readable codegen + sourcemap named after `js_file`.
    pub fn mapped(js_file: impl Into<PathBuf>) -> Self {
        Self { minify: false, source_map_path: Some(js_file.into()) }
    }

    /// Release artifact: minify + sourcemap named after `js_file`.
    pub fn release_mapped(js_file: impl Into<PathBuf>) -> Self {
        Self { minify: true, source_map_path: Some(js_file.into()) }
    }
}

/// Print an existing oxc `Program` (after parse / transform). Mutates `program` when minifying.
pub fn print_js_program<'a>(
    allocator: &'a Allocator,
    program: &mut Program<'a>,
    options: &JsPrintOptions,
) -> EmittedJs {
    let scoping = if options.minify {
        let min_opts = MinifierOptions {
            // Keep ESM / class / import locals; mangle nested scopes (including
            // local `function __vmzCreate` bindings). Property keys stay.
            mangle: Some(MangleOptions { top_level: Some(false), ..MangleOptions::default() }),
            compress: Some(CompressOptions::smallest()),
        };
        Minifier::new(min_opts).minify(allocator, program).scoping
    } else {
        None
    };

    let mut codegen_opts = if options.minify {
        CodegenOptions {
            minify: true,
            comments: CommentOptions::disabled(),
            ..CodegenOptions::default()
        }
    } else {
        CodegenOptions::default()
    };
    codegen_opts.source_map_path = options.source_map_path.clone();

    let mut codegen = Codegen::new().with_options(codegen_opts);
    if scoping.is_some() {
        codegen = codegen.with_scoping(scoping);
    }
    let CodegenReturn { mut code, map, .. } = codegen.build(program);
    let map = map.map(|m| m.to_json_string());
    if map.is_some()
        && let Some(url) = source_mapping_url(options)
    {
        if !code.ends_with('\n') {
            code.push('\n');
        }
        code.push_str("//# sourceMappingURL=");
        code.push_str(&url);
        code.push('\n');
    }
    EmittedJs { code, map }
}

/// Parse `source` as JS/TS (from `filename` extension) then [`print_js_program`].
pub fn print_js_source(source: &str, filename: &str, options: &JsPrintOptions) -> Result<EmittedJs, String> {
    let allocator = Allocator::default();
    let source_type = SourceType::from_path(filename).unwrap_or_else(|_| SourceType::mjs());
    let parsed = Parser::new(&allocator, source, source_type).parse();
    if parsed.panicked {
        let msgs: Vec<_> = parsed.diagnostics.iter().map(|d| d.to_string()).collect();
        return Err(msgs.join("; "));
    }
    let mut program = parsed.program;
    Ok(print_js_program(&allocator, &mut program, options))
}

fn source_mapping_url(options: &JsPrintOptions) -> Option<String> {
    let path = options.source_map_path.as_ref()?;
    let name = path.file_name()?.to_string_lossy();
    if name.ends_with(".map") {
        Some(name.into_owned())
    } else {
        Some(format!("{name}.map"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn minify_and_map_together() {
        let src = "export function keepMe(x) {\n  const unusedDead = 1;\n  const longName = 1 + 1;\n  return longName + x;\n}\n";
        let pretty = print_js_source(src, "keep.js", &JsPrintOptions::mapped("keep.js")).unwrap();
        let mini = print_js_source(src, "keep.js", &JsPrintOptions::release_mapped("keep.js")).unwrap();
        assert!(pretty.map.as_ref().is_some_and(|m| m.contains("\"mappings\"")), "{:?}", pretty.map);
        assert!(mini.map.as_ref().is_some_and(|m| m.contains("\"mappings\"")), "{:?}", mini.map);
        assert!(mini.code.contains("sourceMappingURL=keep.js.map"), "{}", mini.code);
        assert!(mini.code.len() < pretty.code.len(), "mini={} pretty={}", mini.code.len(), pretty.code.len());
        assert!(!mini.code.contains("unusedDead"), "{}", mini.code);
        assert!(mini.code.contains("keepMe"), "top-level export kept: {}", mini.code);
    }

    #[test]
    fn inner_binding_mangles_without_reserved_vmz() {
        let src = "export function wrap() {\n  function __vmzCreate(api) { return api; }\n  return __vmzCreate;\n}\n";
        let mini = print_js_source(src, "x.js", &JsPrintOptions { minify: true, source_map_path: None }).unwrap();
        assert!(!mini.code.contains("__vmzCreate"), "local binding should mangle: {}", mini.code);
        assert!(mini.code.contains("wrap"), "{}", mini.code);
    }

    #[test]
    fn property_key_vmz_create_stays() {
        let src = "export class Home {}\nHome.__vmzCreate = function __vmzCreate(api) { return api; };\n";
        let mini = print_js_source(src, "Home.js", &JsPrintOptions { minify: true, source_map_path: None }).unwrap();
        assert!(mini.code.contains("__vmzCreate"), "ABI property key stays: {}", mini.code);
    }
}
