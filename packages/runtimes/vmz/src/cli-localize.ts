/**
 * Official CLI / diagnostic localization for `@vmz/vmz`.
 *
 * Natural-language tables live under `locales/` (same layout idea as app locales):
 *   locales/locales.json          — manifest (defaultLocale + locale ids)
 *   locales/<localeId>/*.json     — flat message-id catalogs (merged)
 *
 * Help lists are still **derived** by `@vmz/commander` from the command tree;
 * this module only loads / resolves catalogs. Do not reintroduce TS prose walls.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LocaleCatalog, LocalizePlugin } from '@vmz/commander';

export type CliLocalesManifest = {
    defaultLocale: string;
    locales: Array<{ id: string; label?: string; direction?: string }>;
    fallback?: Record<string, string[]>;
};

const LOCALES_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'locales');

const catalogCache = new Map<string, LocaleCatalog>();
let manifestCache: CliLocalesManifest | null = null;

/** Package `locales/` root (shipped next to `dist/`). */
export function resolveCliLocalesRoot(): string {
    return LOCALES_ROOT;
}

export function loadCliLocalesManifest(root: string = LOCALES_ROOT): CliLocalesManifest {
    if (manifestCache && root === LOCALES_ROOT) return manifestCache;
    const file = path.join(root, 'locales.json');
    if (!existsSync(file)) {
        throw new Error(`@vmz/vmz: missing CLI locales manifest at ${file}`);
    }
    const raw = JSON.parse(readFileSync(file, 'utf8')) as CliLocalesManifest;
    if (!raw?.defaultLocale || !Array.isArray(raw.locales) || !raw.locales.length) {
        throw new Error(`@vmz/vmz: invalid CLI locales manifest ${file}`);
    }
    if (root === LOCALES_ROOT) manifestCache = raw;
    return raw;
}

/**
 * Flatten nested JSON (`{ cli: { cmd: { check: "…" } } }` → `cli.cmd.check`)
 * or pass through already-flat catalogs (`{ "cli.cmd.check": "…" }`).
 */
export function flattenCatalog(node: unknown, prefix = ''): LocaleCatalog {
    const out: LocaleCatalog = {};
    if (node == null || typeof node !== 'object' || Array.isArray(node)) return out;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        const id = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'string') {
            out[id] = value;
        } else if (value && typeof value === 'object' && !Array.isArray(value)) {
            Object.assign(out, flattenCatalog(value, id));
        }
    }
    return out;
}

function loadLocaleDir(root: string, localeId: string): LocaleCatalog {
    const dir = path.join(root, localeId);
    if (!existsSync(dir)) return {};
    const out: LocaleCatalog = {};
    for (const name of readdirSync(dir).sort()) {
        if (!name.endsWith('.json')) continue;
        const raw = JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as unknown;
        Object.assign(out, flattenCatalog(raw));
    }
    return out;
}

/**
 * Load (and cache) a locale catalog. Missing locales fall back via manifest.fallback
 * then `defaultLocale`.
 */
export function loadCliCatalog(locale: string, root: string = LOCALES_ROOT): LocaleCatalog {
    const cacheKey = `${root}::${locale}`;
    const hit = catalogCache.get(cacheKey);
    if (hit) return hit;

    const manifest = loadCliLocalesManifest(root);
    const chain = [locale, ...(manifest.fallback?.[locale] ?? []), manifest.defaultLocale];
    const merged: LocaleCatalog = {};
    // Walk chain reverse so requested locale wins.
    for (const id of [...new Set(chain)].reverse()) {
        Object.assign(merged, loadLocaleDir(root, id));
    }
    if (!Object.keys(merged).length) {
        throw new Error(`@vmz/vmz: empty CLI catalog for locale ${JSON.stringify(locale)} under ${root}`);
    }
    catalogCache.set(cacheKey, merged);
    return merged;
}

/** @deprecated Prefer {@link loadCliCatalog}; kept for soft re-exports. */
export function getVmzCliCatalogEnUs(): LocaleCatalog {
    return loadCliCatalog('en-US');
}

/** Eager default table (en-US) for callers that still import a constant. */
export const VMZ_CLI_CATALOG_EN_US: LocaleCatalog = loadCliCatalog('en-US');

/**
 * Resolve product locale from env (no separate i18n package).
 */
export function resolveVmzLocale(env: NodeJS.ProcessEnv = process.env): string {
    const manifest = loadCliLocalesManifest();
    const raw = String(env.VMZ_LOCALE || env.LANG || env.LC_ALL || '')
        .split('.')[0]
        ?.replace(/_/g, '-') || '';
    if (!raw) return manifest.defaultLocale;
    const lower = raw.toLowerCase();
    const known = manifest.locales.map((l) => l.id);
    const exact = known.find((id) => id.toLowerCase() === lower);
    if (exact) return exact;
    const prefix = known.find((id) => id.toLowerCase().startsWith(lower.split('-')[0]!));
    if (prefix) return prefix;
    if (lower === 'en' || lower.startsWith('en-')) {
        const en = known.find((id) => id.toLowerCase().startsWith('en'));
        if (en) return en;
    }
    return manifest.defaultLocale;
}

/**
 * Minimal `{arg}` substitution against a catalog table.
 */
export function translateCatalog(
    id: string,
    args: Record<string, string> | undefined,
    catalog: LocaleCatalog,
): string {
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
 */
export function createVmzCliLocalize(
    opts: { locale?: string; catalog?: LocaleCatalog; env?: NodeJS.ProcessEnv; localesRoot?: string } = {},
): LocalizePlugin {
    const env = opts.env ?? process.env;
    const root = opts.localesRoot ?? LOCALES_ROOT;
    const locale = typeof opts.locale === 'string' && opts.locale ? opts.locale : resolveVmzLocale(env);
    const catalog = opts.catalog ?? loadCliCatalog(locale, root);
    return {
        resolveLocale: () => locale,
        t: (id, args) => translateCatalog(id, args, catalog),
    };
}

/** Default official plugin (locale from env; catalog from `locales/`). */
export const vmzCliLocalize = createVmzCliLocalize();
