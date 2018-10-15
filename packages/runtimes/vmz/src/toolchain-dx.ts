/**
 * Soft wiring for future CLI / diagnostic migration.
 *
 * Do not expand `@vmz/commander` / `@vmz/diagnostic` until `@vmz/vmz` migrates
 * a real command or pretty-print path onto them. Official i18n catalogs will
 * live in this package and plug into commander via `.use(localize)`.
 */

export { createCli } from '@vmz/commander';
export type { LocalizePlugin } from '@vmz/commander';
export {
    formatDiagnostic,
    formatDiagnostics,
    t,
} from '@vmz/diagnostic';
