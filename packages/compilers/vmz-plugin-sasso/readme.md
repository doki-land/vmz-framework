# vmz-plugin-sasso

Rust **SCSS style engine** for VMZ, backed by [sasso](https://github.com/savonet/sasso). Default language for `<style>`
blocks when no `lang` is set.

|             |                                                        |
|-------------|--------------------------------------------------------|
| **Crate**   | `vmz-plugin-sasso`                                     |
| **Kind**    | library (statically linked into the default toolchain) |
| **Publish** | `false`                                                |

## Dependency rule

```text
vmz-plugin-sasso ──► vmz-compiler
vmz-compiler     ──✗──► vmz-plugin-sasso   (forbidden)
```

Injection is via `ScssCompiler` handles on the compiler side—never a hard engine dependency inside `vmz-compiler`.

## Development

```bash
cargo test -p vmz-plugin-sasso
```

## License

MIT. See the workspace `license` field.
