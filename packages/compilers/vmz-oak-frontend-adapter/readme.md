# vmz-oak-frontend-adapter

VMZ ↔ Oaks frontend bridge (CST + AST entry).

| API | Role |
|-----|------|
| `TemplateShellInput` | Template body slice without `vmz-compiler` |
| `parse_template_cst` / `require_template_cst` | Oak `VueParser` CST (diagnostics only until parser loop is fixed) |
| `parse_template_ast` / `require_template_ast` | Oak `VueBuilder` template AST |
| `ScriptShellInput` / `ScriptRole` | Script body slice for Oak TS AST |
| `parse_script_ast` / `require_script_ast` | Oak `TypeScriptBuilder` for `<script client\|server>` |
| `NyarAnalysisInput` | Language-neutral Nyar projection from `.vmz` scripts |

Requires **nightly** Rust (`rust-toolchain.toml`). Oaks via `https://github.com/yggdrasil-language/oaks` `dev` in root `Cargo.toml`. Local sibling override: copy `.cargo/config.toml.example` → `.cargo/config.toml` (gitignored). `cargo tree -p oak-core` should show a path when patch is active.

Oaks supplies Vue/TypeScript CST and AST for VMZ SFC regions; this crate adapts those surfaces and projects scripts into `NyarAnalysisInput` for Nyar analysis. Conformance gate: `pnpm verify -- oak-frontend-smoke`.
