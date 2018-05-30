# vmz-plugin-tailwind

Rust **Tailwind style engine** for VMZ. Collects `style:tw` / `@tailwind` registrations and lowers them through the VMZ
style pipeline.

|             |                                                        |
|-------------|--------------------------------------------------------|
| **Crate**   | `vmz-plugin-tailwind`                                  |
| **Kind**    | library (statically linked into the default toolchain) |
| **Publish** | `false`                                                |

## Dependency rule

```text
vmz-plugin-tailwind ──► vmz-compiler
vmz-compiler        ──✗──► vmz-plugin-tailwind   (forbidden)
```

The compiler exposes `TwCompiler` / registration hooks; the host wires this plugin in. Ordinary HTML `class` attributes
are **not** Tailwind unless they go through the TW entry points.

## Development

```bash
cargo test -p vmz-plugin-tailwind
```

## License

MIT. See the workspace `license` field.
