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

## Design preset

`presets/web-surface.v0.json` is the manifest for the first official design preset. Its files live
under `presets/web-surface/` and are exported as `@vmz/ui/presets/web-surface/*`, so an application
can materialize an editable `designs/` starting point:

```bash
pnpm exec vmz init design
```

The CLI reads the manifest `files` list, copies it into the project `designs/` directory, and
skips files that already exist (`--force` overwrites, `--dry-run` previews, `--designs-dir` and
`--preset` select another target).

A preset is Style Theme source files, not a runtime theme. It is never injected automatically and
carries no hidden semantics. `contracts/token-requirements.v0.json` remains the truth source for
which tokens the components require; the `ui-automation` gate checks this preset against it.

## Brand theming

Applications rebrand by **owning their token files**, never by overriding CSS variables at runtime:

1. `pnpm exec vmz init design` materializes the preset into `<app>/designs/` (existing files are
   kept unless `--force`).
2. Edit `designs/tokens/brand.json`: set `brand.primary` and the `scale.*` ramp to your brand hue,
   and adjust `semantic-action.json` / `semantic-status.json` when actions or status tones should
   follow the brand.
3. The build compiles them into `--vmz-*` custom properties. Components consume only those semantic
   variables, so no component source changes are ever needed.

`data-theme="dark"` / `data-theme="high-contrast"` activate the overlay files under
`designs/themes/`. The default preset ships a production-neutral palette only — product brand
colors live exclusively in the application's own `designs/`.

## Preview `0.0.4`

This is a **preview** release. It is **not** `production-ready` and **not** a mature / production UI.

Headline surface for this cut:

- Commercial / Console / Document-Product composition on official homepage
- Form depth, Structure, Overlay stacking, DataTable (ordinary HTML table — not `@vmz/ui-data-grid`)
- DatePicker owned calendar overlay (not native `input[type=date]` popup)
- Upload multipart binary (parent-owned FormData → `#server` File/Blob; progress/cancel)
- Density / RTL / preset materialize
- Motion continuity + interrupt/cancel
- Form rule validation (`Form#rules` + `values` → `invalid`), destructive `Popconfirm`,
  transient `Message`, read-only `Descriptions`
- Motion compiler IR thin gate (`pnpm verify -- motion-ir`)
- UI7 conformance pack (`@vmz/ui/conformance` + `pnpm verify -- ui7`)
- `@vmz/ui-data-grid` thin gate (virtualization + pinned column — not tree/group/pivot/edit)

Verify:

```bash
pnpm verify -- ui-automation
pnpm verify -- ui7
pnpm verify -- ui-data-grid
pnpm verify -- official-homepage
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
