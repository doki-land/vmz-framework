# @vmz/ui — VMZ UI

Official **VMZ UI** framework package.

```text
VMZ Design  ≠  VMZ UI
/designs    ≠  this package
@vmz/ui     ≠  theme truth source
```

- Declares **semantic token requirements** (see `contracts/`).
- Ships ordinary `.vmz` under **`src/components/`** (same hard convention as apps) — **not** `@vmz/plugin-*`, no
  `componentsRoot` config.
- **Never** hardcodes brand hex (`#176BFF`, etc.). Applications provide values via `/designs`.

## Preview `0.0.4`

This is a **preview** release. It is **not** `production-ready` and **not** a mature / production UI.

Headline surface for this cut:

- Commercial / Console / Document-Product composition dogfood (homepage)
- Form depth, Structure, Overlay stacking, DataTable (ordinary HTML table — not `@vmz/ui-data-grid`)
- Density / RTL / preset materialize
- Motion continuity + interrupt/cancel
- Motion compiler IR thin gate (`pnpm verify -- motion-ir`)
- UI7 conformance pack (`@vmz/ui/conformance` + `pnpm verify -- ui7`)

Verify:

```bash
pnpm verify -- ui-automation
pnpm verify -- ui7
pnpm verify -- official-dogfood
```

Still open relative to Browser Production Profile v1: `browser-production` aggregate core gaps, `@vmz/ui-data-grid`, UI7
browser-timing depth, sibling `vmz-panel` product app.
