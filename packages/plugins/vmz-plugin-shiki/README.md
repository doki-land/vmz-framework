# @vmz/plugin-shiki

## Code examples that are part of the reading experience

`@vmz/plugin-shiki` brings Shiki's high-quality syntax highlighting to VMZ applications. It is designed for guides, API
reference, technical blogs, source browsers, tutorials, and any product surface where code is meant to be read
carefully.

## Why Shiki fits VMZ documents

Code snippets should remain useful before a page becomes interactive. Shiki supports a content-first experience: source
can be highlighted as part of the rendered document instead of relying on a browser-only code viewer to make a page
readable.

For VMZ examples, the plugin can share the same language presentation used by VMZ editor tooling. That consistency helps
readers move from documentation to a real `.vmz` file without relearning the visual grammar.

It is especially useful for:

- product documentation that must be readable before interaction starts;
- API and configuration references where source is the main content;
- tutorials that move between prose and real VMZ components;
- source browsers that need trustworthy language presentation.

## Install

`@vmz/plugin-shiki` resolves Shiki from the application. `shiki` (`>=3`) is a required peer dependency, not a
bundled dependency, so install it alongside the plugin:

```bash
pnpm add @vmz/plugin-shiki shiki
```

The runtime loads plain `shiki` by default (a literal dynamic import that client bundles can vendor). A TextMate
adapter adds custom grammars on top; installing `@shikijs/*` transitively through an adapter does not replace the
application-level `shiki` install.

## Third-party TextMate grammar (VMZ-2)

Custom grammars (VMZ, VOS, …) come from an explicit adapter module id that the host must resolve:

```ts
import shiki from '@vmz/plugin-shiki';

export default defineConfig({
  plugins: [shiki({ textmate: '@game-gpt/vos-textmate/shiki' })],
  engines: { code: 'shiki' },
});
```

The adapter specifier is host-resolved (serve-host resolve hooks on Node, an import map or vendor copy in the
browser) and never vendored by the packer; when it fails to load, the runtime falls back to plain `shiki`.

The plugin writes `dist/_vmz/plugin-shiki.config.json`; the runtime reads it in SSR (`VMZ_DIST`) and in the browser (`fetch`).

## VMZ boundary

Shiki owns source presentation. VMZ owns document structure, SSR, optional interaction, testing, and delivery. The
plugin should make code easier to understand without becoming a parallel application runtime.

## A content-first feature set 🎨

- **Readable SSR:** highlighted source can arrive with the page instead of flashing into place later.
- **VMZ consistency:** examples can share the grammar readers see in their editor.
- **Theme-aware presentation:** technical content can belong to the surrounding design.
- **Graceful fallback:** source remains readable when rich highlighting is unavailable.

Use Shiki where code itself is part of the product. If users are meant to edit the code, pair the reading experience
with CodeMirror or Monaco rather than stretching a highlighter into an editor.
