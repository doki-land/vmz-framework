/**
 * I4 locale multi-host delivery gate:
 * - LocaleDeliveryResolution (web/mini/native/server)
 * - reject full client locale bundles
 * - Native signed pack (no JS)
 * - Mini cross-subpackage message proof
 * - server ErrorCode envelope (no translated strings)
 * - cross-host MessageId / hash invariant
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORMATTER_DATA_VERSION, LOCALE_DELIVERY_RESOLUTION_SCHEMA, LOCALE_NATIVE_PACK_SCHEMA, localeCatalog } from 'vmz';
import {
    assertHostMessageInvariant,
    assertServerErrorEnvelope,
    assertServerFormatContext,
    buildLocaleDeliveryResolution,
    proveMiniPackageMessages,
    validateNativeLocalePack,
} from '../packages/runtimes/vmz/dist/locale-delivery.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(root, 'packages', 'examples', 'locales-fixture');
const vmzBin = path.join(root, 'packages', 'runtimes', 'vmz', 'bin', 'vmz.js');

function fail(msg) {
    console.error(`I4 GATE FAIL: ${msg}`);
    process.exit(1);
}

function runVmz(args) {
    return spawnSync(process.execPath, [vmzBin, ...args], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}

const messages = [
    {
        messageId: 'account.actions.save',
        variants: {
            'zh-hans': { template: '保存' },
            'zh-hant': { template: '儲存' },
            'en-us': { template: 'Save' },
        },
    },
    {
        messageId: 'account.greeting',
        variants: {
            'zh-hans': { template: '你好，{name}' },
            'zh-hant': { template: '你好，{name}' },
            'en-us': { template: 'Hello, {name}' },
        },
    },
];
const supported = ['zh-hans', 'zh-hant', 'en-us'];
const common = {
    applicationId: 'app.locales-fixture',
    planVersion: 'plan.v0',
    supportedLocales: supported,
    defaultLocale: 'zh-hans',
    fallback: { 'zh-hant': ['zh-hans'], 'en-us': [] },
    messages,
    reachableMessageIds: ['account.actions.save', 'account.greeting'],
    bundledLocales: ['zh-hans'],
};

console.log('I4: protocol freezes delivery schemas…');
const cat = localeCatalog();
for (const kind of ['delivery_resolution', 'chunk_manifest', 'native_pack', 'mini_package_proof', 'server_error_envelope', 'delivery_check']) {
    if (!cat.documents.some((d) => d.kind === kind)) fail(`missing document ${kind}`);
}
if (!cat.diagnostics.includes('vmz::locale::delivery_full_bundle')) fail('missing full_bundle diag');
if (cat.formatterDataVersion !== FORMATTER_DATA_VERSION) fail('formatterDataVersion');

console.log('I4: web delivery slices reachable subset…');
const web = buildLocaleDeliveryResolution({ ...common, host: 'web', deliveryId: 'delivery.web' });
if (web.schema !== LOCALE_DELIVERY_RESOLUTION_SCHEMA || web.status !== 'ready') {
    fail(`web: ${JSON.stringify(web.diagnostics)}`);
}
if (web.bundledLocales.join(',') !== 'zh-hans') fail('web should bundle default only');
if (!web.lazyLocaleChunks.some((c) => c.localeId === 'en-us')) fail('web missing lazy en-us');
if (web.formatterDataVersion !== FORMATTER_DATA_VERSION) fail('web formatter version');

console.log('I4: reject full client locale bundle…');
const full = buildLocaleDeliveryResolution({
    ...common,
    host: 'web',
    deliveryId: 'delivery.web',
    bundledLocales: supported,
});
if (full.status !== 'failed' || !full.diagnostics.some((d) => d.code === 'vmz::locale::delivery_full_bundle')) {
    fail(`full bundle should fail: ${JSON.stringify(full.diagnostics)}`);
}

console.log('I4: Native pack signing / no JS…');
const goodPack = validateNativeLocalePack({
    pack: {
        schema: LOCALE_NATIVE_PACK_SCHEMA,
        applicationId: 'app.locales-fixture',
        planVersion: 'plan.v0',
        localeId: 'en-us',
        signature: 'sig.ok',
        catalog: { 'account.actions.save': 'Save' },
        formatterDataVersion: FORMATTER_DATA_VERSION,
        entries: [{ path: 'catalog.json5', kind: 'catalog' }],
    },
    expectedApplicationId: 'app.locales-fixture',
    expectedPlanVersion: 'plan.v0',
});
if (goodPack.status !== 'ready') fail(`good pack: ${JSON.stringify(goodPack.diagnostics)}`);

const unsigned = validateNativeLocalePack({
    pack: {
        applicationId: 'app.locales-fixture',
        planVersion: 'plan.v0',
        localeId: 'en-us',
        catalog: {},
    },
    expectedApplicationId: 'app.locales-fixture',
    expectedPlanVersion: 'plan.v0',
});
if (!unsigned.diagnostics.some((d) => d.code === 'vmz::locale::native_pack_unsigned')) {
    fail('unsigned pack should fail');
}

const withJs = validateNativeLocalePack({
    pack: {
        applicationId: 'app.locales-fixture',
        planVersion: 'plan.v0',
        localeId: 'en-us',
        signature: 'sig',
        entries: [{ path: 'hook.js', kind: 'javascript' }],
    },
    expectedApplicationId: 'app.locales-fixture',
    expectedPlanVersion: 'plan.v0',
});
if (!withJs.diagnostics.some((d) => d.code === 'vmz::locale::native_pack_has_js')) {
    fail('JS pack should fail');
}

console.log('I4: Mini cross-package proof…');
const proven = proveMiniPackageMessages({
    packages: [
        { id: 'main', messageIds: ['account.actions.save'] },
        { id: 'pkg-account', messageIds: ['account.greeting'] },
    ],
    edges: [{ fromPackage: 'main', toPackage: 'pkg-account', messageId: 'account.greeting' }],
});
if (proven.status !== 'ready') fail(`mini proof: ${JSON.stringify(proven.diagnostics)}`);
const unproven = proveMiniPackageMessages({
    packages: [{ id: 'main', messageIds: ['account.actions.save'] }],
    edges: [{ fromPackage: 'main', toPackage: 'pkg-account', messageId: 'account.greeting' }],
});
if (unproven.status !== 'failed' || !unproven.diagnostics.some((d) => d.code === 'vmz::locale::mini_cross_package_unproven')) {
    fail('unproven mini edge should fail');
}

console.log('I4: server ErrorCode envelope + format context…');
const okErr = assertServerErrorEnvelope({ code: 'account.email_taken', params: { email: 'a@b.c' } });
if (okErr.status !== 'ready') fail('error envelope should pass');
const badErr = assertServerErrorEnvelope({ message: '邮箱已被占用' });
if (!badErr.diagnostics.some((d) => d.code === 'vmz::locale::server_translated_error')) {
    fail('translated server error should fail');
}
const fmt = assertServerFormatContext({ purpose: 'mail', localeContext: null });
if (!fmt.diagnostics.some((d) => d.code === 'vmz::locale::server_format_without_context')) {
    fail('format without context should fail');
}

console.log('I4: cross-host MessageId invariant…');
const mini = buildLocaleDeliveryResolution({ ...common, host: 'mini', deliveryId: 'delivery.mini' });
const native = buildLocaleDeliveryResolution({ ...common, host: 'native', deliveryId: 'delivery.native' });
const server = buildLocaleDeliveryResolution({
    ...common,
    host: 'server',
    deliveryId: 'delivery.server',
    bundledLocales: supported,
    allowFullClientBundle: true,
});
const inv = assertHostMessageInvariant([web, mini, native, server]);
if (!inv.ok) fail(`host invariant: ${JSON.stringify(inv.diagnostics)}`);

console.log('I4: CLI delivery-check on fixture…');
const cli = runVmz(['locale', 'delivery-check', fixture, '--json']);
if (cli.status !== 0) fail(`delivery-check failed\n${cli.stdout}\n${cli.stderr}`);
let report;
try {
    report = JSON.parse(cli.stdout);
} catch (e) {
    fail(`not JSON: ${e}\n${cli.stdout}`);
}
if (report.schema !== 'vmz.locale.delivery_check.v0' || report.status !== 'ready') {
    fail(`delivery report bad: ${JSON.stringify(report).slice(0, 800)}`);
}
if (!report.resolutions?.web?.lazyLocaleChunks?.length) fail('fixture web lazy chunks missing');

console.log('I4 GATE PASS');
console.log('  delivery resolution · native pack · mini proof · server envelope · host invariant');
