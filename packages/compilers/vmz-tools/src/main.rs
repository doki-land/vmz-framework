mod cli;
mod commands;

use anyhow::Result;
use clap::Parser;

use crate::cli::{Cli, Command};

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::Format(args) => commands::format::run(args),
        Command::Check(args) => commands::check::run(args),
        Command::Lint(args) => commands::lint::run(args),
        Command::Build(args) => commands::build::run(args),
        Command::Serve(args) => commands::serve::run(args),
        Command::Dev(args) => commands::dev::run(args),
    }
}
