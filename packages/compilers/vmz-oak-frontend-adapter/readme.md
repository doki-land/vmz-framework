# vmz-oak-frontend-adapter

VMZ ↔ Oaks frontend bridge (phase A).

| API | Role |
|-----|------|
| `project_vmz_regions` | `.vmz` → ordered `SfcDocumentView` block spans |
| `parse_template_cst` | `<template>` body → Oak `VueParser` CST (format/highlight path) |

Requires **nightly** Rust (`rust-toolchain.toml`). Oaks via git + optional local `[patch]`.

Design: `规划设计/vmz/handoffs/2026-09-30-vmz-oak-nyar-frontend-integration.md`.
