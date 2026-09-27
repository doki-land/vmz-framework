use std::path::Path;
use std::process::Command;

use super::WorkspaceFormatReport;

pub fn run_cargo_fmt(root: &Path, check: bool) -> Result<(), String> {
    let mut command = Command::new("cargo");
    command.arg("fmt").arg("--all").current_dir(root);
    if check {
        command.arg("--").arg("--check");
    }

    let output = command.output().map_err(|err| format!("failed to run cargo fmt: {err}"))?;
    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    Err(format!("cargo fmt failed:\n{stdout}{stderr}"))
}

pub fn apply_cargo_fmt(report: &mut WorkspaceFormatReport, root: &Path, check: bool) {
    match run_cargo_fmt(root, check) {
        Ok(()) => {
            println!("cargo: workspace at {} is formatted", root.display());
        }
        Err(message) => {
            report.errors.push(message);
        }
    }
}
