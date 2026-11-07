# vmz-pack

Rust foundation of the in-house bundling chain: module facts, module resolution, a reachable module graph, statement
level liveness, deterministic multi-entry chunking, and artifact emission.

|             |                              |
|-------------|------------------------------|
| **Crate**   | `vmz-pack`                   |
| **Kind**    | library                      |
| **Publish** | `false` (workspace-internal) |

## Pipeline

```text
module   source → module facts
resolve  specifier + context → module identity
graph    entries → reachable module graph
link     statement-level liveness fixed point
chunk    keep set → deterministic multi-entry chunk plan
emit     chunk plan → JS text, file names, fingerprints, manifest, writes
```

## Features

- Chunk-level acyclic output: dependencies of an opaque module are promoted to `split/…` upstream chunks
- Whole-file emission for opaque modules keeps every import pointing at the chunk that owns the module
- Line-level v3 source maps for active statement slices
- Explicit diagnostics instead of silent fallbacks when a semantic cannot be expressed in text

## Non-goals

- Regex-based module semantics: this crate consumes Oak syntax facts only
- Claiming code splitting is complete while semantics remain conservative
- Being a general-purpose bundler for other ecosystems

## Development

```bash
cargo test -p vmz-pack
```

## License

MIT. See the workspace `license` field.
