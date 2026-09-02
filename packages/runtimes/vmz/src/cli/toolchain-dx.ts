/**
 * Product wiring for `@vmz/commander` / `@vmz/diagnostic`.
 *
 * Locales **loading** is `@vmz/commander` (`createLocalizeFromLocales` / `.locales`).
 * Product owns only `packages/runtimes/vmz/locales/` content + thin `cli-localize` wrapper.
 * Help lists are derived from the command tree — do not reintroduce Usage walls.
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
