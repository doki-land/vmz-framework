/**
 * locale router / PageMeta gate:
 * - RouteId × LocaleId realization (LocaleId not in RouteId)
 * - prefix include / omit + canonical + hreflang
 * - Link retains current locale; reject hardcoded localized paths
 * - PageMeta locale + html lang/dir
 * - locale-aware cache key (no Accept-Language content steal)
 * - LocaleTransition commits route + meta together
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from '../_lib/repo-root.ts';
import { LOCALE_LINK_RESOLUTION_SCHEMA, LOCALE_PAGE_META_SCHEMA, LOCALE_ROUTE_REALIZATION_SCHEMA, localeCatalog } from 'vmz';
import {
    assertLocaleCacheKey,
    buildLocalePageMeta,
    buildLocaleRouteRealizationTable,
    commitLocaleRouteMetaTransition,
    localeAwareCacheKey,
    planLocalePathNavigation,
    realizeRoutePath,
    resolveLinkHref,
} from '../packages/runtimes/vmz/dist/locale-router.js';

const root = repoRoot(import.meta.url);
const fixture = path.join(root, 'packages', 'examples', 'locales-fixture');
const vmzBin = path.join(root, 'packages', 'runtimes', 'vmz', 'bin', 'vmz.js');

function fail(msg) {
    console.error(` GATE FAIL: ${msg}`);
    process.exit(1);
}

function runVmz(args) {
    return spawnSync(process.execPath, [vmzBin, ...args], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}

console.log(': protocol freezes router/meta schemas…');
const cat = localeCatalog();
for (const kind of ['route_realization', 'page_meta', 'link_resolution', 'router_check']) {
    if (!cat.documents.some((d) => d.kind === kind)) fail(`missing document ${kind}`);
}
if (!cat.diagnostics.includes('vmz::locale::route_collision')) fail('missing route_collision diag');
if (!cat.diagnostics.includes('vmz::locale::cache_key_steals_content')) fail('missing cache_key diag');

const locales = ['zh-hans', 'zh-hant', 'en-us'];
const routes = [
    { routeId: 'account.index', path: '/account' },
    { routeId: 'account.profile', path: '/account/profile' },
];

console.log(': prefix+include realization…');
const includeTable = buildLocaleRouteRealizationTable({
    routes,
    locales,
    defaultLocale: 'zh-hans',
    routing: { strategy: 'prefix', defaultPrefix: 'include' },
});
if (includeTable.status !== 'ready') fail(`include table: ${JSON.stringify(includeTable.diagnostics)}`);
const zhProfile = includeTable.realizations.find((r) => r.routeId === 'account.profile' && r.localeId === 'zh-hans');
const enProfile = includeTable.realizations.find((r) => r.routeId === 'account.profile' && r.localeId === 'en-us');
if (zhProfile?.path !== '/zh-hans/account/profile') fail(`zh path ${zhProfile?.path}`);
if (enProfile?.path !== '/en-us/account/profile') fail(`en path ${enProfile?.path}`);
if (
    realizeRoutePath('zh-hans', '/account/profile', { strategy: 'prefix', defaultPrefix: 'include' }).schema !== LOCALE_ROUTE_REALIZATION_SCHEMA
) {
    fail('realization schema');
}

console.log(': prefix+omit canonical / redirect / hreflang…');
const omitTable = buildLocaleRouteRealizationTable({
    routes,
    locales,
    defaultLocale: 'zh-hans',
    routing: { strategy: 'prefix', defaultPrefix: 'omit' },
});
const omitDefault = omitTable.realizations.find((r) => r.routeId === 'account.profile' && r.localeId === 'zh-hans');
const omitEn = omitTable.realizations.find((r) => r.routeId === 'account.profile' && r.localeId === 'en-us');
if (omitDefault?.path !== '/account/profile' || omitDefault?.prefixed !== false) {
    fail(`omit default path ${JSON.stringify(omitDefault)}`);
}
if (omitEn?.path !== '/en-us/account/profile') fail(`omit en ${omitEn?.path}`);

const meta = buildLocalePageMeta({
    routeId: 'account.profile',
    localeId: 'zh-hans',
    direction: 'ltr',
    title: '个人资料',
    origin: 'https://example.test',
    realizations: omitTable.realizations,
    locales,
    defaultLocale: 'zh-hans',
});
if (meta.schema !== LOCALE_PAGE_META_SCHEMA || meta.status !== 'ready') {
    fail(`page meta: ${JSON.stringify(meta.diagnostics)}`);
}
if (meta.canonical !== 'https://example.test/account/profile') fail(`canonical ${meta.canonical}`);
if (meta.htmlLang !== 'zh-hans' || meta.dir !== 'ltr') fail('html lang/dir');
const hrefs = new Set(meta.alternates.map((a) => a.hreflang));
if (!hrefs.has('zh-hans') || !hrefs.has('en-us') || !hrefs.has('x-default')) {
    fail(`hreflang incomplete ${[...hrefs]}`);
}

const nav = planLocalePathNavigation({
    pathname: '/zh-hans/account/profile',
    supportedLocales: locales,
    defaultLocale: 'zh-hans',
    routing: { strategy: 'prefix', defaultPrefix: 'omit' },
    hostCandidates: ['en-us'],
});
if (nav.redirectTo !== '/account/profile') fail(`expected redirect to unprefixed, got ${nav.redirectTo}`);
if (nav.contentLocale !== 'zh-hans') fail('prefixed default content locale');

const bare = planLocalePathNavigation({
    pathname: '/account/profile',
    supportedLocales: locales,
    defaultLocale: 'zh-hans',
    routing: { strategy: 'prefix', defaultPrefix: 'omit' },
    hostCandidates: ['en-us', 'ja-jp'],
});
if (bare.contentLocale !== 'zh-hans') {
    fail('unprefixed path must not be stolen by Accept-Language candidates');
}

console.log(': Link retains locale; reject hardcoded path…');
const link = resolveLinkHref({
    to: 'account.profile',
    currentLocale: 'en-us',
    realizations: includeTable.realizations,
});
if (link.schema !== LOCALE_LINK_RESOLUTION_SCHEMA || link.status !== 'ready' || link.href !== '/en-us/account/profile') {
    fail(`link retain: ${JSON.stringify(link)}`);
}
const hard = resolveLinkHref({
    to: '/en-us/account/profile',
    currentLocale: 'en-us',
    realizations: includeTable.realizations,
});
if (hard.status !== 'failed' || !hard.diagnostics.some((d) => d.code === 'vmz::locale::link_hardcoded_path')) {
    fail(`hardcoded path should fail: ${JSON.stringify(hard)}`);
}

console.log(': locale-aware cache key…');
const key = localeAwareCacheKey({
    routeId: 'account.profile',
    localeId: 'en-us',
    path: '/en-us/account/profile',
});
if (!assertLocaleCacheKey({ cacheKey: key, varyAcceptLanguage: true, localeId: 'en-us' }).ok) {
    fail('good key should pass');
}
const steal = assertLocaleCacheKey({
    cacheKey: 'route=account.profile|path=/account/profile',
    varyAcceptLanguage: true,
});
if (steal.ok || !steal.diagnostics.some((d) => d.code === 'vmz::locale::cache_key_steals_content')) {
    fail('Accept-Language-only vary must fail');
}

console.log(': LocaleTransition commits route + PageMeta…');
const enMeta = buildLocalePageMeta({
    routeId: 'account.profile',
    localeId: 'en-us',
    title: 'Profile',
    origin: 'https://example.test',
    realizations: includeTable.realizations,
    locales,
    defaultLocale: 'zh-hans',
});
const committed = commitLocaleRouteMetaTransition({
    fromLocale: 'zh-hans',
    toLocale: 'en-us',
    routeId: 'account.profile',
    realizations: includeTable.realizations,
    pageMetaByLocale: {
        'en-us': { locale: enMeta.locale, canonical: enMeta.canonical },
    },
});
if (committed.status !== 'committed' || committed.toPath !== '/en-us/account/profile') {
    fail(`transition commit: ${JSON.stringify(committed)}`);
}

console.log(': route collision diagnosed…');
const collide = buildLocaleRouteRealizationTable({
    routes: [
        { routeId: 'a', path: '/same' },
        { routeId: 'b', path: '/same' },
    ],
    locales: ['en-us'],
    defaultLocale: 'en-us',
    routing: { strategy: 'none' },
});
if (collide.status !== 'failed' || !collide.diagnostics.some((d) => d.code === 'vmz::locale::route_collision')) {
    fail(`collision: ${JSON.stringify(collide.diagnostics)}`);
}

console.log(': CLI router-check on fixture…');
const cli = runVmz(['locale', 'router-check', fixture, '--json']);
if (cli.status !== 0) fail(`router-check failed\n${cli.stdout}\n${cli.stderr}`);
let report;
try {
    report = JSON.parse(cli.stdout);
} catch (e) {
    fail(`not JSON: ${e}\n${cli.stdout}`);
}
if (report.schema !== 'vmz.locale.router_check.v0' || report.status !== 'ready') {
    fail(`router report bad: ${JSON.stringify(report).slice(0, 800)}`);
}
if (!(report.realizationTable?.realizations || []).some((r) => r.path === '/zh-hans/account/profile')) {
    fail('fixture missing zh-hans profile path');
}
if (!(report.pageMetas || []).some((m) => m.canonical?.includes('/zh-hans/account/profile'))) {
    fail('fixture missing pageMeta canonical');
}

console.log(' GATE PASS');
console.log(' realization · canonical/hreflang · Link retain · cache key · meta transition');
