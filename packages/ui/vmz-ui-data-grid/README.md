# @vmz/ui-data-grid

Official **VMZ UI** large-grid suite (preview).

```text
@vmz/ui DataTable  ≠  @vmz/ui-data-grid
ordinary HTML table ≠  virtualized + pinned + group/tree/pivot + cell edit
```

- Reuses application `/designs` semantic tokens (no brand hex).
- Reuses `@vmz/ui` composition (BulkActions / FilterBar / Pagination / Field / shells) — does **not** ship a second Button/Field/Dialog.
- Closed deepen: virtualization, pinned column, group + aggregation, tree rows, cell editing, **pivot matrix** (parent-owned row×col→measure projection).
- Still open: large-data selection depth, multi-column groupBy UX, drag-to-pivot chrome.

Verify:

```bash
pnpm verify -- ui-data-grid
```
