//! Format `.vmz` via oxc codegen (script blocks) + SFC reassemble.

use clap::Args as ClapArgs;
use vmz_compiler::{FormatOptions, Result, bail, format_path};

use crate::cli::PathArgs;

#[derive(Debug, ClapArgs)]
pub struct Args {
    #[command(flatten)]
    pub paths: PathArgs,

    /// Check formatting without writing changes
    #[arg(long)]
    pub check: bool,
}

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
