//! VMZ inspector：`check`（硬约定 / 语义）与 `lint`（软约定 advice）共用同一诊断管线。
//!
//! 包名与 `vmz-compiler` 对齐为 `vmz-inspector`；CLI 表面仍是 `vmz check` / `vmz lint`。

mod convention;

use std::path::Path;

use vmz_compiler::{CheckOptions, CheckReport, check_path};

pub use convention::{BOUNDARY_ROLE_FILES, layout_suffix_stem};

/// Inspect 入口剖面：对应 CLI `check` / `lint`。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InspectProfile {
    /// 硬错误 + 既有语义 check；不含软约定 lint。
    Check,
    /// 在 check 基础上追加约定建议（Warning）；`--deny-warnings` 可失败。
    Lint,
}

#[derive(Debug, Clone)]
pub struct InspectOptions {
    pub profile: InspectProfile,
    pub deny_warnings: bool,
}

impl Default for InspectOptions {
    fn default() -> Self {
        Self { profile: InspectProfile::Check, deny_warnings: false }
    }
}

pub type InspectReport = CheckReport;

pub fn inspect_path(
    path: impl AsRef<Path>,
    options: &InspectOptions,
) -> anyhow::Result<InspectReport> {
    let path = path.as_ref();
    let check_opts = CheckOptions { deny_warnings: options.deny_warnings };
    let mut report = check_path(path, &check_opts)?;

    if options.profile == InspectProfile::Lint {
        append_convention_lints(path, &mut report);
    }

    Ok(report)
}

/// Append soft convention diagnostics to an existing check report（供 N-API Workspace 复用）.
pub fn append_convention_lints(path: impl AsRef<Path>, report: &mut CheckReport) {
    let path = path.as_ref();
    if path.is_file() {
        convention::lint_file(path, report);
    } else {
        convention::lint_project(path, report);
    }
}

pub fn inspect_project(
    root: impl AsRef<Path>,
    options: &InspectOptions,
) -> anyhow::Result<InspectReport> {
    inspect_path(root, options)
}

pub fn failed(report: &InspectReport, options: &InspectOptions) -> bool {
    report.failed(&CheckOptions { deny_warnings: options.deny_warnings })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use vmz_compiler::Severity;

    fn tmp_project(name: &str) -> std::path::PathBuf {
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
                    && d.message().contains("*Layout")
                    && d.path().ends_with("Account.vmz")
            }),
            "{:?}",
            report.diagnostics
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
            !report.diagnostics.iter().any(|d| d.message().contains("*Layout")),
            "{:?}",
            report.diagnostics
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
            !report.diagnostics.iter().any(|d| d.message().contains("*Layout")),
            "{:?}",
            report.diagnostics
        );
        let _ = fs::remove_dir_all(&root);
    }
}
