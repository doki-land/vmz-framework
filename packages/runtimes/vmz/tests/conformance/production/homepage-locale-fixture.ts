/**
 * Catalog-driven homepage locale fixture helpers.
 * Product copy lives only in homepage locales common.json5; never hardcode here.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadNative } from 'vmz';

export type HomepageCommonCatalog = Record<string, string>;

function parseAuthorInput(source: string): unknown {
    const native = loadNative();
    if (typeof native.authorJson5ToCanonicalJson !== 'function') {
        throw new Error('native missing authorJson5ToCanonicalJson — run `pnpm napi:build`');
    }
    return JSON.parse(native.authorJson5ToCanonicalJson(String(source)));
}

export function loadHomepageCommonCatalog(root: string, homepageRel: string, localeId: string): HomepageCommonCatalog {
    const p = path.join(root, homepageRel, 'locales', localeId, 'common.json5');
    const raw = parseAuthorInput(fs.readFileSync(p, 'utf8')) as HomepageCommonCatalog;
    if (!raw || typeof raw !== 'object') throw new Error(`bad catalog ${p}`);
    return raw;
}

/** Collapse whitespace so <br>/em markup does not bind tests to layout noise. */
export function normCopy(s: string): string {
    return String(s || '')
        .replace(/\s+/g, '')
        .trim();
}

export function expectedTitle(catalog: HomepageCommonCatalog, leadKey: string, emKey: string): string {
    return normCopy(`${catalog[leadKey] || ''}${catalog[emKey] || ''}`);
}

export function assertCatalogKeys(catalog: HomepageCommonCatalog, keys: string[], localeId: string): void {
    for (const k of keys) {
        if (!catalog[k] || typeof catalog[k] !== 'string') {
            throw new Error(`homepage locales/${localeId}/common.json5 missing MessageId ${k}`);
        }
    }
}

const BODY_KEYS = [
    'heroKicker',
    'heroTitleLead',
    'heroTitleEm',
    'heroLede',
    'statementTitleLead',
    'statementTitleEm',
    'statementBody',
    'startTitle',
    'startLede',
    'build',
    'readDocs',
    'start',
    'docs',
];

export async function proveHomepageLocaleTransition(opts: {
    root: string;
    homepageRel: string;
    baseUrl: string;
    loadPuppeteerCore: () => Promise<any>;
}): Promise<string> {
    const { root, homepageRel, baseUrl, loadPuppeteerCore } = opts;
    const zh = loadHomepageCommonCatalog(root, homepageRel, 'zh-hans');
    const en = loadHomepageCommonCatalog(root, homepageRel, 'en-us');
    assertCatalogKeys(zh, BODY_KEYS, 'zh-hans');
    assertCatalogKeys(en, BODY_KEYS, 'en-us');
    for (const k of ['heroLede', 'statementBody', 'startTitle', 'build', 'start', 'docs']) {
        if (normCopy(zh[k]) === normCopy(en[k])) {
            throw new Error(`catalog ${k} must differ across zh-hans/en-us (got identical)`);
        }
    }

    const { resolveBrowserExecutable } = await import(
        pathToFileURL(path.join(root, 'packages', 'runtimes', 'vmz-test', 'dist', 'browser.js')).href
    );
    const chrome = resolveBrowserExecutable();
    if (!chrome) throw new Error('Chrome/Edge not found (set VMZ_BROWSER)');
    const puppeteer = await loadPuppeteerCore();
    const browser = await puppeteer.launch({
        executablePath: chrome,
        headless: true,
        args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    });
    try {
        const page = await browser.newPage();
        await page.goto(`${baseUrl}/ui`, { waitUntil: 'networkidle0', timeout: 30000 });
        await page.waitForFunction('typeof window.__vmzTransitionLocale === "function"', { timeout: 15000 });
        const before = await page.evaluate(() => ({
            path: location.pathname,
            locale: document.documentElement.getAttribute('data-locale'),
            routing: document.documentElement.getAttribute('data-vmz-locale-routing'),
        }));
        if (!before.routing) throw new Error(`missing data-vmz-locale-routing: ${JSON.stringify(before)}`);
        if (before.locale && before.locale !== 'zh-hans') {
            throw new Error(`default locale want zh-hans, got ${JSON.stringify(before)}`);
        }

        const committed = await page.evaluate(async () => {
            const r = await (window as any).__vmzTransitionLocale('en-us');
            return {
                ...r,
                path: location.pathname,
                locale: document.documentElement.getAttribute('data-locale'),
                lang: document.documentElement.lang,
            };
        });
        if (committed.status !== 'committed' || committed.locale !== 'en-us') {
            throw new Error(`LocaleTransition commit failed: ${JSON.stringify(committed)}`);
        }
        if (committed.path !== '/en-us/ui' && committed.path !== '/en-us/ui/') {
            throw new Error(`LocaleTransition path want /en-us/ui, got ${committed.path}`);
        }

        await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle0', timeout: 30000 });
        await page.waitForFunction('typeof window.__vmzTransitionLocale === "function"', { timeout: 15000 });
        await page.waitForSelector('[data-vmz-fixture="site-header"]', { timeout: 10000 });
        await page.waitForSelector('[data-vmz-fixture="landing-hero-lede"]', { timeout: 10000 });

        const waitBodyMatches = async (catalog: HomepageCommonCatalog, localeId: string) => {
            const want = {
                localeId,
                heroKicker: normCopy(catalog.heroKicker),
                heroTitle: expectedTitle(catalog, 'heroTitleLead', 'heroTitleEm'),
                heroLede: normCopy(catalog.heroLede),
                statementTitle: expectedTitle(catalog, 'statementTitleLead', 'statementTitleEm'),
                statementBody: normCopy(catalog.statementBody),
                startTitle: normCopy(catalog.startTitle),
                startLede: normCopy(catalog.startLede),
                build: normCopy(catalog.build),
                start: normCopy(catalog.start),
                docs: normCopy(catalog.docs),
                guideHref: `/d/${localeId}/guide/`,
                docsRootHref: `/d/${localeId}/`,
            };
            await page.waitForFunction(
                (expected: typeof want) => {
                    const norm = (s: string | null | undefined) =>
                        String(s || '')
                            .replace(/\s+/g, '')
                            .trim();
                    const text = (sel: string) => norm((document.querySelector(sel) as HTMLElement | null)?.textContent || '');
                    const href = (sel: string) => (document.querySelector(sel) as HTMLAnchorElement | null)?.getAttribute('href') || '';
                    return (
                        document.documentElement.getAttribute('data-locale') === expected.localeId &&
                        text('[data-vmz-fixture="landing-hero-kicker"]') === expected.heroKicker &&
                        text('[data-vmz-fixture="landing-hero-title"]') === expected.heroTitle &&
                        text('[data-vmz-fixture="landing-hero-lede"]') === expected.heroLede &&
                        text('[data-vmz-fixture="landing-statement-title"]') === expected.statementTitle &&
                        text('[data-vmz-fixture="landing-statement-body"]') === expected.statementBody &&
                        text('[data-vmz-fixture="landing-start-title"]') === expected.startTitle &&
                        text('[data-vmz-fixture="landing-start-lede"]') === expected.startLede &&
                        text('[data-vmz-fixture="landing-primary-cta"]') === expected.build &&
                        text('.site-nav__cta') === expected.start &&
                        text('[data-vmz-fixture="footer-docs"]') === expected.docs &&
                        href('[data-vmz-fixture="landing-primary-cta"]').includes(expected.guideHref) &&
                        href('[data-vmz-fixture="landing-secondary-cta"]').includes(expected.docsRootHref) &&
                        href('[data-vmz-fixture="footer-docs"]').includes(expected.docsRootHref)
                    );
                },
                { timeout: 15000 },
                want,
            );
            return want;
        };

        const zhSnap = await waitBodyMatches(zh, 'zh-hans');

        const openLang = await page.evaluate(() => {
            const details = document.querySelector('.site-language') as HTMLDetailsElement | null;
            if (!details) return false;
            details.open = true;
            return true;
        });
        if (!openLang) throw new Error('site-language details missing');
        const hardDocLink = await page.evaluate(() => !!document.querySelector('.site-language__menu a[href^="/d/"]'));
        if (hardDocLink) throw new Error('language menu must not hard-link /d/…');

        await page.click('[data-vmz-fixture="locale-en-us"]');
        await page.waitForFunction(
            () => location.pathname.startsWith('/en-us') && document.documentElement.getAttribute('data-locale') === 'en-us',
            { timeout: 15000 },
        );
        const enSnap = await waitBodyMatches(en, 'en-us');
        if (enSnap.heroLede === zhSnap.heroLede) {
            throw new Error('landing hero lede did not refresh after LocaleTransition (still zh catalog)');
        }
        if (enSnap.build === zhSnap.build) {
            throw new Error('landing primary CTA did not refresh after LocaleTransition');
        }

        const rejected = await page.evaluate(async () => {
            const beforeLocale = document.documentElement.getAttribute('data-locale');
            const r = await (window as any).__vmzTransitionLocale('ja-jp');
            return {
                ...r,
                beforeLocale,
                afterLocale: document.documentElement.getAttribute('data-locale'),
                path: location.pathname,
            };
        });
        if (rejected.status !== 'rejected' || rejected.afterLocale !== 'en-us') {
            throw new Error(`unsupported locale must reject+retain: ${JSON.stringify(rejected)}`);
        }
        return 'LocaleTransition API + catalog-driven landing/footer #locales body matrix';
    } finally {
        await browser.close();
    }
}
