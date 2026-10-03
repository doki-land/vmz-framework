# vmz-types

VMZ semantic types shared by the compiler and artifact generators.

|             |                              |
|-------------|------------------------------|
| **Crate**   | `vmz-types`                  |
| **Kind**    | library                      |
| **Publish** | `false` (workspace-internal) |

## Features

- Component and field kinds, program IR, and VMZ-facing enums
- Shared vocabulary for [`vmz-compiler`](../vmz-compiler/) and downstream crates

## Scope

- Source locations use standard-library UTF-8 byte ranges within a source unit
- Parser AST and source-type configuration remain frontend implementation details
- Types only — no compile / check / explain pipelines
- Wire-schema catalogs live in [`vmz-protocol`](../vmz-protocol/)

## Development

```bash
cargo check -p vmz-types
cargo test  -p vmz-types
```

## License

MIT. See the workspace `license` field.
