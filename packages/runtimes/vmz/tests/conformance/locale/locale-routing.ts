/**
 * locale runtime gate:
 * - LocaleContext / FormatterContext schemas
 * - negotiation priority (no dark-guess)
 * - formatter digest SSR/client parity
 * - reject incomplete / machine-default timezone
 * - atomic LocaleTransition commit / rollback
 * - whole-message fallback (no mixed locale)
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from '../_lib/repo-root.ts';
import {
    FORMATTER_DATA_VERSION,
    LOCALE_APPLICATION_CONTEXT_SCHEMA,
    LOCALE_FORMATTER_CONTEXT_SCHEMA,
    LOCALE_TRANSITION_SCHEMA,
    localeCatalog,
} from 'vmz';
import {
    buildApplicationContext,
    buildFormatterContext,
    checkSsrClientParity,
    createLocaleSession,
    formatMessageTemplate,
    formatterContextDigest,
    negotiateLocale,
    resolveMessageVariant,
    validateFormatterContext,
} from '../packages/runtimes/vmz/dist/locale-runtime.js';

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

console.log(': protocol freezes runtime schemas…');
const cat = localeCatalog();
if (!cat.documents.some((d) => d.kind === 'application_context' && d.schema === LOCALE_APPLICATION_CONTEXT_SCHEMA)) {
    fail('missing application_context document');
}
if (!cat.documents.some((d) => d.kind === 'formatter_context' && d.schema === LOCALE_FORMATTER_CONTEXT_SCHEMA)) {
    fail('missing formatter_context document');
}
if (!cat.documents.some((d) => d.kind === 'transition' && d.schema === LOCALE_TRANSITION_SCHEMA)) {
    fail('missing transition document');
}
if (cat.formatterDataVersion !== FORMATTER_DATA_VERSION) fail('formatterDataVersion');

console.log(': negotiateLocale priority…');
const supported = ['zh-hans', 'zh-hant', 'en-us'];
if (
    negotiateLocale({
        supportedLocales: supported,
        defaultLocale: 'zh-hans',
        routeLocale: 'en-us',
        userChoice: 'zh-hant',
        preference: 'zh-hans',
        hostCandidates: ['ja-jp'],
    }) !== 'en-us'
) {
    fail('routeLocale should win');
}
if (
    negotiateLocale({
        supportedLocales: supported,
        defaultLocale: 'zh-hans',
        hostCandidates: ['zh-TW', 'en-US', 'en'],
    }) !== 'zh-hans'
) {
    fail('must not dark-guess zh-TW / en-US');
}

console.log(': FormatterContext digest + incompleteness…');
const app = buildApplicationContext({
    applicationId: 'app.locales-fixture',
    deliveryId: 'delivery.web',
    localeId: 'zh-hans',
    timeZone: 'Asia/Shanghai',
    generation: 1,
});
const fmt = buildFormatterContext(app);
const digest = formatterContextDigest(fmt);
if (!digest || digest.length < 16) fail('digest too short');
if (formatterContextDigest(fmt) !== digest) fail('digest unstable');
const bad = validateFormatterContext({
    ...fmt,
    timeZone: '',
});
if (bad.ok || !bad.diagnostics.some((d) => d.code === 'vmz::locale::formatter_context_incomplete')) {
    fail('incomplete formatter should fail');
}
const machine = validateFormatterContext({
    ...fmt,
    timeZone: 'local',
});
if (machine.ok || !machine.diagnostics.some((d) => d.code === 'vmz::locale::machine_default_forbidden')) {
    fail('machine timezone should fail');
}

console.log(': SSR/client parity…');
const texts = {
    'account.actions.save': formatMessageTemplate('保存'),
    'account.greeting': formatMessageTemplate('你好，{name}', { name: 'Ada' }),
};
const parityOk = checkSsrClientParity({
    ssr: { localeId: 'zh-hans', formatterDigest: digest, formatterDataVersion: FORMATTER_DATA_VERSION, texts },
    client: { localeId: 'zh-hans', formatterDigest: digest, formatterDataVersion: FORMATTER_DATA_VERSION, texts },
});
if (parityOk.status !== 'ready') fail(`parity should pass: ${JSON.stringify(parityOk.diagnostics)}`);
const parityBad = checkSsrClientParity({
    ssr: { localeId: 'zh-hans', formatterDigest: digest, texts },
    client: { localeId: 'zh-hans', formatterDigest: 'deadbeef', texts },
});
if (parityBad.status !== 'failed' || !parityBad.diagnostics.some((d) => d.code === 'vmz::locale::digest_mismatch')) {
    fail('digest mismatch should fail');
}

console.log(': whole-message fallback…');
const fb = resolveMessageVariant({
    messageId: 'account.onlyHans',
    requestedLocale: 'zh-hant',
    variants: { 'zh-hans': { template: '仅简体' } },
    fallback: { 'zh-hant': ['zh-hans'] },
});
if (!fb.ok || fb.resolvedLocale !== 'zh-hans' || fb.template !== '仅简体') {
    fail(`fallback resolution: ${JSON.stringify(fb)}`);
}

console.log(': atomic LocaleTransition…');
const session = createLocaleSession({
    applicationId: 'app.locales-fixture',
    deliveryId: 'delivery.web',
    supportedLocales: supported,
    defaultLocale: 'zh-hans',
    fallback: { 'zh-hant': ['zh-hans'], 'en-us': [] },
    messages: {
        'account.actions.save': {
            variants: {
                'zh-hans': { template: '保存' },
                'zh-hant': { template: '儲存' },
                'en-us': { template: 'Save' },
            },
        },
        'account.greeting': {
            variants: {
                'zh-hans': { template: '你好，{name}' },
                'zh-hant': { template: '你好，{name}' },
                'en-us': { template: 'Hello, {name}' },
            },
        },
    },
    initialLocaleId: 'zh-hans',
    timeZone: 'Asia/Shanghai',
    loadedChunks: ['zh-hans'],
});

async function runTransitions() {
    const unsupported = await session.transition('ja-jp', {
        loadChunk: async () => true,
    });
    if (unsupported.status !== 'rejected' || session.applicationContext.localeId !== 'zh-hans') {
        fail(`unsupported should reject: ${JSON.stringify(unsupported)}`);
    }

    const loadFail = await session.transition('en-us', {
        loadChunk: async () => false,
    });
    if (loadFail.status !== 'rolled_back' || session.applicationContext.localeId !== 'zh-hans') {
        fail(`load fail must keep old locale: ${JSON.stringify(loadFail)}`);
    }
    if (!loadFail.diagnostics.some((d) => d.code === 'vmz::locale::transition_load_failed')) {
        fail('want transition_load_failed');
    }

    const committed = await session.transition('en-us', {
        loadChunk: async () => true,
    });
    if (committed.status !== 'committed' || session.applicationContext.localeId !== 'en-us') {
        fail(`commit failed: ${JSON.stringify(committed)}`);
    }
    if (committed.snapshot.formatterDigest === digest) fail('digest should change with locale');
    const rendered = session.renderAll({ 'account.greeting': { name: 'Ada' } });
    if (rendered.bindings['account.actions.save']?.text !== 'Save') fail('expected English Save');
    if (rendered.bindings['account.greeting']?.text !== 'Hello, Ada') fail('expected English greeting');
    if (rendered.resolvedLocales.some((l) => l !== 'en-us')) fail(`mixed after commit: ${rendered.resolvedLocales}`);
}

await runTransitions();

console.log(': CLI runtime-check on fixture…');
const cli = runVmz(['locale', 'runtime-check', fixture, '--json']);
if (cli.status !== 0) fail(`runtime-check failed\n${cli.stdout}\n${cli.stderr}`);
let report;
try {
    report = JSON.parse(cli.stdout);
} catch (e) {
    fail(`not JSON: ${e}\n${cli.stdout}`);
}
if (report.schema !== 'vmz.locale.runtime_check.v0' || report.status !== 'ready') {
    fail(`runtime report bad: ${JSON.stringify(report).slice(0, 800)}`);
}
if (report.applicationContext?.localeId !== 'zh-hans') fail('fixture default locale');
if (!report.formatterDigest) fail('missing formatterDigest');

console.log(' GATE PASS');
console.log(' LocaleContext · FormatterContext · negotiate · digest parity · atomic transition');
