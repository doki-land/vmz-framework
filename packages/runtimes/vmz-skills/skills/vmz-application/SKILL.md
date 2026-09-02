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

## Event authoring (0.2.0)

Use one recommended handler surface in templates, examples, and skills:

| Template | Meaning |
|----------|---------|
| `@submit="onSubmitGuard"` | **Recommended** — bare class method; compiler resolves to instance method |
| `@submit.prevent="onSubmitGuard"` | DOM native listener with modifier |
| `@custom="onChildEvent"` | Component event subscription (`onMethod` channel) |
| `:on-submit="handlerProp"` | Function prop (orthogonal to `@submit`) |
| `@submit="this.onSubmitGuard"` | Legal but discouraged in official UI / homepage / examples |
| `@click="() => switchLocale('en-us')"` | Bare method call inside arrow; compiler rewrites to `this.switchLocale(...)` |
| Unknown bare ident | **Compile error** (`handler-symbol-resolution`) |

Do not teach dual authoring (`this.method` as default) in new samples or skills.

## Code highlighting (`default`)

When the user needs syntax-colored source:

1. Use the `default` code highlighting contract.
2. For build, SSR, and static export, consume the Rust-generated `NativeCodeArtifact`.
3. For runtime highlighting, use **`@vmz/highlighter`** and install **`@vmz/highlighter-unknown-wasm32`** when unknown-language fallback is needed.
4. For non-VMZ applications, prefer the **`vmz-highlighter`** Custom Element. It does not require the VMZ runtime.

**Do not:**

- Import a native renderer or WASM implementation directly into application components.
- Paint highlighted HTML by hand or create a second VMZ-local highlighter surface.
- Put native rendering dependencies in browser runtime or client chunks.
- Expect `@vmz/ui` **`CodeBlock`** to execute a highlighter. It consumes static artifacts or plain text and provides presentation chrome.

Plain uncolored samples → `CodeBlock`. Runtime colored reading → `@vmz/highlighter`. Editors remain a separate editor integration, not a highlighter stretched into an editor.

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
