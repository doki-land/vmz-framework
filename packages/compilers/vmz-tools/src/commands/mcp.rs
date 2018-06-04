use std::io::{self, BufRead, Write};
use std::path::PathBuf;

use clap::Args as ClapArgs;
use serde_json::Value;
use vmz_compiler::{Result, ResultExt};
use vmz_debugger::mcp::{self, McpSession};

/// Arguments for `vmz mcp`.
#[derive(Debug, ClapArgs)]
pub struct Args {
    /// Project root (defaults to current directory)
    #[arg(default_value = ".")]
    pub root: PathBuf,

    /// Artifact directory with `*.program.json` (default: `<root>/dist`)
    #[arg(long)]
    pub out_dir: Option<PathBuf>,
}

/// Serve the debugger MCP session over newline-delimited JSON-RPC on stdio.
pub fn run(args: Args) -> Result<()> {
    let root = args.root.canonicalize().unwrap_or(args.root);
    let out_dir = args.out_dir.unwrap_or_else(|| mcp::default_out_dir(&root));
    let session = McpSession::new(root, out_dir);

    let stdin = io::stdin();
    let mut stdout = io::stdout();
    let mut reader = stdin.lock();
    let mut line = String::new();

    loop {
        line.clear();
        let n = reader.read_line(&mut line)?;
        if n == 0 {
            break;
        }
        let trim = line.trim();
        if trim.is_empty() {
            continue;
        }
        let req: Value = serde_json::from_str(trim)
            .with_context(|| format!("invalid MCP JSON-RPC line: {trim}"))?;
        if req.get("method").and_then(|m| m.as_str()) == Some("exit") {
            break;
        }
        if let Some(resp) = mcp::dispatch(&session, &req) {
            serde_json::to_writer(&mut stdout, &resp)?;
            stdout.write_all(b"\n")?;
            stdout.flush()?;
        }
    }
    Ok(())
}
