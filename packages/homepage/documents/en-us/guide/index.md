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

Official plugins are factories: `pluginName(optional config)`. Register `katex()`, not `katex`.

Sites with `documents/` also need a Markdown engine. Install the package, register the plugin, and select the engine:

```ts
import {defineConfig} from 'vmz';
import markdownIt from '@vmz/plugin-markdown-it';

export default defineConfig({
    plugins: [markdownIt()],
    engines: {markdown: 'markdown-it'},
});
```

Installing the package or registering the plugin alone fails when `vmz dev` mounts documents.

The official UI takes its style values from your project's `designs/`. Install `@vmz/ui` and
materialize the built-in preset as an editable starting point:

```bash
pnpm add @vmz/ui
pnpm exec vmz init design
```

By default it copies the `web-surface` preset into `designs/` and skips files that already exist.
Use `--force` to overwrite, `--dry-run` to preview, `--designs-dir <dir>` for another directory,
and `--preset <name>` for another preset. A preset is only initial Style Theme files — it is not a
runtime theme and is never injected into the app automatically.

The compiler only requires tokens for components the template graph actually references. An
unused dependency component with undefined tokens is not an error, and a real missing token is
reported against your project `designs/`, never against `node_modules`.

- [Zero-Cost](./zero-cost.md)
- [Optimizations](./optimizations/index.md)
- [Deploy](./deploy/index.md)
  - [Recipes](./deploy/recipes.md)
  - [Static hosts](./deploy/static-hosts.md)
  - [Planner](./deploy/planner.md)
  - [`vmz deploy`](./deploy/cli.md)
  - [Secrets & env](./deploy/secrets-env.md)
  - [Config reference](./deploy/config-reference.md)
- More guides and plugin docs live under `/d/`
