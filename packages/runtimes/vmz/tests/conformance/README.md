# Conformance drivers (`pnpm verify`)

TypeScript drivers under **domain folders** — not a flat dump:

| Folder                                   | Scope                                                   |
|------------------------------------------|---------------------------------------------------------|
| `toolchain/`                             | program-ir, node-cli, plugin, affected                  |
| `tooling/`                               | rename, symbols, incremental, causal-trace, …           |
| `profile/`                               | host-profile → cross-host                               |
| `miniprogram/`                           | miniprogram target contract                             |
| `native/`                                | native host / shell / bridge / …                        |
| `runtime/`                               | WriteBarrier, resume, event-flow, …                     |
| `test-host/`                             | `@vmz/test` hosts                                       |
| `document/` · `locale/` · `application/` | product surfaces                                        |
| `style/` · `ui/`                         | theme / UI automation                                   |
| `production/`                            | Browser Production Profile (`browser-production` suite) |
| `_lib/`                                  | shared helpers (`repo-root.ts`, `production-proof.ts`)  |

- **Ids** are semantic (`program-ir`, …) — stable semantic ids.
- **Run:** `pnpm verify -- <id>` or `pnpm --filter vmz run verify -- <id>`.
- **Production profile:**
    - `pnpm verify -- browser-core` — **A1** catalog：compile/logic/ssr/resume/browser + async cancel + no-render +
      ProductRow reverse-edge incremental（region/route/locale/style 切片仍开）
    - `pnpm verify -- router-production` — **A2**：多页 SSR + Link/`data-vmz-route` + load/access/action + nav-cancel +
      Layout + **SPA takeover** + **SPA layout retention**（scroll/focus / locale realization 仍开）
    - `pnpm verify -- release-artifact` — **A3** filesystem：pack + CURRENT/PREVIOUS + rollback + diff（CDN adapters /
      assets hash 仍开）
    - `pnpm verify -- static-delivery` — **A3-static**：`static` 逐路由 HTML + `404.html` + SEO head/sitemap/robots +
      StaticDeliveryManifest（无 SPA fallback；locale 矩阵仍开）
    - `pnpm verify -- cdn-policy` — **A3-cdn**：中立 CDNPolicy + local-static host + netlify
      投影（routing/cache/resume/rollback）
    - `pnpm verify -- content-addressed-assets` — **A3-assets**：`assets/<sha256>.*` + HTML rewrite + digest reuse +
      immutable CDN
    - `pnpm verify -- site-delivery` — **A3-site**：SiteDeliveryContract embedded/fs/remote + release
      fallback（不混装文件交付；Rust packaging / live remote crypto 仍开）
    - `pnpm verify -- production-test` — **A4**：生产用户路径场景包 + deterministic CI（Field/Dialog/locale/theme/mount 仍
      quarantine）
    - `pnpm verify -- production-observability` — **A5**：trace facets + redaction + CSP + budgets + health/ready（dogfood
      fault injection / sampling 仪表仍开）
    - `pnpm verify -- official-dogfood` — **Dogfood**：homepage SSR + documents + production-inspector + `@vmz/ui`
      Button/Field/Dialog（sibling panel / focus-loop 仍开）
    - `pnpm verify -- browser-production` — aggregate **薄绿**（proof 未关前不宣称 production-ready；也尚未进入默认
      `pnpm verify`）
    - Proof: `dist/vmz.production.proof.json`
- **Default `pnpm verify`:** does **not** yet include `browser-production` / `browser-core` / `router-production` (keep
  contract suite green while A* land).
- **Long-term:** migrate into `vmz test` manifests / `cargo test`; this tree is the transitional Node driver home.
- **Source language:** TypeScript only (no `.mjs` drivers).

Root `scripts/` stays build / CI / dev automation; test bodies stay under this tree (and `vmz test` / `cargo test`).
Native `.node` loads via `@vmz/vmz-<platform>` optionalDependencies, not from `packages/runtimes/vmz/*.node`.
