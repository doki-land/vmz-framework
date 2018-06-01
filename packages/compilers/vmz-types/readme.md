# vmz-types

VMZ-specific **semantic types** layered on the [oxc](https://github.com/oxc-project/oxc) toolchain.

|             |                              |
|-------------|------------------------------|
| **Crate**   | `vmz-types`                  |
| **Kind**    | library                      |
| **Publish** | `false` (workspace-internal) |

## Features

- Types oxc does not provide: component/field kinds, program-IR oriented structures, VMZ-facing enums, etc.
- Shared vocabulary for [`vmz-compiler`](../vmz-compiler/) and downstream crates

## Scope

- Reuses oxc `Span`, source-file, and diagnostic primitives rather than defining parallel ones
- Types only — no compile / check / explain pipelines
- Wire-schema catalogs live in [`vmz-protocol`](../vmz-protocol/)

## Development

```bash
cargo check -p vmz-types
cargo test  -p vmz-types
```

## License

MIT. See the workspace `license` field.
