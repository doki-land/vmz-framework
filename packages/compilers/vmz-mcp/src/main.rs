use anyhow::{Result, bail};

fn main() -> Result<()> {
    // MCP tools should wrap the same oxc-backed pipelines as `vmz` CLI.
    let _ = oxc::allocator::Allocator::default();
    bail!("vmz-mcp is not implemented yet");
}
