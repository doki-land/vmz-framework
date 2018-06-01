# @vmz/plugin

## Build extensions without dissolving the application boundary

`@vmz/plugin` is the foundation for authors who want to extend VMZ with a domain capability: a renderer, a content
processor, a language integration, an editor, a design-oriented utility, or another contribution that belongs in a
full-stack application workflow.

## The promise to plugin authors

VMZ should be hospitable to npm and JavaScript ecosystem packages. You should be able to package, version, distribute,
and compose useful functionality with normal Node tooling. A plugin can contribute declared capabilities and source
assets without forcing every project to adopt a bespoke compiler fork.

## The promise to application authors

Extensions stay transparent to the application model. A VMZ plugin is a versioned contribution surface — not an
unrestricted `transform(code)` escape hatch or an in-place rewrite of the program graph. Declared contributions keep
ownership, execution placement, SSR, resume, testing, diagnostics, and deployment explainable.

This is the tradeoff: plugin authors gain a stable way to participate in VMZ, while users retain a coherent application
model after installing the plugin. If an integration requires arbitrary runtime injection or hidden semantic rewrites,
it belongs outside the core VMZ plugin contract.

| A plugin contributes...                            | So that VMZ can still...                           |
|----------------------------------------------------|----------------------------------------------------|
| A declared capability with known inputs and output | Keep one application runtime and Program Graph     |
| Versioned integration behavior                     | Explain ownership, placement, and diagnostics      |
| Assets or adapters VMZ can place and test          | Honor server, lifecycle, and deployment boundaries |

## Who should use it

Use this package when you are creating a native VMZ integration, not when you simply need a conventional JavaScript
library in application code. The latter should remain a normal dependency unless it needs to participate in VMZ's
compiler-visible boundaries.

## What a strong plugin can unlock 🚀

- A content engine can contribute deterministic rendered output and diagnostics.
- An editor can declare browser-only delivery while preserving an SSR-readable host.
- A design tool can expose compile-time tokens without becoming a global runtime store.
- A deployment adapter can contribute a target without rewriting application semantics.
- A testing integration can add evidence while preserving VMZ's test model.

## Why contribution beats mutation

Mutation is convenient for the first plugin and expensive for the fiftieth. If every plugin can rewrite any source,
graph node, or generated artifact, composition order becomes application semantics and no tool can explain the final
result.

A contribution says what capability is being added, which versioned schema it follows, what it reads, what it emits, and
where it may execute. That extra structure is what allows npm extensibility and strong compilation to coexist.

## The litmus test

If installing the plugin makes `vmz check`, SSR, resume, tests, or deployment less able to explain the application, the
integration is using the wrong boundary. A native plugin should leave VMZ more capable, not less coherent.
