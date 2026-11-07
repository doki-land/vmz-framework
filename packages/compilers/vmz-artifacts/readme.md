# vmz-artifacts

Parse, validate and query the build artifacts VMZ emits (`vmz-deployment.json`, server and static delivery documents),
with deterministic answers shared by the CLI, the N-API bridge and conformance gates.

|             |                              |
|-------------|------------------------------|
| **Crate**   | `vmz-artifacts`              |
| **Kind**    | library                      |
| **Publish** | `false` (workspace-internal) |

## Features

- Deployment documents: component entries, `dependsOn` closure, parse and validate
- Server artifact and static delivery views over the same schema ids
- Stable errors instead of panics when an artifact is malformed or out of date

## Non-goals

- Producing artifacts (that is `vmz-pack` and the generator surfaces)
- Semantic types and schema ids (owned by `vmz-compiler` / `vmz-protocol`)
- Filesystem policy: callers decide where an artifact lives and when to write it

An artifact whose schema id or shape does not match the current contract is rejected, not upgraded.

## Development

```bash
cargo test -p vmz-artifacts
```

## License

MIT. See the workspace `license` field.
