//! Transpile TypeScript script blocks through Oak type erasure.

use std::path::Path;

use oak_typescript::{FormatOptions, format_source};

use super::print::{EmittedJs, JsPrintOptions};

/// Transpile result with optional source map JSON.
pub type TranspileOutput = EmittedJs;

/// Transpile a TypeScript source string to JavaScript through Oak type erasure.
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
        &JsPrintOptions {
            minify: false,
            source_map_path: source_map_path.map(|p| p.to_path_buf()),
        },
    )
}

/// Erase TypeScript syntax through Oak and return an emitted module.
pub fn transpile_ts_printed(
    source: &str,
    filename: &str,
    print: &JsPrintOptions,
) -> Result<EmittedJs, String> {
    if print.minify {
        return Err("Oak TypeScript erasure does not provide minification yet".into());
    }
    if print.source_map_path.is_some() {
        return Err("Oak TypeScript erasure does not provide source maps yet".into());
    }
    let _ = filename;
    let code = format_source(source, &FormatOptions::default().with_type_erasure(true))
        .map_err(|error| error.to_string())?;
    Ok(EmittedJs { code, map: None })
}

#[cfg(test)]
mod tests {
    use super::transpile_ts;

    #[test]
    fn keeps_value_imports_used_by_later_template_lowering() {
        let source = "import { highlightSync } from 'highlighter';\nimport type { Theme } from 'types';\nexport default class Example { theme: Theme | null = null; }";
        let js = transpile_ts(source, "Example.client.ts").expect("transpile");
        assert!(js.contains("highlightSync"), "value import lost: {js}");
        assert!(
            !js.contains("from 'types'") && !js.contains("from \"types\""),
            "type import leaked: {js}"
        );
    }
}
