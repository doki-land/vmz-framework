# vmz-debugger

Graph-driven **debugging and tool-protocol library** for VMZ: explain write/update chains, ingest StableId traces,
replay causality against emitted program graphs, and expose the same core as **LSP** and **MCP** protocol modules.

|                        |                                                                                     |
|------------------------|-------------------------------------------------------------------------------------|
| **Crate**              | `vmz-debugger`                                                                      |
| **Kind**               | **library only** (no `[[bin]]`)                                                     |
| **Publish**            | `false` (workspace-internal)                                                        |
| **Depends on**         | [`vmz-protocol`](../vmz-protocol/)                                                  |
| **Does not depend on** | `vmz-compiler` (no parse / emit)                                                    |
| **Process host**       | product CLI `@vmz/vmz` (N-API). LSP/MCP stdio host deferred — library only today |

> **Not** [`vmz-inspector`](../vmz-inspector/). Inspector answers “is this legal?” Debugger answers “why did the graph
> update?”  
> **Not** a second product CLI. User-facing commands go through `@vmz/vmz` + N-API.

## Features

- **Explain** — `write:<field>` / `update:<chunk>#binding:<id>` → `ExplainDocument` chains from `*.program.json` edges
- **Trace ingest** — validate / normalize StableId-tagged runtime or synthetic traces (`vmz.dx.trace.v0`)
- **Causal replay** — join trace events to explain chains (`vmz.dx.causal_replay.v0`)
- **Umbrella check** — `check_causal_replay` report for verify
- **LSP surface** (`vmz_debugger::lsp`) — JSON-RPC method handlers
- **MCP surface** (`vmz_debugger::mcp`) — tool catalog + `tools/call` handlers

## Non-goals

- Shipping `vmz-lsp`, `vmz-mcp`, or any other native binary from this crate
- Parsing `.vmz`, building the program graph, or emitting JS/CSS
- Convention lint / hard `check` diagnostics ([`vmz-inspector`](../vmz-inspector/))
- Full LSP `Content-Length` framing (line-delimited JSON-RPC first; framing is a `vmz lsp` follow-up)
- A second heuristic analysis path that diverges from Program Graph StableIds

## Library usage

```rust
use std::path::Path;
use vmz_debugger::{explain_write, ingest_runtime_trace, replay_causal};

fn demo(out_dir: &Path) {
    let explain = explain_write(out_dir, "n", /* session_generation */ 1);
    println!("{}", explain.to_json());

    let trace = r#"[{"kind":"write","stableId":{"kind":"field","id":"n"}}]"#;
    let ingested = ingest_runtime_trace(trace);
    let replay = replay_causal(out_dir, &ingested.to_json(), 1);
    println!("{}", replay.to_json());
}
```

### LSP / MCP modules

Protocol handlers live in this crate as a **library**. Product stdio hosting is deferred (not a second CLI bin).

```rust
use serde_json::json;
use vmz_debugger::lsp::{self, LspSession};

let session = LspSession::new("/app", "/app/dist");
let req = json!({
    "jsonrpc": "2.0",
    "id": 1,
    "method": lsp::METHOD_EXPLAIN,
    "params": { "target": "write:n" }
});
let resp = lsp::dispatch( & session, & req).expect("response");
```

Custom LSP methods: `vmz/explain`, `vmz/ingestTrace`, `vmz/replayCausal`, `vmz/checkX5`.

| MCP tool            | Purpose              |
|---------------------|----------------------|
| `vmz_explain`       | Explain write/update |
| `vmz_ingest_trace`  | Ingest trace JSON    |
| `vmz_replay_causal` | Causal replay        |
| `vmz_check_x5`      | Umbrella report      |

## Stdio hosting

Deferred. Call `vmz_debugger::lsp` / `::mcp` from a future `@vmz/vmz` or dedicated host; do **not** revive a parallel Rust product CLI.

Both protocol surfaces speak **line-delimited JSON-RPC**. Example MCP session (one JSON object per line):

```json
{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {}
}
{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list",
    "params": {}
}
```

## Module layout

```text
src/
  lib.rs              re-exports causal API
  causal_replay.rs    explain · ingest · replay · check_causal_replay
  lsp.rs              LSP JSON-RPC surface (library)
  mcp.rs              MCP tools surface (library)
```

## Integration

- [`vmz-compiler`](../vmz-compiler/) `Workspace::explain` / `ingest_runtime_trace` / `replay_causal` /
  `check_causal_replay` **delegate here**.
- Gate alias `vmz_compiler::causal_replay` re-exports `vmz_debugger::causal_replay` for older call sites.
- Prefer `vmz_debugger::…` in new code.
- Stdio product hosting is deferred; do not add a parallel Rust CLI bin for it.

## Development

```bash
cargo test -p vmz-debugger
```

## License

MIT. See the workspace `license` field.
