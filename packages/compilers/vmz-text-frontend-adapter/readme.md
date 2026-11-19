# vmz-text-frontend-adapter

VMZ ↔ `data.text` frontend bridge (CST + AST entry).

| API | Role |
|-----|------|
| `TemplateShellInput` | Template body slice without `vmz-compiler` |
| `parse_template_cst` / `require_template_cst` | `VueParser` CST (diagnostics only until parser loop is fixed) |
| `parse_template_ast` / `require_template_ast` | `VueBuilder` template AST |
| `ScriptShellInput` / `ScriptRole` | Script body slice for `data.text` TS AST |
| `parse_script_ast` / `require_script_ast` | `data.text` `TypeScriptBuilder` for `<script client\|server>` |
| `NyarAnalysisInput` | Language-neutral Nyar projection from `.vmz` scripts |

Requires **nightly** Rust (`rust-toolchain.toml`). "`data.text` from the pinned `rust-boost` revision in the root `Cargo.toml`. Local sibling override: copy `.cargo/config.example.toml` → `.cargo/config.toml` (git ignored). `cargo tree -p data-text-core` should show a path when patch is active.

`data.text` supplies Vue/TypeScript CST and AST for VMZ SFC regions; this crate adapts those surfaces and projects scripts into `NyarAnalysisInput` for Nyar analysis. Conformance gate: `pnpm verify -- text-frontend-smoke`.
