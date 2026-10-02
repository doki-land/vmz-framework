mod cargo;
mod engine;
mod oak;
mod oxc;
mod walk;

use std::fs;
use std::path::{Path, PathBuf};

use oxc_formatter::JsFormatOptions;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// One formatted file outcome.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FormatFileResult {
    pub changed: bool,
    pub output: String,
}

/// Workspace format summary (JS/TS + optional `cargo fmt`).
#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFormatReport {
    /// Files rewritten on disk (zero in check mode).
    pub formatted: usize,
    /// Files already matching formatter output.
    pub unchanged: usize,
    /// Human-readable failures (`cargo fmt`, parse errors, check diffs).
    pub errors: Vec<String>,
}

/// Options for [`run_workspace_format`].
#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFormatOptions {
    /// Project root (default: cwd).
    pub cwd: Option<PathBuf>,
    /// Report would-change paths instead of writing.
    pub check: bool,
    /// Include globs under `cwd`.
    pub includes: Option<Vec<String>>,
    /// Exclude globs after includes expand.
    pub excludes: Option<Vec<String>>,
    /// Run `cargo fmt` when a Cargo workspace is present.
    pub rust: Option<bool>,
    /// Run Oak on JS/TS targets (legacy `oxc_formatter` only until Oak coverage closes).
    pub javascript: Option<bool>,
    /// Style config path relative to `cwd` (default: `biome.json`).
    pub style_config: Option<PathBuf>,
}

pub type Result<T> = std::result::Result<T, String>;

fn detect_hybrid_monorepo(root: &Path) -> bool {
    root.join("Cargo.toml").is_file() && root.join("package.json").is_file()
}

fn cargo_workspace_root(root: &Path) -> PathBuf {
    root.to_path_buf()
}

/// Format JS/TS via Oak (legacy `oxc_formatter` only until P4 removal) and Rust via `cargo fmt`.
pub fn run_workspace_format(options: WorkspaceFormatOptions) -> Result<WorkspaceFormatReport> {
    let cwd = options.cwd.clone().unwrap_or_else(|| std::env::current_dir().expect("current dir"));
    let hybrid = detect_hybrid_monorepo(&cwd);
    let mut report = WorkspaceFormatReport::default();

    let rust_enabled = options.rust.unwrap_or(hybrid);
    if rust_enabled && hybrid {
        cargo::apply_cargo_fmt(&mut report, &cargo_workspace_root(&cwd), options.check);
    }

    let javascript_enabled = options.javascript.unwrap_or(true);
    if javascript_enabled && (hybrid || walk::layout_has_js_targets(&cwd)) {
        let discover = walk::DiscoverOptions {
            includes: options.includes.clone(),
            excludes: options.excludes.clone(),
        };
        let format_options = oxc::load_format_options(&cwd, options.style_config.as_deref());
        for path in walk::discover_format_targets(&cwd, &discover)? {
            format_path(&path, options.check, &mut report, &format_options)?;
        }
    }

    Ok(report)
}

fn format_path(
    path: &Path,
    check: bool,
    report: &mut WorkspaceFormatReport,
    options: &JsFormatOptions,
) -> Result<()> {
    let source = fs::read_to_string(path).map_err(|err| format!("{}: {err}", path.display()))?;
    let result = engine::format_source_with_options(path, &source, options.clone())?;

    if !result.changed {
        report.unchanged += 1;
        return Ok(());
    }

    if check {
        report.errors.push(format!("{}: would be reformatted", path.display()));
        return Ok(());
    }

    fs::write(path, &result.output).map_err(|err| format!("{}: {err}", path.display()))?;
    report.formatted += 1;
    println!("formatted {}", path.display());
    Ok(())
}
