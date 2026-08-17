//! Format path entry: discover `.vmz`, format, write or `--check`.

use std::fs;
use std::path::Path;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use vmz_compiler::{ReportedDiagnostic, discover_vmz_files, parse_vmz};

use crate::assemble::assemble_vmz;
use crate::editorconfig::{EditorSettings, resolve_for_path};
use crate::script::format_script_block;
use crate::style::format_style_block;

/// Options for [`format_path`].
#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FormatOptions {
    /// When true, report files that would change instead of writing them.
    pub check: bool,
}

/// Aggregated result of formatting one file or a project tree.
#[derive(Debug, Default)]
pub struct FormatReport {
    /// Parse / format / check diagnostics collected during the run.
    pub diagnostics: Vec<ReportedDiagnostic>,
    /// Number of `.vmz` files visited.
    pub files_checked: usize,
    /// Number of files rewritten on disk (zero when `check` is set).
    pub files_written: usize,
    /// Number of files whose formatted text differs from the input.
    pub files_need_write: usize,
}

impl FormatReport {
    /// True when any diagnostic is error severity.
    pub fn has_errors(&self) -> bool {
        self.diagnostics.iter().any(|d| d.is_error())
    }
}

/// Format a single `.vmz` file or every `.vmz` under a directory.
pub fn format_path(path: impl AsRef<Path>, options: &FormatOptions) -> vmz_compiler::Result<FormatReport> {
    let path = path.as_ref();
    let mut report = FormatReport::default();
    if path.is_file() {
        format_file(path, options, &mut report)?;
        return Ok(report);
    }
    for (file, _) in discover_vmz_files(path) {
        format_file(&file, options, &mut report)?;
    }
    Ok(report)
}

fn format_file(
    path: &Path,
    options: &FormatOptions,
    report: &mut FormatReport,
) -> vmz_compiler::Result<()> {
    report.files_checked += 1;
    let source = match fs::read_to_string(path) {
        Ok(s) => s,
        Err(e) => {
            report.diagnostics.push(ReportedDiagnostic::error(path, format!("read failed: {e}")));
            return Ok(());
        }
    };
    let settings = resolve_for_path(path);
    let parsed = match parse_vmz(path, source.clone()) {
        Ok(p) => p,
        Err(e) => {
            report.diagnostics.push(ReportedDiagnostic::error(path, e.to_string()));
            return Ok(());
        }
    };

    let formatted = match format_parsed(&parsed, &settings) {
        Ok(s) => s,
        Err(e) => {
            report.diagnostics.push(ReportedDiagnostic::error(path, e));
            return Ok(());
        }
    };

    if formatted == source {
        return Ok(());
    }
    report.files_need_write += 1;
    if options.check {
        report
            .diagnostics
            .push(ReportedDiagnostic::error(path, "would reformat (run without --check)"));
        return Ok(());
    }
    fs::write(path, formatted)?;
    report.files_written += 1;
    Ok(())
}

fn format_parsed(
    parsed: &vmz_compiler::ParsedVmz,
    settings: &EditorSettings,
) -> Result<String, String> {
    let client = format_script_block(&parsed.client, settings)?;
    let server = if let Some(server) = &parsed.server {
        Some(format_script_block(server, settings)?)
    } else {
        None
    };
    let style = if let Some(style) = &parsed.style {
        Some(format_style_block(style, settings)?)
    } else {
        None
    };
    Ok(assemble_vmz(parsed, &client, server.as_deref(), style.as_deref(), settings))
}
