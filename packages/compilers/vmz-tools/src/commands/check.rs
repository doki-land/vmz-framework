use clap::Args as ClapArgs;
use vmz_compiler::{Result, bail};
use vmz_inspector::{InspectOptions, InspectProfile, failed, inspect_path};

use crate::cli::PathArgs;
use crate::diagnostic_fmt::eprint_diagnostics;

/// Arguments for `vmz check`.
#[derive(Debug, ClapArgs)]
pub struct Args {
    /// Files or project roots to validate.
    #[command(flatten)]
    pub paths: PathArgs,
}

/// Run hard inspect (check profile) on each path; fail if any report fails.
pub fn run(args: Args) -> Result<()> {
    let mut failed_any = false;
    let options = InspectOptions { profile: InspectProfile::Check, deny_warnings: false };

    for path in &args.paths.paths {
        let report = inspect_path(path, &options)?;
        println!("vmz check: {} ({} file(s))", path.display(), report.files_checked);
        eprint_diagnostics(&report.diagnostics);
        if failed(&report, &options) {
            failed_any = true;
        }
    }

    if failed_any {
        bail!("check failed");
    }
    Ok(())
}
