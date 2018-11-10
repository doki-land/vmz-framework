/**
 * Product wiring for `@vmz/commander` / `@vmz/diagnostic`.
 *
 * Official catalogs live under `packages/runtimes/vmz/locales/` and load via
 * `cli-localize.ts` → `.use(vmzCliLocalize)`. Help lists are derived from the
 * command tree — do not reintroduce hand-rolled switches or catalog Usage walls.
 */

export { createCli } from '@vmz/commander';
export type { LocalizePlugin } from '@vmz/commander';
export {
    VMZ_CLI_CATALOG_EN_US,
    createVmzCliLocalize,
    flattenCatalog,
    loadCliCatalog,
    loadCliLocalesManifest,
    resolveCliLocalesRoot,
    resolveVmzLocale,
    translateCatalog,
    vmzCliLocalize,
} from './cli-localize.js';
export {
    formatDiagnostic,
    formatDiagnostics,
    t,
} from '@vmz/diagnostic';
