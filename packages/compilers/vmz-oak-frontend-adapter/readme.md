# vmz-oak-frontend-adapter

VMZ ↔ Oaks frontend bridge (CST + AST entry).

| API | Role |
|-----|------|
| `TemplateShellInput` | Template body slice without `vmz-compiler` |
| `parse_template_cst` / `require_template_cst` | Oak `VueParser` CST (`vmz format` preflight) |
| `parse_template_ast` / `require_template_ast` | Oak `VueBuilder` template AST |
| `ScriptShellInput` / `ScriptRole` | Script body slice for Oak TS AST |
| `parse_script_ast` / `require_script_ast` | Oak `TypeScriptBuilder` for `<script client\|server>` |
| `NyarAnalysisInput` | Language-neutral Nyar projection contract (phase D) |

Requires **nightly** Rust (`rust-toolchain.toml`). Oaks via `https://github.com/yggdrasil-language/oaks` `dev` + optional local `[patch]`.

Design: `规划设计/vmz/handoffs/2026-09-30-vmz-oak-nyar-frontend-integration.md`.
