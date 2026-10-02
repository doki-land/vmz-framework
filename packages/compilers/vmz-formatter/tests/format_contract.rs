//! Shared Oak `format` contract through the VMZ workspace adapter.

use std::path::Path;

use vmz_formatter::{default_format_options, format_source_with_options};

fn format_sample(path: &str, input: &str) -> String {
    format_source_with_options(Path::new(path), input, default_format_options())
        .unwrap_or_else(|err| panic!("format failed: {err}"))
        .output
}

#[test]
fn preserves_leading_line_comment_and_normalizes_const() {
    let input = "// keep\nconst  x=1";
    let out = format_sample("sample.ts", input);
    assert_eq!(out, "// keep\nconst x = 1");
    let again = format_sample("sample.ts", &out);
    assert_eq!(out, again);
}

#[test]
fn rejects_unsupported_top_level_class() {
    assert!(
        format_source_with_options(Path::new("sample.ts"), "class Foo {}", default_format_options())
            .is_err()
    );
}

#[test]
fn preserves_trailing_comment_and_block_comment_in_statement() {
    let input = "const x = 1 /* mid */ // end";
    assert_eq!(format_sample("sample.ts", input), input);
}

#[test]
fn preserves_asi_sensitive_continuation_line() {
    let input = "const total = base\n+ extra";
    assert_eq!(format_sample("sample.ts", input), input);
}

#[test]
fn preserves_block_comment_between_statements() {
    let input = "const a = 1\n/* between */\nconst b = 2";
    assert_eq!(format_sample("sample.ts", input), "const a = 1\n/* between */\nconst b = 2");
}

#[test]
fn formats_scoped_import_without_comments() {
    let input = "import  {  foo }  from 'pkg'";
    assert_eq!(format_sample("sample.ts", input), "import { foo } from 'pkg';");
}

#[test]
fn rejects_unclosed_brace_without_rewrite() {
    let err = format_source_with_options(
        Path::new("sample.ts"),
        "const x = {",
        default_format_options(),
    )
    .unwrap_err();
    assert!(err.contains("diagnostics"), "err={err}");
}

#[test]
fn preserves_decorated_const_statement() {
    let input = "@Component()\nconst  x=1";
    assert_eq!(format_sample("sample.ts", input), input);
}

#[test]
fn ternary_string_literals_format_and_idempotent() {
    let input = r#"const v = error ? "true" : "false""#;
    let out = format_sample("sample.ts", input);
    assert_eq!(out, "const v = error ? 'true' : 'false'");
    assert_eq!(format_sample("sample.ts", &out), out);
}

#[test]
fn jsx_cases_format_and_idempotent() {
    let cases = [
        (
            r#"const el = <div className="foo">bar</div>"#,
            None::<&str>,
        ),
        ("const el = <br />", Some("const el = <br />")),
        ("const el = <>hello</>", Some("const el = <>hello</>")),
    ];
    for (input, expected) in cases {
        let out = format_sample("sample.tsx", input);
        if let Some(expected) = expected {
            assert_eq!(out, expected, "input={input:?}");
        } else {
            assert!(out.contains("<div className='foo'>bar</div>"), "out={out:?}");
        }
        assert_eq!(format_sample("sample.tsx", &out), out, "input={input:?}");
    }
}
