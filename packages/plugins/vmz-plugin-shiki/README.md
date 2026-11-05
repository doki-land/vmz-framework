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

`@vmz/plugin-shiki` resolves Shiki from the application. `shiki`, `@shikijs/langs` and `@shikijs/themes` (`>=3`) are
required peer dependencies, not bundled dependencies, so install them alongside the plugin:

```bash
pnpm add @vmz/plugin-shiki shiki @shikijs/langs @shikijs/themes
```

The runtime loads `shiki/core` plus explicitly imported grammar and theme modules, so a client bundle only carries the
grammars this plugin can actually resolve instead of every `bundle-full` language. Supported grammars:
`javascript`, `typescript`, `tsx`, `jsx`, `json`, `html`, `css`, `markdown`, `bash` (plus `text`/`plaintext`, which
Shiki serves without a grammar module). Supported themes: `vitesse-dark` (default) and `vitesse-light`. A theme outside
that set is rejected with an explicit error instead of being silently swapped. A TextMate adapter adds custom grammars
on top; it does not replace the application-level `shiki` install.

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
browser) and never vendored by the packer; when it fails to load, the runtime falls back to the built-in grammar set
above.

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
