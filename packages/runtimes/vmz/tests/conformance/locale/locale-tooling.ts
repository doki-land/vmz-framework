/**
 * locale tooling / conformance gate:
 * - explain MessageId
 * - diff locales
 * - extract hardcoded + dynamic t
 * - pseudo locale (dev-only)
 * - cross-host conformance
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from '../_lib/repo-root.ts';
import {
    LOCALE_CONFORMANCE_SCHEMA,
    LOCALE_DIFF_SCHEMA,
    LOCALE_EXPLAIN_SCHEMA,
    LOCALE_EXTRACT_SCHEMA,
    LOCALE_PSEUDO_SCHEMA,
    localeCatalog,
} from 'vmz';
import {
    checkLocaleConformance,
    diffLocaleCatalogs,
    explainLocaleMessage,
    extractHardcodedText,
    pseudoLocalizeCatalog,
} from '../../../dist/locale-tooling.js';

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

console.log(': protocol freezes tooling schemas…');
const cat = localeCatalog();
for (const kind of ['explain', 'diff', 'extract', 'pseudo', 'conformance']) {
    if (!cat.documents.some((d) => d.kind === kind)) fail(`missing document ${kind}`);
}
if (!cat.diagnostics.includes('vmz::locale::hardcoded_text')) fail('missing hardcoded_text');
if (!cat.diagnostics.includes('vmz::locale::message_dynamic_id_unbounded')) fail('missing dynamic_id');

console.log(': CLI explain…');
const explain = runVmz(['locale', 'explain', 'account.actions.save', fixture, '--json']);
if (explain.status !== 0) fail(`explain failed\n${explain.stdout}\n${explain.stderr}`);
const explained = JSON.parse(explain.stdout);
if (explained.schema !== LOCALE_EXPLAIN_SCHEMA || explained.status !== 'ready') {
    fail(`explain report: ${JSON.stringify(explained).slice(0, 600)}`);
}
if (!explained.variants?.['zh-hans'] || explained.resolvedLocale !== 'zh-hans') {
    fail('explain missing zh-hans variant');
}
const unknown = runVmz(['locale', 'explain', 'account.nope', fixture, '--json']);
if (unknown.status === 0) fail('unknown MessageId should fail');
const unknownReport = JSON.parse(unknown.stdout);
if (!unknownReport.diagnostics?.some((d) => d.code === 'vmz::locale::explain_unknown')) {
    fail('want explain_unknown');
}

console.log(': diff catalogs…');
const diff = runVmz(['locale', 'diff', 'zh-hans', 'en-us', fixture, '--json']);
if (diff.status !== 0) fail(`diff failed\n${diff.stdout}\n${diff.stderr}`);
const diffed = JSON.parse(diff.stdout);
if (diffed.schema !== LOCALE_DIFF_SCHEMA || !diffed.changed?.length) {
    fail(`diff should show changed templates: ${JSON.stringify(diffed.summary)}`);
}

console.log(': extract hardcoded / dynamic id…');
const clean = extractHardcodedText(fixture, { check: true });
if (clean.schema !== LOCALE_EXTRACT_SCHEMA) fail('extract schema');
if (clean.diagnostics.some((d) => d.severity === 'error')) {
    fail(`fixture extract errors: ${JSON.stringify(clean.diagnostics).slice(0, 600)}`);
}

const dirty = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-i5-extract-'));
fs.mkdirSync(path.join(dirty, 'src'), { recursive: true });
fs.writeFileSync(
    path.join(dirty, 'src', 'Bad.vmz'),
    `<script client>
export default class Bad {
  label = '保存并继续';
  msg() { return t(this.key); }
}
</script>
`,
);
const extracted = extractHardcodedText(dirty, { check: true });
if (extracted.status !== 'failed') fail('dirty extract should fail with --check');
if (!extracted.diagnostics.some((d) => d.code === 'vmz::locale::hardcoded_text')) {
    fail('want hardcoded_text');
}
if (!extracted.diagnostics.some((d) => d.code === 'vmz::locale::message_dynamic_id_unbounded')) {
    fail('want message_dynamic_id_unbounded');
}

console.log(': pseudo locale…');
const messages = [
    {
        messageId: 'account.greeting',
        variants: { 'zh-hans': { template: '你好，{name}' } },
    },
];
const pseudo = pseudoLocalizeCatalog({ sourceLocale: 'zh-hans', messages });
if (pseudo.schema !== LOCALE_PSEUDO_SCHEMA || pseudo.status !== 'ready') fail('pseudo failed');
if (!pseudo.catalog['account.greeting']?.includes('{name}')) fail('pseudo must keep placeholders');
if (!pseudo.catalog['account.greeting']?.startsWith('[!!')) fail('pseudo provenance wrapper');
const prodPseudo = pseudoLocalizeCatalog({ sourceLocale: 'zh-hans', messages, production: true });
if (prodPseudo.status !== 'failed' || !prodPseudo.diagnostics.some((d) => d.code === 'vmz::locale::pseudo_production_forbidden')) {
    fail('pseudo production must fail');
}

const cliPseudo = runVmz(['locale', 'pseudo', 'zh-hans', fixture, '--json']);
if (cliPseudo.status !== 0) fail(`cli pseudo failed\n${cliPseudo.stdout}\n${cliPseudo.stderr}`);

console.log(': cross-host conformance…');
const conf = runVmz(['locale', 'conformance', fixture, '--json']);
if (conf.status !== 0) fail(`conformance failed\n${conf.stdout}\n${conf.stderr}`);
const confReport = JSON.parse(conf.stdout);
if (confReport.schema !== LOCALE_CONFORMANCE_SCHEMA || confReport.status !== 'ready') {
    fail(`conformance: ${JSON.stringify(confReport).slice(0, 600)}`);
}
const badRoute = checkLocaleConformance({
    manifest: {
        defaultLocale: 'zh-hans',
        locales: [{ id: 'zh-hans' }, { id: 'en-us' }],
        fallback: {},
    },
    messages: [
        {
            messageId: 'account.actions.save',
            variants: { 'zh-hans': { template: '保存' }, 'en-us': { template: 'Save' } },
        },
    ],
    routeIds: ['account.zh-hans.profile'],
});
if (badRoute.status !== 'failed' || !badRoute.diagnostics.some((d) => d.code === 'vmz::locale::conformance_divergence')) {
    fail('RouteId embedding LocaleId should fail conformance');
}

// library explain/diff smoke
const libExplain = explainLocaleMessage({
    messageId: 'account.greeting',
    checkReport: {
        manifest: {
            defaultLocale: 'zh-hans',
            locales: [{ id: 'zh-hans' }, { id: 'en-us' }],
            fallback: {},
        },
        messageCatalog: {
            messages: [
                {
                    messageId: 'account.greeting',
                    catalogId: 'account',
                    variants: {
                        'zh-hans': { template: '你好，{name}', params: [{ name: 'name', kind: 'string' }] },
                        'en-us': { template: 'Hello, {name}', params: [{ name: 'name', kind: 'string' }] },
                    },
                },
            ],
        },
    },
});
if (libExplain.status !== 'ready') fail('lib explain');
const libDiff = diffLocaleCatalogs({
    baseLocale: 'zh-hans',
    targetLocale: 'en-us',
    messages: libExplain.variants
        ? [
              {
                  messageId: 'account.greeting',
                  variants: Object.fromEntries(
                      Object.entries(libExplain.variants).map(([k, v]) => [k, { template: v.template, params: v.params }]),
                  ),
              },
          ]
        : [],
});
if (libDiff.schema !== LOCALE_DIFF_SCHEMA) fail('lib diff schema');

console.log(' GATE PASS');
console.log(' explain · diff · extract · pseudo · conformance');
