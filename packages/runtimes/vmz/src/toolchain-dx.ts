/**
 * Product wiring for `@vmz/commander` / `@vmz/diagnostic`.
 *
 * Official catalogs live in `cli-localize.ts` and plug in via `.use(vmzCliLocalize)`.
 * `runCli` builds the command tree with `createCli` — do not reintroduce a hand-rolled switch.
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
