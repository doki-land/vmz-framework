# @vmz/core

The browser should not have to rediscover an application's structure after every click. Yet that is the default cost of
many UI systems: execute components again, compare a virtual tree, and infer which DOM work might be necessary.

`@vmz/core` is the production runtime behind VMZ's alternative. It executes the creation, patch, SSR, resumption, HTTP,
and lifetime schedules produced by the compiler. When VMZ can prove that a write affects one text binding, one control
region, or one keyed item, the runtime can update that target directly rather than begin from a whole component tree.

The same idea continues beyond a single browser update. SSR serializes planned regions; resumption attaches only
reachable state and event entries instead of repeating completed server work; ownership regions give async tasks and
resources a deterministic end; server and HTTP output stay tied to compiler-visible capabilities.

| Instead of...                      | VMZ runtime work begins from...                       |
|------------------------------------|-------------------------------------------------------|
| Re-running a component tree        | A known affected binding or region                    |
| Reconciling a generic virtual tree | Direct create, patch, switch, or keyed-list work      |
| Hydrating every rendered component | The event and state entries that are actually reached |
| Hoping cleanup follows callbacks   | A compiler-known ownership and disposal boundary      |

For application authors, this mostly stays out of sight: write VMZ source and let the compiler generate the plan.
`@vmz/core` matters when you care about the kind of runtime your product ships: small in responsibility, direct in
execution, and able to account for why its work exists. 🌱

## The hot path VMZ is aiming for

```text
state write
  -> known dependency edge
  -> affected computation or region
  -> direct patch / switch / reconcile
```

There is no default detour through “execute every component that might matter, build virtual nodes, then compare them.” If analysis must widen, it widens to a safe region and should preserve the reason.

## More than DOM updates

- **Transactions:** related writes can settle before dependent work runs.
- **Ownership:** branches, list items, resources, and tasks have a known lifetime.
- **Cancellation:** an obsolete navigation or async generation cannot write into new state.
- **Resumption:** the browser attaches to server-produced work at the smallest reachable boundary.
- **Zero-JS delivery:** pages with no interactive requirement do not need an eager framework shell.

The runtime should not grow a second compiler made of reflection, string dependencies, or generic proxies. Its quality comes from faithfully executing the generated plan while keeping the production surface focused.

## License

MIT
