# Zero-Cost

**Zero-Cost** means finishing what can be proven statically at compile time, and diagnosing or taking a conservative
path when it cannot — without silently re-rendering a whole tree or adding another runtime API layer.

Authors write ordinary fields and templates; dependency analysis and Direct scheduling are done by the compiler.
Hot-path optimizations land on convention-shaped, analyzable forms.

Slogan: **Convention over configuration** · Vue-Familiar · Multi-Platform · Zero-Cost

## Related optimizations

- [Dependency graph](./optimizations/dep-graph.md)
- [Direct schedule emit](./optimizations/direct-schedule.md)
- [Row kernel](./optimizations/row-kernel.md)
- [Keyed list reconcile](./optimizations/keyed-list.md)
- [Event-delegation contract](./optimizations/event-delegate.md)
- [Host class precision](./optimizations/host-class.md)
- [Client without Plan](./optimizations/client-plan.md)

## Common patterns

- Lists: **`each` + a stable `key`**, structurally static item templates
- Selection / highlight: **`this.<host> === item.<field> ? … : …`**
- State: ordinary fields; thick logic: `.ts` / `server/`
- Mocks / fake data: `<script server>` / `#server`

## Further reading

- [Getting started](./index.md)
- [Optimizations](./optimizations/index.md)
- [Official plugins](../plugins/index.md)
