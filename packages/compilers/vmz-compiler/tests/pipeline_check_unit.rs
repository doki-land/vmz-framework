//! Moved from `src/pipeline/check.rs` (cargo-cry: tests next to Cargo.toml).

use std::fs;

use vmz_compiler::Severity;
use vmz_compiler::pipeline::check::{CheckOptions, CheckReport, check_path};

fn check_template_snippet(template: &str) -> CheckReport {
    let dir = std::env::temp_dir().join(format!(
        "vmz-check-each-{}-{}",
        std::process::id(),
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    ));
    let _ = fs::create_dir_all(&dir);
    let path = dir.join("T.vmz");
    let src = format!(
        "<template>\n{template}\n</template>\n\n<script client>\nexport default class T {{}}\n</script>\n"
    );
    fs::write(&path, &src).unwrap();
    let report = check_path(&path, &CheckOptions::default()).unwrap();
    let _ = fs::remove_dir_all(&dir);
    report
}

#[test]
fn warns_each_without_key() {
    let report = check_template_snippet(r#"<li v-for="tag in tags">{{ tag }}</li>"#);
    assert!(
        report
            .diagnostics
            .iter()
            .any(|d| d.severity() == Severity::Warning && d.message().contains("no `key`")),
        "{:?}",
        report.diagnostics
    );
}

#[test]
fn errors_constant_key() {
    let report = check_template_snippet(r#"<li v-for="tag in tags" :key="'x'">{{ tag }}</li>"#);
    assert!(
        report
            .diagnostics
            .iter()
            .any(|d| d.severity() == Severity::Error && d.message().contains("constant")),
        "{:?}",
        report.diagnostics
    );
}

#[test]
fn ok_property_key() {
    let report =
        check_template_snippet(r#"<li v-for="tag in tags" :key="tag.id">{{ tag.label }}</li>"#);
    assert!(
        !report.diagnostics.iter().any(|d| d.message().contains("each")),
        "{:?}",
        report.diagnostics
    );
}

#[test]
fn template_parse_error_carries_absolute_source_span() {
    let dir = std::env::temp_dir().join(format!(
        "vmz-check-jsx-span-{}-{}",
        std::process::id(),
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    ));
    let _ = fs::create_dir_all(&dir);
    let path = dir.join("Bad.vmz");
    // `<template>\n` is 11 UTF-8 bytes; JSX `{` sits in the body.
    let src = "<template>\n<h2>{user.name}</h2>\n</template>\n\n<script client>\nexport default class Bad {}\n</script>\n";
    fs::write(&path, src).unwrap();
    let report = check_path(&path, &CheckOptions::default()).unwrap();
    let diag = report
        .diagnostics
        .iter()
        .find(|d| d.message().contains("template:"))
        .expect("template diagnostic");
    let span = diag.source_span().expect("SourceSpan on template diagnostic");
    assert!(span.start >= 11, "expected absolute offset past `<template>\\n`, got {}", span.start);
    assert!(span.end > span.start, "end-exclusive span");
    assert!(!diag.message().contains("(offset"), "offset must not be message-only");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn invalid_template_expression_fails_oxc_ingress() {
    let report = check_template_snippet(r#"<p>{{ 1 + }}</p>"#);
    let diag = report
        .diagnostics
        .iter()
        .find(|d| d.is_error() && d.message().contains("invalid template expression"))
        .unwrap_or_else(|| panic!("missing invalid-expr diagnostic: {:?}", report.diagnostics));
    assert_eq!(diag.code_string().as_deref(), Some("vmz::template/invalid-expr"));
    let span = diag.source_span().expect("invalid-expr must carry SourceSpan");
    assert!(span.end > span.start, "span={span:?}");
    // Snippet is `<template>\n<p>{{ 1 + }}</p>\n</template>…` — mustache body is past content_start.
    assert!(span.start > 0, "absolute span must not be template-body-local 0");
}

#[test]
fn check_consumes_same_semantic_ast_stats_as_tooling() {
    use vmz_compiler::{parse_template_asts, semantic_ast_stats};

    let template = r#"
<p v-if="a">A</p>
<p v-else-if="b">B</p>
<p v-else>C</p>
<li v-for="x in xs" :key="x">{{ x }}</li>
"#;
    let report = check_template_snippet(template);
    let (semantic, _) = parse_template_asts(template).unwrap();
    let tooling = semantic_ast_stats(&semantic);
    assert_eq!(report.semantic_stats, tooling);
    assert_eq!(tooling.if_chains, 1);
    assert_eq!(tooling.if_branches, 3);
    assert_eq!(tooling.for_nodes, 1);
}
