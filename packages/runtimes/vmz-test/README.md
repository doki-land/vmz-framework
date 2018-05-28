# @vmz/test

A test that only says “the button now says 2” leaves important product questions unanswered. Did the write also wake
unrelated UI? Did navigation dispose the old async task? Did the browser replay work that SSR had already done? Did a
server-only dependency find its way into the client?

`@vmz/test` is VMZ's answer to those questions. It tests against the same Program Graph and execution plan that produce
browser output, SSR, resumption, and deployment. That lets a scenario cover ordinary logic and real browser input, but
also routes, loading, cancellation, server capabilities, SSR/resume identity, and traces of the regions that actually
performed work.

What that gives a product team:

- **Behavioral confidence:** users can navigate, submit, and interact as expected.
- **Boundary confidence:** server-only work remains server-only; routes and capabilities resolve where they should.
- **Delivery confidence:** SSR and resume describe the same application without accidental replay.
- **Performance confidence:** a trace can show whether unrelated regions woke up.

The point is not to reject useful tools such as Vitest, Jest, or Playwright. They can remain valuable during migration
or as browser transport. They do not, however, define what VMZ means by a correct application. VMZ keeps that meaning in
one graph and one execution plan, so a failure can be traced to the actual boundary that failed rather than flattened
into a generic test callback.

Choose `@vmz/test` when you want tests to protect the architectural promises that made you choose VMZ: precise work,
safe server boundaries, SSR that does not needlessly replay, and application behavior that can be explained. 🧪

## One scenario, several kinds of evidence

| Surface | Evidence VMZ can collect |
|---|---|
| Compile | Diagnostics, graph identities, and generated boundaries |
| Logic | State transitions, derived work, and cancellation |
| Browser | Real input, semantic locators, DOM, accessibility, and screenshots |
| Router | Matched RouteId, layout retention, loading, errors, and disposal |
| SSR / Resume | HTML, serialized state, event entries, and replay avoidance |
| Deployment | Client/server reachability, capabilities, artifacts, and traces |

### UI automation without a borrowed worldview

VMZ can use a real browser protocol as transport while owning locator, action, waiting, and expectation semantics. Tests can find elements by role, label, text, RouteId, or stable test identity; CSS remains an escape hatch rather than the default contract.

Auto-waiting can observe navigation, pending work, region commits, and server activity instead of guessing with arbitrary delays. A failure can connect the visible symptom to the application work that produced it.

### Precision is testable

A fine-grained compiler should prove that nothing unrelated ran. VMZ tests can check that the intended binding changed, unrelated computations stayed idle, an obsolete generation was cancelled, and a disposed owner received no late write. That turns testing into a competitive feature rather than a bundled convenience.

## License

MIT
