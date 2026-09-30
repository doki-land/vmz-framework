# vmz-oak-frontend-adapter

VMZ ↔ Oaks frontend bridge (CST + AST entry).

| API | Role |
|-----|------|
| `TemplateShellInput` | Template body slice without `vmz-compiler` |
| `parse_template_cst` / `require_template_cst` | Oak `VueParser` CST (`vmz format` preflight) |
| `parse_template_ast` / `require_template_ast` | Oak `VueBuilder` AST |

Region map and Oak → Concrete lowering live in `vmz-compiler::oak` and `parse::template_oak`.

Requires **nightly** Rust (`rust-toolchain.toml`). Oaks via git + optional local `[patch]`.

Design: `规划设计/vmz/handoffs/2026-09-30-vmz-oak-nyar-frontend-integration.md`.
