# VMZ Homepage

## Eat our own dog food, without a special escape hatch 🌐

Framework sites often make a promise their own product does not have to keep. The marketing site may use one stack, the
documentation another, examples a third, and the framework itself a fourth. That makes the first thing a potential user
sees poor evidence of what the framework can really do.

The VMZ homepage solves that problem by being an ordinary VMZ application. It uses no “homepage mode,” no privileged
documentation runtime, no gallery-specific router, and no private deployment shortcut. Its pages, documents, examples,
styles, SSR output, resume boundaries, and server behavior are built from the same general VMZ capabilities available to
every application.

| What a visitor sees          | What VMZ is actually exercising               |
|------------------------------|-----------------------------------------------|
| Product pages and navigation | Ordinary pages, routes, layouts, and SSR      |
| Localized documentation      | The native document content model             |
| Application collections      | Explicit metadata and ordinary host UI        |
| Interactive examples         | Isolated applications with normal route bases |
| Syntax-highlighted source    | The same language assets used in editors      |

## What readers can trust it to demonstrate

When the site renders documentation, that is VMZ's document model. When it presents a collection of applications, that
is ordinary application composition with explicit metadata and isolated mounts. When an interactive region appears, it
follows the same progressive delivery and resume model as a product application. When a page works without eager
framework JavaScript, it is because the application was compiled that way, not because the site received a one-off
exception.

This is the practical meaning of eating our own dog food: the public site is not a polished wrapper around the
framework. It is a living VMZ application that must live with the same strengths, limitations, and guarantees as its
users. ✨

For a reader evaluating VMZ, that makes the site more than a brochure: it is the first working example to inspect.

## The site as a capability map 🗺️

- **The landing experience** exercises ordinary VMZ pages, layouts, metadata, styles, and server rendering.
- **The documentation** exercises locale-first content, navigation, code fences, search-ready metadata, and stable page
  identity.
- **The examples index** is ordinary host UI over an explicit application collection. VMZ does not generate its cards or
  categories.
- **Each mounted application** remains independently deployable and owns its own graph, routes, runtime, styles, state,
  and server behavior.
- **Interactive areas** exercise the same Island and resume decisions available to product applications.

## Why no specialization is a product feature

A special homepage pipeline would make the site easier to fake and harder to trust. By refusing that shortcut, every
limitation found while building the site becomes feedback for a general VMZ capability. Better documents improve project
documents. Better example mounting improves application composition. Better source presentation improves every technical
product built with VMZ.

That creates useful pressure: the public experience cannot outrun the framework by secretly using a better stack. 🐾

## What success looks like

Visitors should be able to understand VMZ without installing it, inspect working applications without first learning how
the project is organized, and move from a product claim to a real page that demonstrates it. The site earns confidence
by being evidence, not by publishing implementation trivia.
