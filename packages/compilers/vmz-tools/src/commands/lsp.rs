use std::io::{self, BufRead, Write};
use std::path::PathBuf;

use clap::Args as ClapArgs;
use serde_json::Value;
use vmz_compiler::{Result, ResultExt, bail};
use vmz_debugger::lsp::{self, LspSession};

/// Arguments for `vmz lsp`.
#[derive(Debug, ClapArgs)]
pub struct Args {
    /// Project root (defaults to current directory)
    #[arg(default_value = ".")]
    pub root: PathBuf,

    /// Artifact directory with `*.program.json` (default: `<root>/dist`)
    #[arg(long)]
    pub out_dir: Option<PathBuf>,
}

/// Serve the debugger LSP session over stdio (Content-Length framing).
pub fn run(args: Args) -> Result<()> {
    let root = args.root.canonicalize().unwrap_or(args.root);
    let out_dir = args.out_dir.unwrap_or_else(|| lsp::default_out_dir(&root));
    let session = LspSession::new(root, out_dir);

    let stdin = io::stdin();
    let mut stdout = io::stdout();
    let mut reader = stdin.lock();

    loop {
        let Some(req) = read_lsp_message(&mut reader)? else {
            break;
        };
        if req.get("method").and_then(|m| m.as_str()) == Some("exit") {
            break;
        }
        if let Some(resp) = lsp::dispatch(&session, &req) {
            let value = serde_json::to_value(&resp).context("serialize LSP response")?;
            write_lsp_message(&mut stdout, &value)?;
        }
    }
    Ok(())
}

/// LSP stdio framing: header block ending with `\r\n\r\n`, then `Content-Length` bytes.
fn read_lsp_message(reader: &mut impl BufRead) -> Result<Option<Value>> {
    let mut content_length: Option<usize> = None;
    loop {
        let mut line = String::new();
        let n = reader.read_line(&mut line)?;
        if n == 0 {
            return Ok(None);
        }
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }
        let Some((key, value)) = trimmed.split_once(':') else {
            continue;
        };
        if key.eq_ignore_ascii_case("Content-Length") {
            content_length = Some(
                value
                    .trim()
                    .parse::<usize>()
                    .with_context(|| format!("invalid Content-Length: {value}"))?,
            );
        }
    }
    let Some(len) = content_length else {
        bail!("LSP message missing Content-Length header");
    };
    let mut buf = vec![0u8; len];
    reader.read_exact(&mut buf)?;
    let value = serde_json::from_slice(&buf).context("invalid LSP JSON body")?;
    Ok(Some(value))
}

fn write_lsp_message(writer: &mut impl Write, msg: &Value) -> Result<()> {
    let body = serde_json::to_vec(msg).context("serialize LSP body")?;
    write!(writer, "Content-Length: {}\r\n\r\n", body.len())?;
    writer.write_all(&body)?;
    writer.flush()?;
    Ok(())
}
