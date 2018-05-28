use anyhow::{Result, bail};

fn main() -> Result<()> {
    // Will reuse oxc parse/semantic diagnostics over LSP.
    let _ = oxc::allocator::Allocator::default();
    bail!("vmz-lsp is not implemented yet");
}
