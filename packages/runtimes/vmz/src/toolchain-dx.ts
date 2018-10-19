/**
 * Soft wiring for future CLI / diagnostic migration.
 *
 * Do not expand `@vmz/commander` / `@vmz/diagnostic` until `@vmz/vmz` migrates
 * a real command or pretty-print path onto them. Official i18n catalogs live in
 * `cli-localize.ts` and plug into commander via `.use(vmzCliLocalize)`.
 */

export { createCli } from '@vmz/commander';
export type { LocalizePlugin } from '@vmz/commander';
export {
    VMZ_CLI_CATALOG_EN_US,
    createVmzCliLocalize,
    translateCatalog,
    vmzCliLocalize,
} from './cli-localize.js';
export {
    formatDiagnostic,
    formatDiagnostics,
    t,
} from '@vmz/diagnostic';
