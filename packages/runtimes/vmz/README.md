# VMZ CLI

When a project reaches the point where it has a browser surface, SSR, server work, documents, tests, and several
deployment concerns, the usual workflow becomes a chain of tools that each see a different version of the application. A
build may pass while a route boundary is wrong; a browser test may pass while SSR work is replayed; a plugin may
transform code without anyone being able to explain the delivery result.

`vmz` is the command-line home for a different workflow. Development, checking, building, serving, testing, document
generation, and deployment output all begin from VMZ's understanding of the same application. The useful unit is not
only a module graph. It is a program with state reads and writes, control regions, routes, server capabilities,
ownership, and delivery boundaries.

That means the CLI can grow into something more useful than a collection of commands: it can say why a change affects a
region, why code was placed on the client, why a conservative boundary was used, or why a route and its server work
belong together. ⚡

With VMZ, a normal workflow is expected to answer all of these from the same source program:

- **Develop:** which application regions are affected by a change?
- **Check:** which state, route, server, or lifecycle boundary is unsafe?
- **Build:** what belongs in browser, SSR, resume, and server output?
- **Test:** what did a user interaction actually cause?
- **Explain:** why did the compiler make that decision?

Use it when you are adopting VMZ as the application model. It is intentionally not a compatibility compiler for
arbitrary Vue components, React hooks, or legacy VDOM applications; those ecosystems are better served by their native
toolchains.

## One tool, several views of the same program

| Workflow | The question it should answer |
|---|---|
| Development | What changed, and which application regions are affected? |
| Checking | Which state, route, server, or lifetime boundary cannot be proven? |
| Building | What belongs in browser, SSR, resume, and server output? |
| Testing | Did the application behave correctly and avoid unrelated work? |
| Documents | Are project documents connected, localized, and deployable? |

### Designed for the npm world

VMZ does not ask users to abandon JavaScript packaging. Node remains the npm, plugin, development-server, and orchestration host. A long-lived N-API bridge connects that ecosystem to Rust and oxc without reducing semantic analysis to a sequence of tiny file transforms.

### More than pass or fail

The interesting future of the CLI is explanation. A useful compiler should expose the source span, graph edge, owner, deployment boundary, and fallback reason behind a decision. That is a better developer experience than adding more colored output to an opaque build. 🧭

## License

MIT
