---
name: vmz-application
description: Help users design, author, review, test, and deploy VMZ applications while preserving VMZ-native component, server, SSR, resume, and deployment boundaries.
---

# VMZ Application

Use this skill when a user asks to build or review a VMZ application, `.vmz` component, server capability, route,
SSR/resume behavior, `vmz test`, or deployment artifact.

## Core model

- Treat VMZ as a full-stack application compiler, not a Vue compatibility layer.
- Components are authoring units; compiler regions, capabilities, Islands, and deployment outputs are execution
  boundaries.
- `public` class fields are props. Ordinary non-public fields are compiler-visible component state.
- Keep server-only imports behind `#server`; never leak secrets or repositories into browser output.
- Prefer the official `@vmz/core`, `@vmz/ui`, `vmz`, and `@vmz/test` surfaces already present in the project.

## Delivery / dist layout (multi-artifact)

- `vmz build` is **multi-artifact**. Default `--out-dir` is `dist` (workspace root for outputs) — **not** “upload this whole tree to a CDN”.
- For **static CDN** (`delivery` profile `static` → `assembly: static-cdn`), emit and publish **`dist/cdn`** only:
  - Prefer: `vmz build . --out-dir dist/cdn` (and `delivery.default: 'static'` in `vmz.config.ts`).
  - CDN / Netlify / Pages **Publish directory** = the app’s `dist/cdn` (multi-page `**/index.html`).
- **Never** tell users to publish bare `dist/` when the app may also hold server-host, hybrid, or other assemblies under the same out root.
- Design truth lives in the workspace VMZ Living doc `04` (Build 产物布局与 CDN 发布); do not invent parallel out-dir schemes in app READMEs. Agent Skills must not deep-link internal decision paths.

## Workflow

1. Inspect the existing project layout and `vmz.config.ts` before proposing files.
2. Express the requested behavior in a component and capability boundary that the compiler can analyze.
3. Run the narrowest relevant `vmz` check or conformance test.
4. Explain any conservative bundling, Island, SSR, or deployment decision with its evidence.

Do not invent hooks, factories, VDOM layers, or frontend mocks. When a capability is not implemented, state that clearly
and identify the nearest supported contract.
