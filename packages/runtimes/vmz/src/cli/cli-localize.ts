/**
 * Official CLI / diagnostic localization for `@vmz/vmz`.
 *
 * Mechanism (manifest / flatten / load / createLocalize) lives in `@vmz/commander`.
 * This module only points at the product `locales/` root and prefers `VMZ_LOCALE`.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    createLocalizeFromLocales,
    flattenCatalog,
    loadCatalog,
    loadLocalesManifest,
    resolveLocale,
    translate,
    type LocaleCatalog,
    type LocalesManifest,
    type LocalizePlugin,
} from '@vmz/commander';

const LOCALES_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'locales');

const VMZ_ENV_KEYS = ['VMZ_LOCALE', 'LOCALE', 'LANG', 'LC_ALL'];

/** Package `locales/` root (shipped next to `dist/`). */
export function resolveCliLocalesRoot(): string {
    return LOCALES_ROOT;
}

/** @deprecated Prefer `loadLocalesManifest` from `@vmz/commander`. */
export function loadCliLocalesManifest(root: string = LOCALES_ROOT): LocalesManifest {
    return loadLocalesManifest(root);
}

/** @deprecated Prefer `loadCatalog` from `@vmz/commander`. */
export function loadCliCatalog(locale: string, root: string = LOCALES_ROOT): LocaleCatalog {
    return loadCatalog(locale, root);
}

/** @deprecated Prefer `loadCatalog('en-US', root)`. */
export function getVmzCliCatalogEnUs(): LocaleCatalog {
    return loadCatalog('en-US', LOCALES_ROOT);
}

/** Eager default table (en-US) for callers that still import a constant. */
export const VMZ_CLI_CATALOG_EN_US: LocaleCatalog = loadCatalog('en-US', LOCALES_ROOT);

/** Resolve product locale (`VMZ_LOCALE` first). */
export function resolveVmzLocale(env: NodeJS.ProcessEnv = process.env, argv: string[] = []): string {
    return resolveLocale({
        argv,
        env,
        manifest: loadLocalesManifest(LOCALES_ROOT),
        envKeys: VMZ_ENV_KEYS,
    });
}

/** @deprecated Prefer `translate` / `translateWithFallback` from `@vmz/commander`. */
export function translateCatalog(id: string, args: Record<string, string> | undefined, catalog: LocaleCatalog): string {
    return translate(id, args, catalog);
}

export { flattenCatalog };

/**
 * Build the official Localize plugin for `@vmz/vmz`.
 */
export function createVmzCliLocalize(
    opts: { locale?: string; catalog?: LocaleCatalog; env?: NodeJS.ProcessEnv; argv?: string[]; localesRoot?: string } = {},
): LocalizePlugin {
    return createLocalizeFromLocales({
        root: opts.localesRoot ?? LOCALES_ROOT,
        locale: opts.locale,
        catalog: opts.catalog,
        env: opts.env,
        argv: opts.argv,
        envKeys: VMZ_ENV_KEYS,
    });
}

/** Default official plugin (locale from env; catalog from `locales/`). */
export const vmzCliLocalize = createVmzCliLocalize();
