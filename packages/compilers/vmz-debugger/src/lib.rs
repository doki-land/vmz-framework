//! VMZ debugger: Program Graph explain, runtime trace, causal replay,
//! plus **LSP / MCP protocol libraries** (no process binary — use `vmz lsp` / `vmz mcp`).
//!
//! crate map in `05`. The only native CLI binary is `vmz` (`vmz-tools`).

#![warn(missing_docs)]
pub mod causal_replay;
pub mod lsp;
pub mod mcp;

pub use causal_replay::{
    check_causal_replay, explain_update, explain_write, ingest_runtime_trace, replay_causal,
};
