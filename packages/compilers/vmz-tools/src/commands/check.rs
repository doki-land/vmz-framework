use anyhow::{Result, bail};
use clap::Args as ClapArgs;
use vmz_inspector::{InspectOptions, InspectProfile, failed, inspect_path};

use crate::cli::PathArgs;

#[derive(Debug, ClapArgs)]
pub struct Args {
    #[command(flatten)]
    pub paths: PathArgs,
}

pub fn run(args: Args) -> Result<()> {
    let mut failed_any = false;
    let options = InspectOptions { profile: InspectProfile::Check, deny_warnings: false };

    for path in &args.paths.paths {
        let report = inspect_path(path, &options)?;
        println!("vmz check: {} ({} file(s))", path.display(), report.files_checked);
        for d in &report.diagnostics {
            eprintln!("{d}");
        }
        if failed(&report, &options) {
            failed_any = true;
        }
    }

    if failed_any {
        bail!("check failed");
    }
    Ok(())
}
