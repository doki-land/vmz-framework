# @vmz/ui-icons

Official **VMZ UI** icon suite (thin gate).

```text
@vmz/ui-icons  ≠  loose SVG dump in apps
semantic name  →  registry mark  →  <Icon name="tool.base64" />
```

- Reuses application `/designs` semantic tokens (no brand hex).
- Does **not** ship Button / Field / Dialog / Tooltip — compose with `@vmz/ui`.
- Closed thin: semantic `name`, built-in registry, decorative vs labelled a11y, size density.
- Still open: multi-surface path sets, locale-aware marks, icon-only Button integration depth.

Registry kinds: `stroke` (outlined UI chrome), `fill` (deferred silhouettes), `text-badge` (proprietary converter names such as `tool.base64` → `B64`).

Verify:

```bash
pnpm verify -- ui-icons
```

Contact sheet (local review):

```bash
node packages/ui/vmz-ui-icons/scripts/contact-sheet.mjs
```
