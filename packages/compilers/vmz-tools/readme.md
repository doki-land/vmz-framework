# vmz-tools

The **only native CLI binary** in the VMZ Rust toolchain: `vmz` (on Windows, `vmz.exe`).

|                 |             |
|-----------------|-------------|
| **Crate**       | `vmz-tools` |
| **Binary name** | `vmz`       |
| **Publish**     | `false`     |

Day-to-day Node users still prefer the npm `vmz` package (N-API). This crate is the Cargo / no-Node host and the sole
place native stdio servers are wired.

## Commands

| Command      | Role                                                            |
|--------------|-----------------------------------------------------------------|
| `vmz format` | Format `.vmz` via [`vmz-formatter`](../vmz-formatter/) (oxc IR + EditorConfig; default write / `--check`) |
| `vmz check`  | Inspector Check profile                                         |
| `vmz lint`   | Inspector Lint profile                                          |
| `vmz build`  | Build artifacts                                                 |
| `vmz serve`  | Serve `dist`                                                    |
| `vmz dev`    | Build + serve + rebuild                                         |
| `vmz lsp`    | Language server stdio → [`vmz-debugger::lsp`](../vmz-debugger/) |
| `vmz mcp`    | MCP server stdio → [`vmz-debugger::mcp`](../vmz-debugger/)      |

### LSP / MCP

Protocol **implementation** lives in the [`vmz-debugger`](../vmz-debugger/) **library**. This crate only owns the
process loop:

```bash
cargo run -p vmz-tools -- lsp .
cargo run -p vmz-tools -- mcp . --out-dir ./dist
```

Do **not** add `vmz-lsp` / `vmz-mcp` binaries or packages.

## npm `vmz` vs this binary

| Host                   | Typical use                                               |
|------------------------|-----------------------------------------------------------|
| npm `vmz` (N-API)      | Default DX, plugins, `vmz test`                           |
| `vmz` from `vmz-tools` | Cargo-only envs, native LSP/MCP stdio, debugging Rust CLI |

```bash
cargo run -p vmz-tools -- --help
# repository helper (if present):
pnpm vmz:cargo -- --help
```

## License

MIT. See the workspace `license` field.
