# VMZ Applications

## Small applications that prove a larger model ✨

These packages are not a gallery-specific framework feature and they are not disposable API snippets. Each is a normal
VMZ application with its own identity, route graph, runtime, styles, server boundary, tests, and deployable root at `/`.

They answer the questions a potential VMZ user should be able to ask before adopting a framework: what does ordinary
state look like? What changes after SSR? How does a server capability appear in source? Can an interactive part arrive
without making every page interactive? What happens to styles and documents?

| Application         | What it demonstrates                      | Why it matters                                                                                 |
|---------------------|-------------------------------------------|------------------------------------------------------------------------------------------------|
| `hello`             | A minimal page and component relationship | VMZ begins with ordinary application code, not setup ceremony                                  |
| `counter`           | Field state and precise reactive updates  | Updates can target known bindings and regions rather than re-run a component tree              |
| `island`            | Event entries and selective resumption    | Interaction can arrive where it is needed instead of hydrating the entire page                 |
| `event-shell`       | A page with no eager framework JavaScript | Static delivery and later interaction are not competing application modes                      |
| `fullstack`         | UI-to-server capability boundaries        | Client and server behavior come from one program rather than two disconnected projects         |
| `vmz-style-tailwind` | Compiled utility styles and `/designs`    | Styling can be explicit compiler input without making utility strings the application language |
| `documents-fixture` | Locale-first project documentation        | Documentation can be a real VMZ content domain, not an external documentation stack            |
| `analysis`          | Deliberately difficult analysis cases     | VMZ must explain or safely widen when it cannot prove precision                                |

## Standalone first, composed when needed

An application here remains independently deployable at `/`. A separate host application may explicitly choose to list
or mount it under a route such as `/examples/counter`, `/docs`, or `/admin`. That prefix belongs to the host deployment;
it never leaks back into the child application's source.

This distinction is important. VMZ does not merge child applications into a shared component tree, shared runtime,
shared state, or flattened router. Composition is an application-level request boundary with one strong isolation
contract, not a menu of weaker “microfrontend modes.”

Some packages in this directory also serve focused compiler and regression coverage. That is intentional: examples
should remain close enough to real applications to expose the behavior that product users will actually rely on.

### What to look for

- **Read the source first.** The examples use ordinary VMZ application code, not hidden helper layers.
- **Inspect the boundary.** Notice where client behavior, server capability, SSR, and resumption begin and end.
- **Compare delivery.** The interesting question is not only what renders, but what work reaches the browser and when.

## Follow a learning path

| If you want to understand... | Start with... | Then inspect... |
|---|---|---|
| The component surface | `hello` | Props, automatic component discovery, and generated output |
| Reactive precision | `counter` | Which binding changes and which work stays idle |
| Progressive interaction | `event-shell` | `island` for stateful resumption and mixed delivery |
| Full-stack boundaries | `fullstack` | Server capability reachability, HTTP, and cancellation |
| Compiled styling | `vmz-style-tailwind` | How explicit utility style input meets `/designs` semantics |
| Native documentation | `documents-fixture` | Locale identity, page keys, and document checks |

## What these applications deliberately avoid

- No React-style hooks or `createX` state factories.
- No Vue runtime or component compatibility layer.
- No default VDOM or whole-component rerender path.
- No `import '*.vmz'` ceremony to make components exist.
- No hidden host prefix embedded in a mounted application's source.

The examples should feel pleasantly unsurprising to read. The sophistication belongs in what the compiler can prove and generate, not in extra author-facing rituals. 🔬
