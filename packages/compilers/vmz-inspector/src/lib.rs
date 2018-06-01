//! VMZ inspector: check (hard conventions / semantics) and lint (soft advice)
//! share one diagnostic pipeline.
//!
//! Crate name aligns with vmz-compiler as vmz-inspector; CLI surface remains
//! vmz check / vmz lint.

#![warn(missing_docs)]
mod convention;

use std::path::Path;

use vmz_compiler::{CheckOptions, CheckReport, check_path};

pub use convention::{BOUNDARY_ROLE_FILES, layout_suffix_stem};

/// Inspect entry profile: CLI check / lint.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InspectProfile {
    /// Hard errors + existing semantic check; no soft convention lints.
    Check,
    /// Check plus convention advice (Warning); --deny-warnings may fail.
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
) -> vmz_compiler::Result<InspectReport> {
    let path = path.as_ref();
    let check_opts = CheckOptions {
        deny_warnings: options.deny_warnings,
        require_browser_safe_server_slices: false,
    };
    let mut report = check_path(path, &check_opts)?;

    if options.profile == InspectProfile::Lint {
        append_convention_lints(path, &mut report);
    }

    Ok(report)
}

/// Append soft convention diagnostics to an existing check report (N-API Workspace reuse).
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
) -> vmz_compiler::Result<InspectReport> {
    inspect_path(root, options)
}

pub fn failed(report: &InspectReport, options: &InspectOptions) -> bool {
    report.failed(&CheckOptions {
        deny_warnings: options.deny_warnings,
        require_browser_safe_server_slices: false,
    })
}
