# vmz-protocol

Versioned **wire protocols** for VMZ: schema identifiers and serde document shapes shared by CLI, N-API, debugger
(LSP/MCP), and `@vmz/test`.

|             |                              |
|-------------|------------------------------|
| **Crate**   | `vmz-protocol`               |
| **Kind**    | library                      |
| **Publish** | `false` (workspace-internal) |

## Features

- Stable schema constants (`vmz.dx.explain.v0`, deployment / test / application documents, …)
- Serde types for explain, workspace edit, affected, traces, catalogs, …
- Domain modules: `dx`, `host`, `plugin`, `test`, `application`, `locale`, `profile`, …

## Non-goals

- Program Graph / Execution Plan **implementation** ([`vmz-types`](../vmz-types/), [`vmz-compiler`](../vmz-compiler/))
- Running `check`, `lint`, or causal replay ([`vmz-inspector`](../vmz-inspector/), [`vmz-debugger`](../vmz-debugger/))
- Node-only types (TypeScript mirror lives under `@vmz/protocol` in the JS workspace)

Names like `vmz.dx.*` are **on-the-wire contracts**. They are unrelated to Rust directory names (`tooling/`, etc.).

## Usage

```rust
use vmz_protocol::EXPLAIN_SCHEMA;

assert_eq!(EXPLAIN_SCHEMA, "vmz.dx.explain.v0");
```

Construct documents in [`vmz-debugger`](../vmz-debugger/) / [`vmz-compiler`](../vmz-compiler/), then serialize with
helpers such as `ExplainDocument::to_json()`. This crate owns the **shapes and schema ids**, not the analysis.

## Development

```bash
cargo test -p vmz-protocol
```

## License

MIT. See the workspace `license` field.
