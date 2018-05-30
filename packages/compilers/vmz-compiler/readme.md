# vmz-compiler

Core **compile pipeline** for `.vmz`: SFC split, oxc analysis, Unified Program Graph / Execution Plan construction,
Direct emit, and the long-lived **`Workspace`** session façade (N1).

|                |                                                                                       |
|----------------|---------------------------------------------------------------------------------------|
| **Crate**      | `vmz-compiler`                                                                        |
| **Kind**       | library                                                                               |
| **Publish**    | `false` (workspace-internal)                                                          |
| **Depends on** | `vmz-protocol`, `vmz-types`, [`vmz-debugger`](../vmz-debugger/) (explain façade only) |

## Features

- Parse `.vmz` (script / template / style / static router·meta blocks)
- Build program modules, dependency / reactive views, Direct DOM schedules
- Project `check` / `compile` / `format` primitives used by inspector and CLI
- Style **core**: `/designs`, TW/SCSS **hooks**, style emit & token diagnostics (engines are separate crates)
- Application collection / mount composition helpers
- `Workspace`: handshake, incremental dirty rebuild, affected plans, plugin contributions
- Session façade methods that **delegate** explain / trace / replay to `vmz-debugger`

## Non-goals

| Capability                                        | Owner                                     |
|---------------------------------------------------|-------------------------------------------|
| Soft/hard inspect profiles (`vmz check` / `lint`) | [`vmz-inspector`](../vmz-inspector/)      |
| Causal explain, trace, LSP/MCP protocol           | [`vmz-debugger`](../vmz-debugger/)        |
| Tailwind / SCSS engine implementation             | `vmz-plugin-tailwind`, `vmz-plugin-sasso` |
| Competing semantic IRs                            | **forbidden** (design `13` )              |

Do **not** depend on concrete style engine crates from this package. Inject `TwCompiler` / `ScssCompiler` handles at the
host boundary.

## Source layout

```text
src/
  parse/          SFC · template IR · analyze · format
  pipeline/       check · compile · graph · emit · #server · WriteBarrier
  style/          designs · TW/SCSS hooks · emit · explain · token diag
  application/    collection / mount 
  session/        Workspace · affected · plugin store
  tooling/        TRANSITIONAL: rename · cross-SFC · transaction · deployment proof
  native/         TRANSITIONAL: WebView / native host contracts → vmz-platform
  miniprogram/    TRANSITIONAL: miniprogram target-neutral contracts → vmz-platform
  platform/       TRANSITIONAL: HostProfile / conformance → vmz-platform
  diagnostic.rs   shared reported diagnostic shape
  lib.rs          public API + legacy module aliases
```

Legacy gate module names (`rename`, `native_host`, `host_profile`, …) remain as **`lib.rs` aliases**. New code should
use semantic paths or the owning crate (`vmz_debugger`, future `vmz-platform`).

## Usage

```rust
use std::path::PathBuf;
use vmz_compiler::{CompileOptions, Workspace, WorkspaceOptions, compile_project};

// One-shot project compile
let report = compile_project("/path/to/app", & CompileOptions::default ()) ?;

// Long-lived session (CLI / N-API)
let ws = Workspace::create(WorkspaceOptions {
root: PathBuf::from("/path/to/app"),
out_dir: PathBuf::from("/path/to/app/dist"),
tw: None,
scss: None,
});
let json = ws.explain("write:n"); // delegated to vmz-debugger
assert!(json.contains("schema"));
```

See `session/workspace.rs` and [`vmz-napi`](../vmz-napi/) for the full session surface.

## Development

```bash
cargo check -p vmz-compiler
cargo test  -p vmz-compiler
```

## License

MIT. See the workspace `license` field.
