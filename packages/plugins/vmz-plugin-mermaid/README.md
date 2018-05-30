# @vmz/plugin-mermaid

## Keep architecture and process diagrams close to the text 📊

`@vmz/plugin-mermaid` brings Mermaid diagrams to VMZ documents and applications. It is useful when architecture, flows,
sequences, and state transitions should evolve in the same reviewable source workflow as the text that explains them.

## Why text-authored diagrams matter

For engineering and product documentation, a diagram is often part of the argument rather than decoration. Keeping its
source beside the surrounding document makes changes searchable, reviewable, localizable, and testable. It also lets a
VMZ project treat diagrams as content with known delivery and rendering boundaries.

Mermaid is especially appropriate when clarity and maintainability matter more than hand-crafted illustration. For
highly custom data visualization or brand artwork, use the rendering technology that best fits that job instead of
forcing everything through a text diagram language.

Great uses include:

- architecture and dependency maps;
- user and system flows;
- state and lifecycle diagrams;
- sequence diagrams that change with the design.

## VMZ boundary

VMZ keeps the page readable on the server and can defer client-side diagram work to the point where it is useful.
Mermaid adds diagram capability; it does not redefine VMZ document, routing, state, or SSR semantics.

## Why teams keep diagrams in text

| Pain                                             | Text-authored result                                |
|--------------------------------------------------|-----------------------------------------------------|
| A renamed service leaves an exported image stale | The diagram changes in the same review as the prose |
| Localization requires separate image editing     | Labels remain part of the content workflow          |
| Architecture history is hard to inspect          | Version control shows structural changes            |
| A document is rendered in several targets        | The same source can be transformed consistently     |

Mermaid will not replace bespoke product visualization, but it is unusually effective for diagrams whose job is to
explain rather than impress. That makes it a natural companion for VMZ documents. 📚
