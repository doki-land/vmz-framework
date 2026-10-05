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
fn formats_top_level_class_without_ast_fallback() {
    assert_eq!(format_sample("sample.ts", "class Foo{}"), "class Foo {}");
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
    assert_eq!(format_sample("sample.ts", input), "import { foo } from 'pkg'");
}

#[test]
fn keeps_typescript_generic_and_return_type_spacing() {
    let input = "async function load(value: Record<string, unknown>): Promise<Array<number>> { return new Set<string>(); } const defaults: Record<string, string> = {};";
    let output = format_sample("sample.ts", input);
    assert_eq!(output, input);
    assert_eq!(format_sample("sample.ts", &output), output);
}

#[test]
fn preserves_authoring_boundaries_and_operator_tokens() {
    for input in [
        "#!/usr/bin/env node\nconst value = 1;",
        "const task = async (value) => value;",
        "for (const [key, value] of entries) { consume(key, value); }",
        "type Rows = Array<{ id: string }>;",
        "function fetchRows(): Promise<Row[]> { return load(); }",
        "const suffix = value.slice(0, -suffix.length);",
        "const value = ready\n    ? load()\n    : fallback;",
    ] {
        let output = format_sample("sample.ts", input);
        assert_eq!(format_sample("sample.ts", &output), output, "input={input:?}");
        assert!(output.contains("const") || output.contains("function") || output.contains("type") || output.contains("for"));
    }
}

#[test]
fn separates_function_bodies_and_nullish_assignments() {
    let input = "export async function commit(options: Options): Promise<number>{ await run(options); return 0; } if (ready)return value; options.token??= fallback;";
    let output = format_sample("sample.ts", input);
    assert!(output.contains("Promise<number> {"), "output={output:?}");
    assert!(output.contains("if (ready) return value;"), "output={output:?}");
    assert!(output.contains("token ??= fallback"), "output={output:?}");
}

#[test]
fn rejects_unclosed_brace_without_rewrite() {
    let err =
        format_source_with_options(Path::new("sample.ts"), "const x = {", default_format_options())
            .unwrap_err();
    assert!(err.contains("unbalanced delimiters"), "err={err}");
}

#[test]
fn preserves_decorated_const_statement() {
    let input = "@Component()\nconst  x=1";
    assert_eq!(format_sample("sample.ts", input), "@Component()\nconst x = 1");
}

#[test]
fn ternary_string_literals_format_and_idempotent() {
    let input = r#"const v = error ? "true" : "false""#;
    let out = format_sample("sample.ts", input);
    assert_eq!(out, input);
    assert_eq!(format_sample("sample.ts", &out), out);
}

#[test]
fn jsx_cases_format_and_idempotent() {
    let cases = [
        (r#"const el = <div className="foo">bar</div>"#, None::<&str>),
        ("const el = <br />", Some("const el = <br />")),
        ("const el = <>hello</>", Some("const el = <>hello</>")),
    ];
    for (input, expected) in cases {
        let out = format_sample("sample.tsx", input);
        if let Some(expected) = expected {
            assert_eq!(out, expected, "input={input:?}");
        } else {
            assert!(out.contains("<div className=\"foo\">bar</div>"), "out={out:?}");
        }
        assert_eq!(format_sample("sample.tsx", &out), out, "input={input:?}");
    }
}
