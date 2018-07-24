# vmz-formatter

Authoring formatter for `.vmz` SFCs: **oxc IR formatter** (not codegen pretty-print) plus **EditorConfig**.

|                |                                                          |
|----------------|----------------------------------------------------------|
| **Crate**      | `vmz-formatter`                                          |
| **Kind**       | library                                                  |
| **Publish**    | `false` (workspace-internal)                             |
| **CLI surface**| `vmz format` / `vmz format --check`                      |
| **Depends on** | [`vmz-compiler`](../vmz-compiler/) (parse / discover only) |

## Features

- Discover / format a file or project tree (`format_path`)
- Default **write**; `--check` only reports drift (cargo-fmt style — no `--write`)
- `<script lang=ts>` → `oxc_formatter::format` (text-in IR)
- `<style>` → `oxc_formatter_css` (`css` / `scss` / `sass`)
- Non-TS server DSL bodies are left alone (envelope trim / EOL only)
- Faithful SFC reassembly: `<router>` / `<meta>` / `lang` / attrs / block order
- Per-file **EditorConfig**: `indent_style`, `indent_size`, `tab_width`, `max_line_length`, `end_of_line`, `insert_final_newline`, `trim_trailing_whitespace`

## Non-goals

| Capability                         | Owner / note                                      |
|------------------------------------|---------------------------------------------------|
| Runtime JS emit / sourcemaps       | [`vmz-generator`](../vmz-generator/) (codegen)    |
| Soft/hard inspect                  | [`vmz-inspector`](../vmz-inspector/)              |
| Biome / Node `oxfmt` for `.vmz`    | Out of scope                                      |
| Parallel SFC parser                | Uses `vmz_compiler::parse_vmz`                    |

`vmz-compiler` must **not** depend on this crate (avoids a cycle with `Workspace`).

## Integration

```text
vmz-tools  `vmz format`  →  vmz_formatter::format_path
Node `vmz` → vmz-napi    →  vmz_formatter::format_path
```

oxc crates (including publish=false formatters) are locked to one git tag in the workspace root `Cargo.toml`.

## Development

```bash
cargo test -p vmz-formatter
cargo run -p vmz-tools -- format --check path/to/File.vmz
```

## License

MIT. See the workspace `license` field.
