# @vmz/plugin-markdown-it

## Markdown documents and `<Markdown>` surfaces

`@vmz/plugin-markdown-it` registers the Markdown engine used by integrated documents (`/d/`) and the
`<Markdown>` / `engines.markdown` facade. It renders a deterministic CommonMark-ish subset and exposes heading,
link, and fence analysis for build-time document work.

## Install and register

The package depends on `markdown-it` directly, so no separate peer install is required.

```ts
import { defineConfig } from '@vmz/plugin';
import markdownIt from '@vmz/plugin-markdown-it';

export default defineConfig({
    plugins: [markdownIt()],
    engines: { markdown: 'markdown-it' },
});
```

Registering the plugin alone does not select the engine. Sites with `documents/` need both the plugin and
`engines.markdown: 'markdown-it'`, otherwise document mount fails at `vmz dev`.

## Options

All official plugins are factories: `pluginName(optional config)`. Calling `markdownIt()` keeps the deterministic
defaults.

| Option        | Default | Meaning                                        |
|---------------|---------|------------------------------------------------|
| `html`        | `false` | Allow raw HTML inside Markdown                 |
| `linkify`     | `true`  | Autoconvert URL-like text to links             |
| `typographer` | `false` | Typographic replacement of quotes and dashes   |
| `breaks`      | `false` | Convert single newlines to `<br>`               |

```ts
plugins: [markdownIt({ html: false, breaks: true })];
```

Options configure the build/SSR renderer before use. The materialized `<Markdown>` component keeps its own props
for per-instance behavior.

## VMZ boundary

markdown-it owns Markdown parsing and HTML generation. VMZ owns document structure, SSR, link validation, and
delivery. The plugin does not introduce a second link resolver or app router.
