use std::path::PathBuf;

use clap::Args as ClapArgs;
use vmz_compiler::{BuildRequest, Result, Workspace, WorkspaceOptions, bail};
use vmz_plugin_sasso::default_scss_compiler;
use vmz_plugin_tailwind::default_tw_compiler;

use crate::commands::serve::resolve_dirs;

/// Arguments for `vmz build`.
#[derive(Debug, ClapArgs)]
pub struct Args {
    /// Project root (defaults to current directory)
    #[arg(default_value = ".")]
    pub path: PathBuf,

    /// Output directory (relative to project root unless absolute)
    #[arg(short, long, default_value = "dist")]
    pub out_dir: PathBuf,

    /// Build in release mode
    #[arg(long)]
    pub release: bool,
}

/// Run a workspace build with the production TW + SCSS compilers linked in.
pub fn run(args: Args) -> Result<()> {
    let (project, dist) = resolve_dirs(&args.path, &args.out_dir)?;
    // Style plugins (compiler-side) are linked into this single `vmz` binary.
    let mut ws = Workspace::create(WorkspaceOptions {
        root: project.clone(),
        out_dir: dist.clone(),
        tw: Some(default_tw_compiler()),
        scss: Some(default_scss_compiler()),
        runtime_dist: None,
    });
    let report = ws.build_with(&BuildRequest { release: args.release, analysis_ticket: None })?;
    for d in &report.diagnostics {
        eprintln!("{d}");
    }
    if !report.diagnostics.is_empty()
        && report.diagnostics.iter().any(|d| matches!(d.severity(), vmz_compiler::Severity::Error))
    {
        bail!("build failed");
    }
    for path in &report.emitted {
        println!("emitted {}", path.display());
    }
    if let Some(css) = &report.css_entry {
        println!("css entry {css}");
    }
    println!(
        "vmz build: {} -> {} ({} file(s))",
        project.display(),
        dist.display(),
        report.emitted.len()
    );
    Ok(())
}
