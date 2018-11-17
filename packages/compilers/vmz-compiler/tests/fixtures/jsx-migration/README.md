# JSX migration isolation corpus (`0.1.20`)

These snippets are **not** product templates. They exist only so the compiler can
reject JSX author forms with structured diagnostics (`vmz::template/jsx-rejected`).

Do **not** copy them into `packages/examples/`, `@vmz/ui`, homepage, or dogfood.
Official authoring is Vue template only.

| File | Intent |
|------|--------|
| `text-interp.snippet` | `{expr}` text interpolation |
| `attr-bind.snippet` | `attr={expr}` / `onClick={…}` attribute form |
