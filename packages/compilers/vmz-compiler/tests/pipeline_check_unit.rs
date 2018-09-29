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
