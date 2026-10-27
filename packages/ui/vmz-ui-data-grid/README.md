# @vmz/ui-data-grid

Official **VMZ UI** data grid suite (preview).

```text
@vmz/ui DataTable  ≠  @vmz/ui-data-grid
records HTML table  ≠  parent-projected virtual chrome
```

Two first-class contracts share one component:

- **records (first batch)** — raw records + column definitions. Local single-column sort,
  controlled query filter, controlled `page` / `pageSize`, single/multi selection with
  select-all for the current page, and empty / loading / error states. Emits intent only;
  remote sort/filter/page protocols stay in the host data layer.
- **projected** — parent owns the flattened projection: virtualization, pinned column,
  group + aggregation, tree rows, cell editing, pivot matrix.

Records props:

| Prop | Meaning |
|------|---------|
| `columns` | `{ key, label, sortable?, align?, width? }[]` |
| `rows` | record list |
| `rowKey` | record field name or `(record) => string`; array index is only a last-resort fallback |
| `sortKey` / `sortDir` | controlled single-column sort (`asc` / `desc`) |
| `query` | controlled filter string, matched against visible columns |
| `page` / `pageSize` | controlled pagination |
| `selectedKeys` / `selectionMode` | controlled selection (`single` / `multi`) |
| `loading` / `error` | state; `empty` is derived from zero visible rows |
| labels | `caption`, `filterLabel`, `summaryTemplate`, `emptyTitle`, `selectAllLabel`, `prevLabel`, … |

Records events: `onSortChange(key, dir)`, `onFilterChange(query)`, `onPageChange(page)`,
`onSelectionChange(keys)`, `onRowActivate(key)`, `onRetry()`.

Accessibility and input: native `<table>` semantics with `scope="col"`, `aria-sort`,
`aria-selected`, `aria-checked="mixed"`, `role="status"` / `role="alert"` live regions, and
focusable rows driven by Enter, Space, arrows, Home and End.

- Reuses application `/designs` semantic tokens (no brand hex).
- Reuses `@vmz/ui` composition (`Pagination` / `Empty` / `Spinner` and shells) — does **not**
  ship a second Button/Field/Dialog.
- Still open (batch two, records path): row/column virtualization, pinned rows and columns,
  column resizing, edit validation, copy/export.

Verify:

```bash
pnpm verify -- ui-data-grid
```
