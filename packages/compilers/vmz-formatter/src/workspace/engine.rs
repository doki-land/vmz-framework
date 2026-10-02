use std::path::Path;

use oxc_formatter::JsFormatOptions;

use super::{FormatFileResult, oak, oxc};

/// Format JS/TS via Oak. `oxc_formatter` below is legacy debt for uncovered inputs and must shrink to zero.
pub fn format_source_with_options(
    path: &Path,
    source: &str,
    options: JsFormatOptions,
) -> Result<FormatFileResult, String> {
    if let Ok(output) = oak::format_source(path, source) {
        return Ok(FormatFileResult {
            changed: output != source,
            output,
        });
    }
    // TODO(P4): remove once Oak print covers this input (remaining gaps: class, trivia, etc.).
    oxc::format_source_with_options(path, source, options)
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
    fn cst_format_preserves_leading_line_comment() {
        let result = format_source_with_options(
            Path::new("sample.ts"),
            "// keep\nconst  x=1",
            oxc::default_format_options(),
        )
        .expect("format");
        assert_eq!(result.output, "// keep\nconst x = 1");
    }

    #[test]
    fn oak_formats_jsx_via_print_path() {
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
