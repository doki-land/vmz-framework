# vmz-iris-adapter

Thin Rust bridge from the VMZ workspace to Iris TypeScript generation. Callers pass a raw VOS schema string and
receive a deterministic file map plus a schema fingerprint, without shelling out.

|             |                              |
|-------------|------------------------------|
| **Crate**   | `vmz-iris-adapter`           |
| **Kind**    | library                      |
| **Publish** | `false` (workspace-internal) |

## Features

- One entry point from a VOS schema string to generated file contents
- Stable file ordering and a fingerprint for drift checks
- No CLI wiring, no server integration, no filesystem I/O

## Non-goals

- Owning Iris' generator semantics
- Building a parallel schema parser
- Writing generated files: the caller decides where output lives

## Development

```bash
cargo test -p vmz-iris-adapter
```

## License

MIT. See the workspace `license` field.
