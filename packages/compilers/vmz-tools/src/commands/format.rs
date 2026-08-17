//! Format `.vmz` via `vmz-formatter` (oxc IR formatter + EditorConfig).

use clap::Args as ClapArgs;
use vmz_compiler::{Result, bail};
use vmz_formatter::{FormatOptions, format_path};

use crate::cli::PathArgs;

/// Arguments for `vmz format`.
#[derive(Debug, ClapArgs)]
pub struct Args {
    /// Files or project roots to format.
    #[command(flatten)]
    pub paths: PathArgs,

    /// Check formatting without writing (like `cargo fmt --check`)
    #[arg(long)]
    pub check: bool,
}

/// Format (or `--check`) each path via `vmz-formatter`.
pub fn run(args: Args) -> Result<()> {
    let options = FormatOptions { check: args.check };
    for path in &args.paths.paths {
        let report = format_path(path, &options)?;
        if args.check {
            println!(
                "vmz format --check: {} ({} file(s), {} need write)",
                path.display(),
                report.files_checked,
                report.files_need_write
            );
        } else {
            println!(
                "vmz format: {} ({} file(s), {} written)",
                path.display(),
                report.files_checked,
                report.files_written
            );
        }
        for d in &report.diagnostics {
            eprintln!("{d}");
        }
        if report.has_errors() {
            bail!("format failed");
        }
    }
    Ok(())
}
