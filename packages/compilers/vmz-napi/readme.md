# vmz-napi

Node-API (**N-API**) `cdylib` that exposes the Rust [`Workspace`](../vmz-compiler/) session—and through it inspect +
debugger façades—to the npm `vmz` package.

|             |                                          |
|-------------|------------------------------------------|
| **Crate**   | `vmz-napi`                               |
| **Kind**    | `cdylib`                                 |
| **Publish** | `false` (loaded by the JS `vmz` package) |

## Features

- Long-lived incremental compile session over N-API
- Forwards `check` / `lint` / **`format`** (`vmz-formatter`), build, affected, explain, rename helpers as JS-callable methods
- Protocol handshake aligned with `vmz-protocol` host/compiler versions

## Non-goals

- Re-implementing analysis, author format, or explain heuristics in JavaScript
- Calling Node `oxfmt` / Biome for `.vmz` (format stays in Rust [`vmz-formatter`](../vmz-formatter/))
- Replacing `vmz lsp` / `vmz mcp` stdio hosting ([`vmz-tools`](../vmz-tools/); protocol lib in [
  `vmz-debugger`](../vmz-debugger/))
- Owning semantic IR

## Build

```bash
# from vmz-framework root — exact script may wrap napi-build
cargo build -p vmz-napi
```

The JS package under `packages/runtimes/vmz` loads the produced native addon. Prefer that package’s README / `pnpm`
scripts for day-to-day rebuilds.

## License

MIT. See the workspace `license` field.
