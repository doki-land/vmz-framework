# Conformance drivers (`pnpm verify`)

TypeScript drivers under **domain folders** — not a flat dump:

| Folder                                   | Scope                                         |
|------------------------------------------|-----------------------------------------------|
| `toolchain/`                             | program-ir, node-cli, plugin, affected        |
| `tooling/`                               | rename, symbols, incremental, causal-trace, … |
| `profile/`                               | host-profile → cross-host                     |
| `miniprogram/`                           | miniprogram target contract                   |
| `native/`                                | native host / shell / bridge / …              |
| `runtime/`                               | WriteBarrier, resume, event-flow, …           |
| `test-host/`                             | `@vmz/test` hosts                             |
| `document/` · `locale/` · `application/` | product surfaces                              |
| `style/` · `ui/`                         | theme / UI automation                         |
| `_lib/`                                  | shared helpers (`repo-root.ts`)               |

- **Ids** are semantic (`program-ir`, …) — stable semantic ids.
- **Run:** `pnpm verify -- <id>` or `pnpm --filter vmz run verify -- <id>`.
- **Long-term:** migrate into `vmz test` manifests / `cargo test`; this tree is the transitional Node driver home.
- **Source language:** TypeScript only (no `.mjs` drivers).

Root `scripts/` must not grow new test bodies. Native `.node` loads via `@vmz/vmz-<platform>` optionalDependencies —
never from `packages/runtimes/vmz/*.node`.
