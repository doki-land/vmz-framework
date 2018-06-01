# Official VMZ Plugins

## Bring established capabilities into a compiler-led application 🔌

VMZ plugins connect mature tools for mathematics, code highlighting, editors, diagrams, charts, and icons to native VMZ
applications. They exist because a full-stack framework should not require every project to rebuild a formula engine,
code editor, chart widget, or icon library from scratch.

The important part is the boundary: plugins extend an application through versioned contributions, while VMZ keeps
ownership of the Program Graph, execution boundaries, SSR/resume behavior, testing model, and deployment reasoning.
Installing a plugin should enrich the product without silently creating a second runtime architecture inside it.

## Choose by product need

| Need                                  | Plugin                   | When to choose it                                                                 |
|---------------------------------------|--------------------------|-----------------------------------------------------------------------------------|
| Fast, common mathematical typesetting | `@vmz/plugin-katex`      | Documentation and product surfaces that value speed and compact output            |
| Broad TeX compatibility               | `@vmz/plugin-mathjax`    | Advanced mathematical content where wider TeX coverage matters more than weight   |
| High-quality source code presentation | `@vmz/plugin-shiki`      | Guides, API references, tutorials, and source-driven content                      |
| A lightweight embedded editor         | `@vmz/plugin-codemirror` | Documentation playgrounds and tools where bundle cost matters                     |
| A full IDE-like editor                | `@vmz/plugin-monaco`     | Serious browser IDEs, code playgrounds, and professional editing tools            |
| Text-authored diagrams                | `@vmz/plugin-mermaid`    | Architecture, flow, sequence, and process documentation                           |
| Interactive data charts               | `@vmz/plugin-echarts`    | Dashboards, analytics, monitoring, and exploratory product data                   |
| Broad icon collections                | `@vmz/plugin-iconify`    | Product UI, navigation, and documentation that benefit from established icon sets |

## Plugin boundary

Official plugins extend a VMZ application through versioned contributions. State semantics, routing, server/client
placement, testing, and deployment stay on the VMZ spine — plugins enrich capabilities without becoming a second runtime
architecture.

That boundary is what lets a project use familiar ecosystem tools while keeping one analyzable, explainable program.

Each package README describes the practical tradeoffs of its adapter. Configuration and API reference belong in the user
documentation.

### A useful rule of thumb

- Choose **KaTeX** before MathJax unless TeX coverage is the deciding requirement.
- Choose **CodeMirror** before Monaco unless the editor itself is a central product feature.
- Choose **Mermaid** for reviewable explanatory diagrams, not for bespoke visual design.
- Choose **`<Echarts>`** for production interactive charts; DaVinci is parallel and not production-ready yet.
- Choose **Iconify** for breadth; choose curated local assets when control and offline delivery matter more.
- Only **math** and **code** get interchangeable `engines.*` facades (`<Math>` / `<Code>`). Editors, diagrams, charts,
  and icons are concrete components — no fake shared slot.

## What “native” should feel like

An official plugin should not feel like an iframe or an unrelated mini-application pasted into the page. It should
participate naturally in VMZ concerns:

- server-rendered content remains readable where the capability allows it;
- expensive browser code can stay behind an Island or interaction boundary;
- dependencies and assets remain visible to build and deployment tooling;
- tests can observe the user-facing result and its application boundary;
- failures produce VMZ diagnostics instead of disappearing inside a generic transform hook.

## A small ecosystem with clear choices

VMZ does not need three official adapters for every popular library. The useful ecosystem is one where each integration
answers a distinct product need and its tradeoffs are easy to explain. Community packages can expand that range through
the same contribution protocol without making the official namespace a popularity leaderboard.

The result should feel curated rather than restrictive: fewer accidental choices, clearer defaults, and room for
specialized tools when a real product requires them. ✨
