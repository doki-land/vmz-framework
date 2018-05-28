# VMZ for VS Code

## Make VMZ source readable from the first file ✨

VMZ for VS Code brings the VMZ language surface into the editor: `.vmz` components and VMZ fenced code in Markdown
receive a consistent, purposeful language presentation.

That is more than cosmetic. VMZ source deliberately places template structure, normal TypeScript, client/server
boundaries, and page metadata near each other. An editor should make those boundaries legible before a developer needs
to understand the compiler internals.

## What makes it different from a framework compatibility extension

This extension is for native VMZ source. It does not pretend that VMZ is a Vue dialect, nor does it attempt to make a
React or Vue language service interpret a different component model. The goal is a clean experience for VMZ's own
language and application semantics.

The extension shares its language definition with VMZ documentation, so examples on the public site and files in the
editor describe the same source language. As VMZ's semantic tooling grows, the editor is also the natural place for
source-level explanations such as why a dependency widened or why code belongs to a particular execution boundary.

Use it if you want to explore VMZ in the place where most framework decisions become tangible: a real component file. 🧭

## What the editor experience should become

- **Source-aware diagnostics** that point to the actual template, field, route, or server span.
- **Safe navigation and rename** across components, RouteIds, links, capabilities, and tests.
- **Boundary visibility** for code that reaches the browser, server, SSR, or a resumable Island.
- **Causal explanations** for widened dependencies, unexpected work, and deployment inclusion.
- **One visual language** across `.vmz` files and VMZ examples embedded in Markdown.

## Why this can go beyond autocomplete

Most framework extensions reconstruct meaning from conventions after the compiler has already made its choices. VMZ's advantage is that editor tooling can query the same provenance and program graph used for generation. The goal is not merely more completion items; it is an editor that can answer why the application behaves as it does. 🔍

For newcomers, syntax clarity lowers the first barrier. For experienced teams, semantic explanations can eventually make large full-stack applications safer to change.
