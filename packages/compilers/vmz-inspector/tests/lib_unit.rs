//! Moved from `src/lib.rs` (cargo-cry: tests next to Cargo.toml).

use std::path::{Path, PathBuf};

use std::fs;
use vmz_compiler::Severity;
use vmz_inspector::*;

fn tmp_project(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "vmz-inspector-{name}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("src/layouts")).unwrap();
    fs::create_dir_all(dir.join("src/pages")).unwrap();
    fs::create_dir_all(dir.join("src/components")).unwrap();
    dir
}

fn write_vmz(path: &Path, class: &str) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(
        path,
        format!(
            "<template>\n  <div />\n</template>\n\n<script client>\nexport default class {class} {{}}\n</script>\n"
        ),
    )
    .unwrap();
}

#[test]
fn lint_warns_layout_without_suffix() {
    let root = tmp_project("layout-suffix");
    write_vmz(&root.join("src/Application.vmz"), "Application");
    write_vmz(&root.join("src/layouts/Account.vmz"), "Account");
    write_vmz(&root.join("src/pages/Index.vmz"), "IndexPage");

    let report = inspect_path(
        &root,
        &InspectOptions { profile: InspectProfile::Lint, deny_warnings: false },
    )
    .unwrap();

    assert!(
        report.diagnostics.iter().any(|d| {
            d.severity() == Severity::Warning
                && d.code() == "vmz::convention::layout_suffix"
                && d.path().ends_with("Account.vmz")
        }),
        "{:?}",
        report.diagnostics.iter().map(|d| d.code()).collect::<Vec<_>>()
    );
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn check_skips_layout_suffix_lint() {
    let root = tmp_project("check-no-lint");
    write_vmz(&root.join("src/Application.vmz"), "Application");
    write_vmz(&root.join("src/layouts/Account.vmz"), "Account");
    write_vmz(&root.join("src/pages/Index.vmz"), "IndexPage");

    let report = inspect_path(
        &root,
        &InspectOptions { profile: InspectProfile::Check, deny_warnings: false },
    )
    .unwrap();

    assert!(
        !report.diagnostics.iter().any(|d| d.code() == "vmz::convention::layout_suffix"),
        "{:?}",
        report.diagnostics.iter().map(|d| d.code()).collect::<Vec<_>>()
    );
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn lint_accepts_account_layout() {
    let root = tmp_project("layout-ok");
    write_vmz(&root.join("src/Application.vmz"), "Application");
    write_vmz(&root.join("src/layouts/AccountLayout.vmz"), "AccountLayout");
    write_vmz(&root.join("src/pages/Index.vmz"), "IndexPage");

    let report = inspect_path(
        &root,
        &InspectOptions { profile: InspectProfile::Lint, deny_warnings: false },
    )
    .unwrap();

    assert!(
        !report.diagnostics.iter().any(|d| d.code() == "vmz::convention::layout_suffix"),
        "{:?}",
        report.diagnostics.iter().map(|d| d.code()).collect::<Vec<_>>()
    );
    let _ = fs::remove_dir_all(&root);
}
