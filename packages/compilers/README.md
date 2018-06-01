# compilers

Rust crates that implement the VMZ toolchain (parse → program graph → emit, plus inspect and debug surfaces).

## Crate map

```text
vmz-protocol     wire schemas only
vmz-types        VMZ semantic types on oxc
      │
      ▼
vmz-compiler     parse · analyze · graph · emit · Workspace façade
      │
      ├──────────────► vmz-inspector    static check / lint
      │
      └──────────────► vmz-debugger     explain · trace · replay · LSP/MCP
                              │
vmz-napi  ────────────────────┴── Node session bridge
vmz-tools                         ONLY native binary: `vmz`
                                  (`vmz lsp` / `vmz mcp` host debugger protocols)

vmz-plugin-tailwind ──┐
vmz-plugin-sasso ─────┴── style engines (hook into compiler; never reverse-dep)
```

| Crate                                           | Role                                          |
|-------------------------------------------------|-----------------------------------------------|
| [`vmz-protocol`](./vmz-protocol/)               | Versioned wire documents (`vmz.*.v0`)         |
| [`vmz-types`](./vmz-types/)                     | Semantic types layered on oxc                 |
| [`vmz-compiler`](./vmz-compiler/)               | SFC pipeline + `Workspace`                    |
| [`vmz-inspector`](./vmz-inspector/)             | Static correctness (`check` / `lint`)         |
| [`vmz-debugger`](./vmz-debugger/)               | Causal explain + LSP/MCP **library** (no bin) |
| [`vmz-napi`](./vmz-napi/)                       | N-API cdylib for Node                         |
| [`vmz-tools`](./vmz-tools/)                     | **Only** native CLI: `vmz`                    |
| [`vmz-plugin-tailwind`](./vmz-plugin-tailwind/) | Tailwind style engine                         |
| [`vmz-plugin-sasso`](./vmz-plugin-sasso/)       | SCSS style engine (sasso)                     |

### Inspector vs debugger

| Concern        | `vmz-inspector`                    | `vmz-debugger`                                           |
|----------------|------------------------------------|----------------------------------------------------------|
| Question       | Is this source / convention valid? | Why did this write/update happen, and what did it touch? |
| Typical CLI    | `vmz check`, `vmz lint`            | `vmz lsp`, `vmz mcp`, plus Workspace explain APIs        |
| Process host   | via `Workspace` / N-API            | **same** `vmz` binary (`vmz-tools`)                      |
| Primary input  | `.vmz` + compiler diagnostics      | Emitted `*.program.json` + StableId traces               |
| Primary output | Diagnostics                        | Explain / replay documents                               |

One **Unified Program Graph** and one **Execution Plan** are shared across the toolchain, including tooling surfaces.

## Non-goals for this directory

- A second native executable (`vmz-lsp`, `vmz-mcp`, …) — only `vmz` from `vmz-tools`
- Separate publishable LSP/MCP crates (protocol library lives in `vmz-debugger`)
- Legacy flat dump modules at `vmz-compiler/src/` root
- Compiler depending on concrete style engine crates (hooks only)

## Development

From the `vmz-framework` repository root:

```bash
cargo check -p vmz-compiler -p vmz-inspector -p vmz-debugger -p vmz-napi
cargo test  -p vmz-debugger -p vmz-inspector
```

License: MIT (see package `license` field). Crates are `publish = false` until the public packaging story lands.
