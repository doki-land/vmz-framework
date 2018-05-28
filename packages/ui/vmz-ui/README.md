# @vmz/ui — VMZ UI

Official **VMZ UI** framework package.

```text
VMZ Design  ≠  VMZ UI
/designs    ≠  this package
@vmz/ui     ≠  theme truth source
```

- Declares **semantic token requirements** (see `contracts/`).
- Ships ordinary `.vmz` under **`src/components/`** (same hard convention as apps) — **not** `@vmz/plugin-*`, no `componentsRoot` config.
- **Never** hardcodes brand hex (`#176BFF`, etc.). Applications provide values via `/designs`.
- Naming / ownership: `规划设计/vmz/29`. Architecture: `规划设计/vmz/31` (UI0→UI5).

UI0 scope: package skeleton + `Button` probe + token requirement contract + `pnpm gate:ui0`.
