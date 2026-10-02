use std::path::Path;

use oxc_formatter::JsFormatOptions;

use oak_typescript::FormatOptions;

use super::{FormatFileResult, oak, oxc};

/// Format JS/TS via Oak. `oxc_formatter` below is legacy debt for uncovered inputs and must shrink to zero.
pub fn format_source_with_options(
    path: &Path,
    source: &str,
    options: JsFormatOptions,
) -> Result<FormatFileResult, String> {
    let format_options = format_options_from_js(&options);
    if let Ok(output) = oak::format_source(path, source, &format_options) {
        return Ok(FormatFileResult {
            changed: output != source,
            output,
        });
    }
    // TODO(P4): remove once Oak `format` covers this input (remaining gaps: class, quote style, etc.).
    oxc::format_source_with_options(path, source, options)
}

fn format_options_from_js(options: &oxc_formatter::JsFormatOptions) -> FormatOptions {
    FormatOptions {
        indent_width: options.indent_width.value(),
        line_width: usize::from(options.line_width.value()),
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;

    #[test]
    fn oak_formats_typescript_source() {
        let result = format_source_with_options(
            Path::new("sample.ts"),
            "const  x=1",
            oxc::default_format_options(),
        )
        .expect("format");
        assert!(result.changed);
        assert!(result.output.contains("const x = 1"), "{}", result.output);
    }

    #[test]
    fn format_preserves_leading_line_comment() {
        let result = format_source_with_options(
            Path::new("sample.ts"),
            "// keep\nconst  x=1",
            oxc::default_format_options(),
        )
        .expect("format");
        assert_eq!(result.output, "// keep\nconst x = 1");
    }

    #[test]
    fn format_preserves_trailing_comment_in_statement() {
        let input = "const x = 1 // keep";
        let result = format_source_with_options(
            Path::new("sample.ts"),
            input,
            oxc::default_format_options(),
        )
        .expect("format");
        assert_eq!(result.output, input);
    }

    #[test]
    fn format_preserves_asi_sensitive_continuation() {
        let input = "const total = base\n+ extra";
        let result = format_source_with_options(
            Path::new("sample.ts"),
            input,
            oxc::default_format_options(),
        )
        .expect("format");
        assert_eq!(result.output, input);
    }

    #[test]
    fn format_preserves_decorated_const_statement() {
        let input = "@Component()\nconst  x=1";
        let result = format_source_with_options(
            Path::new("sample.ts"),
            input,
            oxc::default_format_options(),
        )
        .expect("format");
        assert_eq!(result.output, input);
    }

    #[test]
    fn oak_formats_jsx_via_format_api() {
        let result = format_source_with_options(
            Path::new("sample.tsx"),
            r#"const el = <div className="foo">bar</div>"#,
            oxc::default_format_options(),
        )
        .expect("format");
        assert!(
            result.output.contains("<div className='foo'>bar</div>"),
            "{}",
            result.output
        );
    }

    #[test]
    fn oak_format_is_idempotent_for_simple_ts() {
        let once = format_source_with_options(
            Path::new("sample.ts"),
            "const x = 1\n",
            oxc::default_format_options(),
        )
        .expect("once");
        let twice = format_source_with_options(
            Path::new("sample.ts"),
            &once.output,
            oxc::default_format_options(),
        )
        .expect("twice");
        assert_eq!(once.output, twice.output);
    }
}
