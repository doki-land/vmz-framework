use clap::Parser;
use vmz_compiler::Result;

use vmz_tools::cli::{Cli, Command};
use vmz_tools::commands;

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::New(args) => commands::new::run(args),
        Command::Format(args) => commands::format::run(args),
        Command::Check(args) => commands::check::run(args),
        Command::Lint(args) => commands::lint::run(args),
        Command::Build(args) => commands::build::run(args),
        Command::Serve(args) => commands::serve::run(args),
        Command::Dev(args) => commands::dev::run(args),
        Command::Lsp(args) => commands::lsp::run(args),
        Command::Mcp(args) => commands::mcp::run(args),
    }
}
