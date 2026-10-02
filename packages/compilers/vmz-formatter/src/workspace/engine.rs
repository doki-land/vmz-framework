use std::path::Path;

use oxc_formatter::JsFormatOptions;

use oak_typescript::formatter::FormatOptions;

use super::{FormatFileResult, oak, oxc};

fn should_stop_at_oak(err: &str) -> bool {
    err.contains("diagnostics")
        || err.contains("parse failed")
        || err.contains("unsupported")
        || err.contains("overlapping CST spans")
}

/// Format JS/TS via Oak. `oxc_formatter` below is legacy debt for uncovered inputs and must shrink to zero.
pub fn format_source_with_options(
    path: &Path,
    source: &str,
    options: JsFormatOptions,
) -> Result<FormatFileResult, String> {
    let format_options = format_options_from_js(&options);
    match oak::format_source(path, source, &format_options) {
        Ok(output) => Ok(FormatFileResult {
            changed: output != source,
            output,
        }),
        Err(err) if should_stop_at_oak(&err) => Err(err),
        Err(_) => {
            // TODO(P4): remove once Oak `format` covers this input (remaining gaps: quote style, etc.).
            oxc::format_source_with_options(path, source, options)
        }
    }
}

fn format_options_from_js(options: &oxc_formatter::JsFormatOptions) -> FormatOptions {
    FormatOptions {
        indent_width: options.indent_width.value(),
        line_width: usize::from(options.line_width.value()),
    }
}
