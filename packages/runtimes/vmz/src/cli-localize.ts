/**
 * Official CLI / diagnostic localization for `@vmz/vmz`.
 *
 * Catalogs live here — not in `@vmz/commander`, `@vmz/diagnostic`, or a separate
 * `@vmz/i18n` package. Plug into commander with `.use(vmzCliLocalize)` when the
 * product CLI migrates off hand-rolled help. Grow message ids as commands move.
 */

import type { LocaleCatalog, LocalizePlugin } from '@vmz/commander';

/** Product `en-US` table. Expand only when a real help / diagnostic path needs a key. */
export const VMZ_CLI_CATALOG_EN_US: LocaleCatalog = {
    // e.g. 'cli.cmd.build': 'Build the project',
};

/**
 * Minimal `{arg}` substitution against a catalog table.
 * @param {string} id
 * @param {Record<string, string> | undefined} args
 * @param {LocaleCatalog} catalog
 */
export function translateCatalog(id: string, args: Record<string, string> | undefined, catalog: LocaleCatalog): string {
    const template = catalog[id];
    if (template == null) return `{{${id}}}`;
    return template.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (_m, name) => {
        if (args && Object.prototype.hasOwnProperty.call(args, name)) {
            return args[name] ?? '';
        }
        return `{${name}}`;
    });
}

/**
 * Build the official Localize plugin for `@vmz/vmz`.
 * @param {{ locale?: string, catalog?: LocaleCatalog }} [opts]
 * @returns {LocalizePlugin}
 */
export function createVmzCliLocalize(opts: { locale?: string; catalog?: LocaleCatalog } = {}): LocalizePlugin {
    const locale = typeof opts.locale === 'string' && opts.locale ? opts.locale : 'en-US';
    const catalog = opts.catalog ?? VMZ_CLI_CATALOG_EN_US;
    return {
        resolveLocale: () => locale,
        t: (id, args) => translateCatalog(id, args, catalog),
    };
}

/** Default official plugin (`en-US`). Apps may `.use(createVmzCliLocalize({…}))` instead. */
export const vmzCliLocalize = createVmzCliLocalize();
