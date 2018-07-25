//! CLI subcommand modules for the `vmz` binary.

/// `vmz build` -- emit project artifacts into `dist/`.
pub mod build;
/// `vmz check` -- hard semantic / convention validation without emit.
pub mod check;
/// `vmz dev` -- build, serve, and rebuild on `src/` changes.
pub mod dev;
/// `vmz format` — author `.vmz` via `vmz-formatter` (default write / `--check`).
pub mod format;
/// `vmz lint` -- check plus soft convention advice.
pub mod lint;
/// `vmz lsp` -- language server over stdio JSON-RPC.
pub mod lsp;
/// `vmz mcp` -- MCP server over stdio JSON-RPC lines.
pub mod mcp;
/// `vmz new` / `vmz init` -- scaffold a minimal app.
pub mod new;
/// `vmz serve` -- run the built serve-host against `dist/`.
pub mod serve;
