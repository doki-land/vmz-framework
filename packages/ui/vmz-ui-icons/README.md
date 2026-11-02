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

Registry kinds: `stroke` (outlined UI chrome and tools), `fill` (brand and social silhouettes), `text-badge` (proprietary converter names such as `tool.base64` → `B64`). `text-badge` is the documented exception to the own-SVG rule: the mark is a real text label rendered as content in a bounded chip, not a font glyph or emoji standing in for an unknown silhouette. `feature.ssr` is intentionally absent — use title copy instead of an icon.

Categories live one module per file under `src/icons/`: `action`, `navigation` (key prefix `nav`), `status`, `feature`, `tool`, `file`, `media`, `editor`, `data`, `commerce`, `device`, `develop`, `git`, `social`, `brand`. `src/registry.ts` is the only aggregation point and re-exports every module; adding a mark means editing exactly one category module, never two tables. Near-duplicate semantics merge into one outline instead of shipping look-alikes: playback speed reuses `tool.speed`, restart reuses `action.refresh`, desktop reuses `action.monitor`, globe reuses `nav.language`, export/import reuse `action.upload` / `action.download`, and toast states reuse the `status.*` set.

Brand and social marks (`social.*`, `brand.*`) are silhouette language, so they use `fill` with the official geometry published by [Simple Icons](https://simpleicons.org) (CC0-1.0). Trademarks remain the property of their respective owners. Do not redraw brand marks by hand or import path data from sources without a clear license.

Visual rules (enforced by the conformance gate):

- 24×24 viewBox; the optical box is 16 units wide (4–20), centerline geometry stays inside 3–21.
- One `DEFAULT_STROKE_WIDTH` (1.75) for every outlined mark; per-icon `strokeWidth` overrides are rejected.
- Round caps and joins; multi-part marks must physically connect (arrowheads join their arc, stems join outlines).
- Fixed spans: crosses 6–18, chevrons 6–18 × 9–15, plus/minus 5–19, checks 5–19 × 7–17, mean mark overbar 6–18 over a cross 7.5–16.5 × 10–19.
- Filled dots use `r=1.5` so they survive the 16px step.
- Negation and decorative slashes run lower-left to upper-right (`status.offline`, `action.eye-off`); a symmetric X is a cross, not a slash. The gate rejects lone upper-left to lower-right diagonals.
- Acute corners below 60° (triangles, play marks, compass needles) are softened with a quadratic round in the path itself; corners at 90° or wider rely on the round stroke join.
- Parallel strokes keep at least ≈2.25 units of clear space at 16px; three-layer wound shapes (paperclip) shed a layer first, then widen the gaps. Intrinsically dense shapes (QR dot matrix, brand letterforms) are documented exceptions.
- Optically centered at (12,12); ground-biased metaphors keep the baseline on `y=20`. One silhouette per concept, checked across categories before a new mark lands.
- 16px is the primary review size, with 20 / 24 / 32 checked on the same contact sheet: a mark that only reads at 64px is not finished.

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
