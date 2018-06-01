# Getting started

VMZ is an oxc-based full-stack application compiler: Vue- *familiar* surface, oxc-native compile, **VMZ-native
semantics**.

**Convention over configuration** — directories are routes / components / server entrypoints; config is for exceptions.
Brand line: **Vue-Familiar · Multi-Platform · Zero-Cost**.

```bash
pnpm add @vmz/core
pnpm add -D @vmz/vmz
```

Add `@vmz/ui` when you need the official UI; add `@vmz/plugin-*` when you need compiler plugins.

Prefer typed config:

```ts
import {defineConfig} from 'vmz';

export default defineConfig({
    plugins: [],
});
```

- [Zero-Cost](./zero-cost.md)
- [Optimizations](./optimizations/index.md)
- More guides and plugin docs live under `/d/`
