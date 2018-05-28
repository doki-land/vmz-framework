# @vmz/plugin-monaco

## Bring an IDE-class editor to the browser

`@vmz/plugin-monaco` integrates Monaco for VMZ applications that genuinely need a rich code-editing experience: browser
IDEs, serious language playgrounds, configuration workbenches, and professional developer tools.

## When Monaco is the right answer

Monaco is familiar to many developers because it powers the editing experience behind VS Code. That capability comes
with a meaningful browser cost. It is the right choice when editing is central to the product and advanced editor
behavior justifies the payload; it is not the automatic choice for a small form field or a documentation snippet.

For lighter embedded editing, choose `@vmz/plugin-codemirror`. The distinction is intentionally product-oriented rather
than ideological: VMZ should let an application choose the right interaction tool while still keeping delivery and
resumption boundaries visible.

| Monaco is a strong fit for...               | Prefer CodeMirror for...                    |
|---------------------------------------------|---------------------------------------------|
| Browser IDEs and rich developer workbenches | Lightweight embedded editing                |
| Products where editing is the main task     | Documentation pages and smaller playgrounds |

## VMZ boundary

Monaco owns the editor experience. VMZ owns the surrounding page, its SSR fallback, the Island or client boundary that
loads Monaco, and the test and deployment evidence for that boundary. This prevents one rich widget from turning the
whole application into an eager client runtime.

## Features worth paying for 🚀

- Familiar IDE-style editing for developer audiences.
- A foundation for rich language services, diagnostics, navigation, and completion.
- Strong fit for multi-file playgrounds and browser workbenches.
- An interaction surface substantial enough to justify an isolated delivery boundary.

Monaco works best when users arrive to edit, inspect, or debug code. VMZ's Island and application boundaries make that tradeoff explicit: deliver the IDE when the user reaches the IDE experience.
