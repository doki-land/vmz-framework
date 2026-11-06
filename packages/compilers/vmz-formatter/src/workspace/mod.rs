mod engine;
mod oak;
mod rustfmt;
mod style;
mod walk;

pub use engine::format_source_with_options;
pub use style::default_format_options;

use std::fs;
use std::path::{Path, PathBuf};

use vmz_compiler::ReportedDiagnostic;

/// One formatted file outcome.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FormatFileResult {
    pub changed: bool,
    pub output: String,
}

/// JS/TS extensions routed to the Oak formatter.
const JS_TS_EXTENSIONS: &[&str] = &["ts", "mts", "cts", "js", "mjs", "cjs", "jsx", "tsx"];

/// Options for [`run_target_format`].
///
/// Scope contract: only the explicit `targets` are formatted. Directory
/// targets are walked locally (skipping `node_modules` / `target` / …) and
/// nothing outside the given paths is ever touched — in particular Rust
/// formatting runs per-file `rustfmt` with `skip_children=true`, never
/// `cargo fmt --all`.
#[derive(Debug, Clone, Default)]
pub struct TargetFormatOptions {
    /// Explicit files or directories to format. At least one is required.
    pub targets: Vec<PathBuf>,
    /// Report would-change files instead of writing.
    pub check: bool,
    /// Rust opt-in: `Some(true)` also formats `.rs` under directory targets,
    /// `Some(false)` rejects `.rs` targets. A `.rs` file passed directly is
    /// always an explicit opt-in.
    pub rust: Option<bool>,
    /// Run the Oak formatter on JS/TS targets (default on).
    pub javascript: Option<bool>,
    /// Run the `.vmz` authoring formatter (default on).
    pub vmz: Option<bool>,
    /// Exclude globs applied under directory targets (relative to each target).
    pub excludes: Option<Vec<String>>,
    /// Style config path for JS/TS (default: `biome.json` next to the target).
    pub style_config: Option<PathBuf>,
}

/// Aggregated report for [`run_target_format`].
#[derive(Debug, Clone, Default)]
pub struct TargetFormatReport {
    /// Files rewritten on disk (zero in check mode).
    pub formatted: usize,
    /// Files already matching formatter output.
    pub unchanged: usize,
    /// Files that would change under `check`.
    pub need_write: usize,
    /// Human-readable failures (including out-of-scope / unsupported targets).
    pub errors: Vec<String>,
    /// `.vmz` formatter diagnostics.
    pub diagnostics: Vec<ReportedDiagnostic>,
}

pub type Result<T> = std::result::Result<T, String>;

/// Format exactly the explicit targets — never an implicit workspace.
///
/// Hard misuse (no targets, missing paths, unreadable style config) is an
/// `Err`; per-file failures and rejected targets land in
/// [`TargetFormatReport::errors`].
pub fn run_target_format(options: &TargetFormatOptions) -> Result<TargetFormatReport> {
    if options.targets.is_empty() {
        return Err("format: no explicit target — pass at least one file or directory".to_string());
    }
    for target in &options.targets {
        if !target.exists() {
            return Err(format!("format: target does not exist: {}", target.display()));
        }
    }

    let mut report = TargetFormatReport::default();
    for target in &options.targets {
        if target.is_dir() {
            format_dir_target(target, options, &mut report)?;
        } else {
            format_file_target(target, options, &mut report)?;
        }
    }
    Ok(report)
}

fn format_file_target(
    target: &Path,
    options: &TargetFormatOptions,
    report: &mut TargetFormatReport,
) -> Result<()> {
    let ext = target.extension().and_then(|ext| ext.to_str()).unwrap_or("");
    if ext == "rs" {
        if options.rust == Some(false) {
            report.errors.push(format!(
                "{}: `.rs` target rejected — Rust formatting disabled by override",
                target.display()
            ));
            return Ok(());
        }
        return format_rust_file(target, options.check, report);
    }
    if JS_TS_EXTENSIONS.contains(&ext) {
        if options.javascript == Some(false) {
            report.errors.push(format!(
                "{}: JS/TS target rejected — JavaScript formatting disabled by override",
                target.display()
            ));
            return Ok(());
        }
        let format_options = style::load_format_options(
            target.parent().unwrap_or_else(|| Path::new(".")),
            options.style_config.as_deref(),
        )?;
        return format_js_file(target, options.check, report, &format_options);
    }
    if ext == "vmz" {
        if options.vmz == Some(false) {
            report.errors.push(format!(
                "{}: `.vmz` target rejected — VMZ formatting disabled by override",
                target.display()
            ));
            return Ok(());
        }
        format_vmz_target(target, options.check, report)?;
        return Ok(());
    }
    report.errors.push(format!(
        "{}: unsupported format target (expected `.vmz`, `.rs`, or JS/TS)",
        target.display()
    ));
    Ok(())
}

fn format_dir_target(
    dir: &Path,
    options: &TargetFormatOptions,
    report: &mut TargetFormatReport,
) -> Result<()> {
    let excludes = options.excludes.clone().unwrap_or_default();
    let mut matched = 0usize;

    if options.javascript.unwrap_or(true) {
        let paths = walk::discover_js_targets_under(dir, &excludes)?;
        matched += paths.len();
        if !paths.is_empty() {
            let format_options = style::load_format_options(dir, options.style_config.as_deref())?;
            for path in &paths {
                format_js_file(path, options.check, report, &format_options)?;
            }
        }
    }
    if options.vmz.unwrap_or(true) {
        matched += format_vmz_target(dir, options.check, report)?;
    }
    if options.rust == Some(true) {
        let paths = walk::discover_rust_targets_under(dir, &excludes)?;
        matched += paths.len();
        for path in &paths {
            format_rust_file(path, options.check, report)?;
        }
    }

    if matched == 0 {
        report.errors.push(format!(
            "{}: no formattable targets under directory (JS/TS, `.vmz`, or `.rs` with `rust` enabled)",
            dir.display()
        ));
    }
    Ok(())
}

fn format_js_file(
    path: &Path,
    check: bool,
    report: &mut TargetFormatReport,
    options: &oak_typescript::formatter::FormatOptions,
) -> Result<()> {
    let source = fs::read_to_string(path).map_err(|err| format!("{}: {err}", path.display()))?;
    let result = match engine::format_source_with_options(path, &source, options.clone()) {
        Ok(result) => result,
        Err(err) => {
            report.errors.push(format!("{}: {err}", path.display()));
            return Ok(());
        }
    };

    if !result.changed {
        report.unchanged += 1;
        return Ok(());
    }
    if check {
        report.need_write += 1;
        report.diagnostics.push(ReportedDiagnostic::error(path, "vmz::format::would_reformat"));
        return Ok(());
    }
    fs::write(path, &result.output).map_err(|err| format!("{}: {err}", path.display()))?;
    report.formatted += 1;
    Ok(())
}

fn format_rust_file(path: &Path, check: bool, report: &mut TargetFormatReport) -> Result<()> {
    match rustfmt::run_rustfmt_file(path, check) {
        Ok(rustfmt::RustfmtOutcome::Unchanged) => report.unchanged += 1,
        Ok(rustfmt::RustfmtOutcome::Changed) => {
            if check {
                report.need_write += 1;
                report
                    .diagnostics
                    .push(ReportedDiagnostic::error(path, "vmz::format::would_reformat"));
            } else {
                report.formatted += 1;
            }
        }
        Err(message) => report.errors.push(message),
    }
    Ok(())
}

/// Returns the number of `.vmz` files examined.
fn format_vmz_target(path: &Path, check: bool, report: &mut TargetFormatReport) -> Result<usize> {
    let vmz_report = crate::format_path(path, &crate::FormatOptions { check })
        .map_err(|err| format!("{}: {err}", path.display()))?;
    // `files_need_write` counts changed files in both modes; `files_written`
    // only in write mode.
    if check {
        report.need_write += vmz_report.files_need_write;
    } else {
        report.formatted += vmz_report.files_written;
    }
    report.unchanged += vmz_report.files_checked - vmz_report.files_need_write;
    report.diagnostics.extend(vmz_report.diagnostics);
    Ok(vmz_report.files_checked)
}
