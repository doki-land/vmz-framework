use std::path::PathBuf;

use clap::{Parser, Subcommand};

use crate::commands::{build, check, dev, format, lint, serve};

#[derive(Debug, Parser)]
#[command(
    name = "vmz",
    version,
    about = "VMZ toolchain ?format, check, lint, build, serve, and dev",
    propagate_version = true
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Format `.vmz` / TypeScript sources
    Format(format::Args),
    /// Type-check and validate the project without emitting
    Check(check::Args),
    /// Run lints
    Lint(lint::Args),
    /// Build the project
    Build(build::Args),
    /// Serve `dist` (SSR + static + RPC/REST)
    Serve(serve::Args),
    /// Build, serve, and rebuild on `src/` changes
    Dev(dev::Args),
}

/// Shared path selection for commands that operate on files or a project root.
#[derive(Debug, Clone, clap::Args)]
pub struct PathArgs {
    /// Files or directories to process (defaults to current directory)
    #[arg(default_value = ".")]
    pub paths: Vec<PathBuf>,
}
