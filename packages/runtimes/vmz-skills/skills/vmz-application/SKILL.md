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

- `vmz build` is **multi-artifact**. Default `--out-dir` is `dist` (workspace root) — **not** the CDN publish tree.
- Three layers: **profile id** (e.g. `static`) · **assembly** (`web-static`) · **`name`** (subdir under out-dir).
- Static CDN: `profiles.static` with `assembly: 'web-static'` and `name: 'cdn'` → publish **`dist/cdn`** only.
  - Omit `name` → default `dist/static`.
  - **Never** teach `--out-dir dist/cdn` as the naming mechanism.
- Downstream apps call published npm `vmz`. Do not require sibling overlay / `link:` for CI.

## Workflow

1. Inspect the existing project layout and `vmz.config.ts` before proposing files.
2. Express the requested behavior in a component and capability boundary that the compiler can analyze.
3. Run the narrowest relevant `vmz` check or conformance test.
4. Explain any conservative bundling, Island, SSR, or deployment decision with its evidence.

Do not invent hooks, factories, VDOM layers, or frontend mocks. When a capability is not implemented, state that clearly
and identify the nearest supported contract.
