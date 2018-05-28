/**
 * M1 gate: Independent / Relocatable ApplicationBase.
 *
 * Proves logical `/` compile surfaces relocate under an arbitrary non-root base,
 * join/strip round-trip, and non_relocatable_url diagnostics.
 * Design: `规划设计/vmz/22` §10 M1.
 *
 * Usage (repo root): pnpm gate:m1
 * Requires: `pnpm napi:build`
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
    APPLICATION_BASE_SCHEMA,
    APPLICATION_PROTOCOL,
    APPLICATION_RELOCATABLE_CHECK_SCHEMA,
    APPLICATION_RELOCATED_SCHEMA,
    APPLICATION_RELOCATION_SCHEMA,
    APPLICATION_DESCRIPTOR_SCHEMA,
    checkApplicationRelocatableJson,
    queryApplicationProtocolCatalog,
    relocateApplicationManifestJson,
} from 'vmz';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vmzBin = path.join(root, 'packages', 'runtimes', 'vmz', 'bin', 'vmz.js');

function fail(msg) {
    console.error(`M1 GATE FAIL: ${msg}`);
    process.exit(1);
}

function writePkg(dir, id) {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify(
            {
                name: `@gate/${id}`,
                vmz: {
                    application: {
                        schema: APPLICATION_DESCRIPTOR_SCHEMA,
                        id,
                        entryRoute: `${id}.home`,
                        title: id,
                    },
                },
            },
            null,
            2,
        ),
    );
}

console.log('M1 gate: protocol catalog includes base/relocation…');
const catalog = JSON.parse(queryApplicationProtocolCatalog());
if (catalog.protocol !== APPLICATION_PROTOCOL) fail('protocol');
for (const [kind, schema] of [
    ['base', APPLICATION_BASE_SCHEMA],
    ['relocation', APPLICATION_RELOCATION_SCHEMA],
    ['relocated', APPLICATION_RELOCATED_SCHEMA],
    ['relocatable', APPLICATION_RELOCATABLE_CHECK_SCHEMA],
]) {
    const row = catalog.documents.find((d) => d.kind === kind);
    if (!row || row.schema !== schema) fail(`missing ${kind}=${schema}`);
}
if (!catalog.diagnostics.includes('vmz::application::non_relocatable_url')) {
    fail('missing non_relocatable_url diagnostic');
}

console.log('M1 gate: independent `/` + non-root relocation proof…');
const app = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-m1-app-'));
writePkg(app, 'counter');
fs.writeFileSync(
    path.join(app, 'src', 'App.vmz'),
    `<template><p>{n}</p></template>
<script client>
export default class App {
  n = 0
  // @vmz-external
  docs = 'https://example.com/x'
}
</script>
`,
);

const proofBase = '/examples/counter';
const report = JSON.parse(checkApplicationRelocatableJson(app, proofBase));
if (report.schema !== APPLICATION_RELOCATABLE_CHECK_SCHEMA) fail(`schema ${report.schema}`);
if (report.diagnostics.some((d) => d.severity === 'error')) {
    fail(`unexpected errors: ${JSON.stringify(report.diagnostics)}`);
}
if (report.manifest.logicalBase !== '/') fail('logicalBase must be /');
if (report.atRoot.base !== '/') fail('atRoot.base');
if (report.atRelocated.base !== proofBase) fail(`atRelocated.base ${report.atRelocated.base}`);

const kinds = new Set(report.manifest.entries.map((e) => e.kind));
for (const k of [
    'route',
    'asset',
    'module',
    'preload',
    'form',
    'redirect',
    'canonical',
    'sitemap',
    'server',
    'ssr',
    'resume',
    'sw',
    'sourcemap',
    'trace',
    'error',
]) {
    if (!kinds.has(k)) fail(`manifest missing kind ${k}`);
}

const rootSettings = report.atRoot.entries.find((e) => e.logicalPath === '/settings');
const relocatedSettings = report.atRelocated.entries.find((e) => e.logicalPath === '/settings');
if (!rootSettings || rootSettings.href !== '/settings') {
    fail(`root settings ${JSON.stringify(rootSettings)}`);
}
if (!relocatedSettings || relocatedSettings.href !== '/examples/counter/settings') {
    fail(`relocated settings ${JSON.stringify(relocatedSettings)}`);
}
const rootHome = report.atRoot.entries.find((e) => e.logicalPath === '/');
const relocatedHome = report.atRelocated.entries.find((e) => e.logicalPath === '/');
if (!rootHome || rootHome.href !== '/') fail('root home');
if (!relocatedHome || relocatedHome.href !== '/examples/counter') fail('relocated home');

console.log('M1 gate: strip ApplicationBase round-trip…');
for (const e of report.atRelocated.entries) {
    const href = e.href;
    let logical;
    if (href === proofBase) logical = '/';
    else if (href.startsWith(`${proofBase}/`)) logical = `/${href.slice(proofBase.length + 1)}`;
    else fail(`relocated href not under base: ${href}`);
    if (logical !== e.logicalPath) {
        fail(`strip mismatch: href=${href} → ${logical}, want ${e.logicalPath}`);
    }
}

console.log('M1 gate: relocateApplicationManifestJson…');
const relocatedRaw = relocateApplicationManifestJson(JSON.stringify(report.manifest), '/apps/demo');
const relocated = JSON.parse(relocatedRaw);
if (relocated.schema !== APPLICATION_RELOCATED_SCHEMA) fail('relocated schema');
const demoSettings = relocated.entries.find((e) => e.logicalPath === '/settings');
if (!demoSettings || demoSettings.href !== '/apps/demo/settings') {
    fail(`demo settings ${JSON.stringify(demoSettings)}`);
}

console.log('M1 gate: non_relocatable_url diagnostic…');
const bad = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-m1-bad-'));
writePkg(bad, 'bad');
fs.writeFileSync(
    path.join(bad, 'src', 'Bad.vmz'),
    `<template><a href="/settings">go</a></template>
<script client>
export default class Bad {
  logo = '/assets/logo.png'
}
</script>
`,
);
const badReport = JSON.parse(checkApplicationRelocatableJson(bad));
const codes = new Set(badReport.diagnostics.map((d) => d.code));
if (!codes.has('vmz::application::non_relocatable_url')) {
    fail(`want non_relocatable_url, got ${[...codes]}`);
}

console.log('M1 gate: CLI application relocatable…');
const cli = spawnSync(process.execPath, [vmzBin, 'application', 'relocatable', app, '--base', proofBase, '--json'], {
    encoding: 'utf8',
    cwd: root,
});
if (cli.status !== 0) fail(`CLI relocatable failed\n${cli.stdout}\n${cli.stderr}`);
const cliReport = JSON.parse(cli.stdout);
if (cliReport.schema !== APPLICATION_RELOCATABLE_CHECK_SCHEMA) fail('CLI schema');

fs.rmSync(app, { recursive: true, force: true });
fs.rmSync(bad, { recursive: true, force: true });
console.log('M1 GATE OK: ApplicationBase join/strip + relocatable surfaces + non_relocatable_url');
