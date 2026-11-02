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

Registry kinds: `stroke` (outlined UI chrome and tools), `text-badge` (proprietary converter names such as `tool.base64` → `B64`). `text-badge` is the documented exception to the own-SVG rule: the mark is a real text label rendered as content in a bounded chip, not a font glyph or emoji standing in for an unknown silhouette. `feature.ssr` is intentionally absent — use title copy instead of an icon.

Visual rules (enforced by the conformance gate):

- 24×24 viewBox; the optical box is 16 units wide (4–20), centerline geometry stays inside 3–21.
- One `DEFAULT_STROKE_WIDTH` (1.75) for every outlined mark; per-icon `strokeWidth` overrides are rejected.
- Round caps and joins; multi-part marks must physically connect (arrowheads join their arc, stems join outlines).
- Fixed spans: crosses 6–18, chevrons 6–18 × 9–15, plus/minus 5–19, checks 5–19 × 7–17, mean mark overbar 6–18 over a cross 7.5–16.5 × 10–19.
- Filled dots use `r=1.35` so they carry the same optical weight as the 1.75 stroke.
- Optically centered at (12,12); ground-biased metaphors keep the baseline on `y=20`. One silhouette per concept.
- 16px is the primary review size: a mark that only reads at 64px is not finished.

Verify:

```bash
pnpm verify -- ui-icons
```

Contact sheet (local review) and exact-viewport screenshots:

```bash
node packages/ui/vmz-ui-icons/scripts/contact-sheet.mjs --mode=both --grid
node packages/ui/vmz-ui-icons/scripts/capture-contact-sheet.mjs contact-sheet.html .cache/icons-1440.png 1440
node packages/ui/vmz-ui-icons/scripts/capture-contact-sheet.mjs contact-sheet.html .cache/icons-390.png 390
```
