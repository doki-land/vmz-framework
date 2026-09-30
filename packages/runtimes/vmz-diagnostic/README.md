# `@vmz/diagnostic`

Diagnostic layout for structured `code + args + span` rows.

- Caller injects `t` / catalog (official tables live in `@vmz/vmz`)
- No built-in language packs; no separate i18n package
- Pretty printer: rustc/miette-style snippets when `sourceText` + `span` + `position` are wired

```ts
import { formatDiagnostic } from '@vmz/diagnostic';

formatDiagnostic(row, { locale: 'en-US', catalog: productCatalog });
```
