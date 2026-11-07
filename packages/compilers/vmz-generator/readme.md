# vmz-generator

Artifact **CodeGenerators**: consume typed IR and print the final text VMZ ships (JavaScript, CSS, markup, JSON /
JSON5, YAML and Rust server units).

|             |                              |
|-------------|------------------------------|
| **Crate**   | `vmz-generator`              |
| **Kind**    | library                      |
| **Publish** | `false` (workspace-internal) |

## Features

- `js`: print JavaScript modules, collect specifiers, transpile printed TypeScript
- `css`: style artifact printers and scoping output
- `markup`: template and markup printers
- `json` / `lang`: JSON, JSON5, YAML and Rust-language units
- Deterministic text: same input IR produces byte-identical output

## Non-goals

- Parsing `.vmz` or building the Program Graph / Execution Plan
- Theme, layout or scale decisions (those happen before IR)
- Depending on `vmz-compiler`: artifacts flow from the compiler into this crate, never the reverse

## Development

```bash
cargo test -p vmz-generator
```

## License

MIT. See the workspace `license` field.
