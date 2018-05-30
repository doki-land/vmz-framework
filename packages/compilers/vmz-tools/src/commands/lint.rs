use clap::Args as ClapArgs;
use vmz_compiler::{Result, bail};
use vmz_inspector::{InspectOptions, InspectProfile, failed, inspect_path};

use crate::cli::PathArgs;

#[derive(Debug, ClapArgs)]
pub struct Args {
    #[command(flatten)]
    pub paths: PathArgs,

    /// Treat warnings as errors
    #[arg(long)]
    pub deny_warnings: bool,
}

pub fn run(args: Args) -> Result<()> {
    let options =
        InspectOptions { profile: InspectProfile::Lint, deny_warnings: args.deny_warnings };
    let mut failed_any = false;
    for path in &args.paths.paths {
        let report = inspect_path(path, &options)?;
        println!("vmz lint: {} ({} file(s))", path.display(), report.files_checked);
        for d in &report.diagnostics {
            eprintln!("{d}");
        }
        if failed(&report, &options) {
            failed_any = true;
        }
    }
    if failed_any {
        bail!("lint failed");
    }
    Ok(())
}
