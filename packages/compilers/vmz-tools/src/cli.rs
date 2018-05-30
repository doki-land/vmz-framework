use std::path::PathBuf;

use clap::{Parser, Subcommand};

use crate::commands::{build, check, dev, format, lint, lsp, mcp, new, serve};

#[derive(Debug, Parser)]
#[command(
    name = "vmz",
    version,
    about = "VMZ toolchain: new, format, check, lint, build, serve, dev, lsp, mcp",
    propagate_version = true
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Scaffold a minimal app with a local `vmz` dependency
    #[command(alias = "init")]
    New(new::Args),
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
    /// Language server (stdio JSON-RPC; protocol in vmz-debugger)
    Lsp(lsp::Args),
    /// MCP server (stdio JSON-RPC; protocol in vmz-debugger)
    Mcp(mcp::Args),
}

/// Shared path selection for commands that operate on files or a project root.
#[derive(Debug, Clone, clap::Args)]
pub struct PathArgs {
    /// Files or directories to process (defaults to current directory)
    #[arg(default_value = ".")]
    pub paths: Vec<PathBuf>,
}
