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
- DatePicker owned calendar overlay (not native `input[type=date]` popup)
- Upload multipart binary (parent-owned FormData → `#server` File/Blob; progress/cancel)
- Density / RTL / preset materialize
- Motion continuity + interrupt/cancel
- Motion compiler IR thin gate (`pnpm verify -- motion-ir`)
- UI7 conformance pack (`@vmz/ui/conformance` + `pnpm verify -- ui7`)
- `@vmz/ui-data-grid` thin gate (virtualization + pinned column — not tree/group/pivot/edit)

Verify:

```bash
pnpm verify -- ui-automation
pnpm verify -- ui7
pnpm verify -- ui-data-grid
pnpm verify -- official-dogfood
```

Still open relative to Browser Production Profile v1: `browser-production` aggregate core gaps,
`@vmz/ui-data-grid` deep capabilities, Upload cross-page session / multi-file parallel chunks,
`@vmz/test` Browser Host U0–U1, sibling `vmz-panel` product app.

## Commercial default surface

Default web surface targets modern commercial console density: flat 32px-class controls,
quiet borders, restrained radii, layered page/paper surfaces without Bootstrap-era inset
fields, accent bars, or card lift. Applications replace every semantic value through `/designs`.
Additional general-purpose components include layout primitives, typography, segmented controls,
tags, avatars, dropdowns, collapse panels and progress indicators.
