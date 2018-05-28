# VMZ

## A full-stack application compiler for TypeScript ✨

VMZ is a new kind of web framework: a full-stack application compiler. You write readable `.vmz` components and ordinary
TypeScript; VMZ understands the application as a whole and compiles it into direct browser updates, server work, SSR
output, resumable interaction, tests, and deployment artifacts.

Its source surface is intentionally familiar to developers who like template-based components, but VMZ is native in its
semantics. It is not a Vue dialect, a React compatibility layer, or a new signal API. A `public` class field is a prop;
ordinary fields are state; the compiler derives the update and execution boundaries.

| Write                          | VMZ understands                               | VMZ can produce                                            |
|--------------------------------|-----------------------------------------------|------------------------------------------------------------|
| Components and ordinary fields | State, props, reads, writes, and control flow | Direct DOM patches instead of a default VDOM diff          |
| Events and async methods       | Ownership, cancellation, and effects          | Safe lifetime and stale-result handling                    |
| Server capabilities and routes | Execution and serialization boundaries        | Client/server partitions, SSR, HTTP, and deployment output |
| Pages and interaction          | What must arrive now and what can wait        | Static HTML, Islands, and selective resumption             |

```vmz
<template>
  <article>
    <p if={!user}>Loading profile...</p>
    <section else>
      <h2>{user.name}</h2>
      <p>{user.bio}</p>
      <button type="button" onClick={() => refresh()}>Refresh</button>
    </section>
  </article>
</template>

<script client>
import type { User } from '#server/db/users'
import { ProfileServer } from '#server/components/Profile'

export default class Profile {
  user!: User

  async onMount() {
    this.user = await ProfileServer.load()
  }

  async refresh() {
    this.user = await ProfileServer.load()
  }
}
</script>

<script server>
import type { User } from '#server/db/users'
import { UsersRepository } from '#server/db/users'

export default class ProfileServer {
  #users = new UsersRepository()

  async load(): Promise<User> {
    return this.#users.findCurrent()
  }
}
</script>
```

This is one component and one authoring flow, but not one runtime bundle. VMZ sees the browser state, the server
capability, the data boundary, the asynchronous generation, and the exact UI regions affected by `user`.

| From this source, VMZ can... | Result |
|------------------------------|--------|
| Separate the client and server dependency closures | The repository and its secrets never enter browser output |
| Preserve the `User` contract across the capability edge | Calls and serialization can be checked from the same program |
| Use the real server method during SSR | Server rendering does not need to call itself over HTTP |
| Generate a browser RPC stub for `ProfileServer.load()` | Client code keeps a typed call without importing server implementation |
| Bind each request to an async generation and owner | A stale response cannot overwrite a newer page or disposed region |
| Connect `user` writes to the loading branch and profile bindings | The browser patches affected regions instead of rerunning an unrelated tree |

In VMZ, ordinary class fields are state. A `public` field is a prop. You do not start by wrapping every value in a
signal, `ref`, store, hook, or factory. The compiler analyzes reads, writes, calls, control flow, ownership, and execution
placement, then emits the smallest safe full-stack plan it can prove.

## Why it matters

Most web stacks assemble an application from separate answers to separate questions: a view runtime, a router, a server
bridge, a data-fetching convention, an SSR layer, a test runner, and a deployment tool. Those tools can work well
together, but they usually do not share one semantic model of the application.

VMZ takes a different route. UI, state, events, asynchronous work, server capabilities, route boundaries, SSR,
resumption, tests, and deployment are intended to be views of one **VMZ Program Graph**. That gives the compiler enough
context to make decisions that disconnected tools cannot reliably make:

- update only the bindings and regions affected by a write;
- keep server-only dependencies out of client output;
- retain SSR work instead of replaying the whole component tree in the browser;
- cancel stale asynchronous work when its owner disappears;
- explain why a line of code was bundled, an Island was activated, or a dependency became conservative.

The outcome is not just faster DOM work. It is an application model that stays coherent as the product grows:
**provable, partitionable, generatable, resumable, and explainable**. 🔍

## How it differs

| Approach                                   | Primary model                                                  | What VMZ changes                                                                                                                     |
|--------------------------------------------|----------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------|
| React                                      | Components execute with runtime state APIs and reconciliation  | VMZ analyzes ordinary TypeScript state and emits direct region updates instead of default tree re-execution and VDOM diffing         |
| Vue                                        | Component runtime, reactivity APIs, VDOM, and an ecosystem ABI | VMZ keeps a familiar template feel but is not Vue-compatible and does not adopt Vue runtime, component, macro, or reactive contracts |
| Solid and other fine-grained UI frameworks | A reactive graph is built primarily at runtime                 | VMZ aims to construct a compiler-visible graph that spans UI, server capability, SSR, resumption, and deployment                     |
| Conventional full-stack stacks             | Several specialized tools connected by conventions             | VMZ treats cross-stack boundaries as compiler facts derived from one program, not as unrelated integration layers                    |

VMZ is therefore not “Vue without VDOM,” nor a React replacement with different state helpers. It is an attempt to make
the full application, rather than only the browser view, a first-class compilation target.

## What this changes in a real product

### Stop paying for unrelated updates

Write normal TypeScript classes. The language remains standard TypeScript, powered by oxc; VMZ adds application
semantics around components, state, props, templates, server boundaries, and deployment. When precision can be proven,
VMZ follows property paths, control flow, and keyed list items. When it cannot, it must widen safely and explain why
rather than silently miss an update.

### Stop treating client and server as separate applications

Server code is not an unrelated second project. VMZ models server work as an explicit capability boundary. The compiler
can track calls, serialization, deployment reachability, and accidental client leakage from the same source-level
program.

### Stop replaying work the server already completed

VMZ targets resumption: the browser should attach only the state, event entry, and region needed for actual interaction.
Static content should not pay for a framework runtime simply because it was rendered by a framework.

### Stop testing only the fragments your tools happen to expose

`vmz test` is designed around the Program Graph and execution plan. It can validate compile behavior, logic, browser
interactions, SSR, resumption, and deployment evidence without making a third-party test runner the definition of VMZ
behavior.

### Stop accepting “the framework did something” as the final answer

The long-term promise is not opaque optimization. Tooling should be able to answer: “why did this update?”, “why is this
code client-side?”, “why is this Island here?”, and “what blocks a smaller bundle?”

## The VMZ experience

- **Write less framework ceremony.** Keep application state in ordinary fields instead of constructing signal and hook
  plumbing around every value.
- **Ship less accidental browser work.** Static content can remain static, while interactive regions arrive when they
  are actually needed.
- **Keep full-stack boundaries visible.** Server capabilities, routes, async work, and deployment are compiler facts,
  not scattered conventions.
- **Debug decisions, not guesses.** The compiler model is designed to expose the provenance behind updates, output, and
  conservative fallbacks.

## A closer look at the features 🚀

### Reactive by language, not by ritual

VMZ treats ordinary fields, assignments, getters, branches, and list access as analyzable program behavior. There is no required hook ordering and no need to choose a state container before a button can be reactive. Where the program proves it, dependencies can refine to property paths, control regions, and keyed items.

### Native output instead of a permanent interpreter

Browser output is designed around direct operations: create a region, patch a binding, switch a branch, reconcile a keyed structure, attach an event, and dispose an owner. Production should not need to interpret a generic component blueprint on every update.

### Full-stack boundaries that can be inspected

A server call is more than a fetch wrapper. VMZ can connect the calling event or page to the server capability, serialization boundary, secret-bearing dependencies, deployment unit, and resulting UI work. This makes safer partitions and useful diagnostics possible.

### Routes, documents, and design belong to the application

Pages, metadata, layouts, loading boundaries, localized project documents, and stable links are compiler-visible. Project tokens, themes, styles, and design notes have an explicit `/designs` home. VMZ does not need unrelated frameworks to make an application navigable, documented, and visually coherent.

### Evidence before benchmark theatre

VMZ does not currently use invented or selective benchmark numbers as proof. The stronger targets are observable: unrelated regions perform zero work, server-only dependencies stay out of client artifacts, stale async results cannot write after cancellation, and resumption does not replay completed SSR work. These properties can be tested and explained as the implementation matures.

## Who VMZ is for

VMZ is a good fit for teams that want to build durable TypeScript applications and care about the boundary between
authoring ergonomics and runtime cost. It is especially relevant when you want a clear model for SSR, server execution,
async ownership, progressive interaction, and deployment rather than a collection of framework-specific conventions.

It is not the right choice when your priority is compatibility with the React or Vue component ecosystems. VMZ
deliberately does not provide that compatibility layer; preserving static understanding matters more than accepting
every existing runtime pattern.

| Choose VMZ when...                                                              | Consider another route when...                                              |
|---------------------------------------------------------------------------------|-----------------------------------------------------------------------------|
| You want one compiler-visible model across UI, server, SSR, tests, and delivery | You need to reuse React or Vue components and their ecosystem contracts     |
| You value direct, explainable updates over runtime flexibility by default       | You require unrestricted runtime metaprogramming as the primary design tool |
| You are building a new TypeScript application                                   | You are looking for a drop-in migration layer                               |

## Explore VMZ

The VMZ site, documentation, and running applications are themselves built with VMZ. They are the best place to see the
model applied to state, documents, styling, server boundaries, and progressive interaction instead of merely reading
claims about it.

VMZ is for early adopters who want to evaluate a new application architecture, not for teams looking for a compatibility
layer over existing React or Vue code. If the model resonates, begin with the product documentation and the runnable
applications.

## License

MIT
