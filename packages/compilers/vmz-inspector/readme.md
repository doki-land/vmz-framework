# vmz-inspector

Static **inspection** for VMZ projects: hard semantic/`check` diagnostics and soft convention `lint` advice on top of
the compiler pipeline.

|                 |                                                   |
|-----------------|---------------------------------------------------|
| **Crate**       | `vmz-inspector`                                   |
| **Kind**        | library                                           |
| **Publish**     | `false` (workspace-internal)                      |
| **CLI surface** | `vmz check`, `vmz lint` (via N-API / `vmz-tools`) |
| **Depends on**  | [`vmz-compiler`](../vmz-compiler/)                |

> **Not** [`vmz-debugger`](../vmz-debugger/). Inspector is pass/fail diagnostics. Debugger is the causal explain /
> trace / replay **library**; LSP·MCP are hosted only as `vmz lsp` / `vmz mcp`.

## Features

- **`InspectProfile::Check`** — hard errors + existing semantic check (no soft convention lints)
- **`InspectProfile::Lint`** — Check plus convention advice (`Warning`); optional `--deny-warnings`
- **`inspect_path` / `inspect_project`** — single entry for file or project root
- **`append_convention_lints`** — add soft lints onto an existing `CheckReport` (used by `Workspace`)

## Non-goals

- Runtime traces, explain chains, or causal replay ([`vmz-debugger`](../vmz-debugger/))
- Owning LSP/MCP JSON-RPC (also debugger)
- Re-implementing oxc parse or inventing a parallel diagnostic span type
- Becoming a general “everything tools” mega-crate

## Usage

```rust
use vmz_inspector::{InspectOptions, InspectProfile, failed, inspect_path};

let opts = InspectOptions {
profile: InspectProfile::Lint,
deny_warnings: true,
};
let report = inspect_path("/path/to/app", & opts) ?;
if failed( & report, & opts) {
for d in & report.diagnostics {
eprintln ! ("{d:?}");
}
}
```

Profiles map to CLI:

| Profile | CLI         | Soft conventions |
|---------|-------------|------------------|
| `Check` | `vmz check` | no               |
| `Lint`  | `vmz lint`  | yes              |

## What gets linted (examples)

Convention rules live under `convention` (e.g. named layouts should use a `*Layout` stem). Hard semantic diagnostics
still come from [`vmz-compiler`](../vmz-compiler/) `check_*` APIs; this crate **orchestrates** the inspect profile
rather than duplicating the whole analysis.

## Integration

```text
Node `vmz`  →  vmz-napi  →  Workspace.check / lint  →  vmz-inspector
vmz-tools   →  same inspect APIs
```

## Development

```bash
cargo test -p vmz-inspector
```

## License

MIT. See the workspace `license` field.
