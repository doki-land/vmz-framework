use clap::Parser;
use vmz_compiler::Result;

use vmz_tools::cli::{VmzCommand, VmzTools};
use vmz_tools::commands;

fn main() -> Result<()> {
    let cli = VmzTools::parse();
    match cli.commands {
        VmzCommand::New(args) => commands::new::run(args),
        VmzCommand::Format(args) => commands::format::run(args),
        VmzCommand::Check(args) => commands::check::run(args),
        VmzCommand::Lint(args) => commands::lint::run(args),
        VmzCommand::Build(args) => commands::build::run(args),
        VmzCommand::Serve(args) => commands::serve::run(args),
        VmzCommand::Dev(args) => commands::dev::run(args),
        VmzCommand::Plan(args) => commands::plan::run(args),
        VmzCommand::Lsp(args) => commands::lsp::run(args),
        VmzCommand::Mcp(args) => commands::mcp::run(args),
    }
}
