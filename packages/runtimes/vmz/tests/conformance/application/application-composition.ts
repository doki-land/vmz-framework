/**
 * application-composition: Host Composition.
 *
 * Proves ordinary hosts consume ApplicationCatalog (config-array order, no product
 * kinds) and resolve cross-application `<Link application to>` to document-navigation
 * hrefs under mount bases.
 *
 * Requires: `pnpm napi:build` + built `vmz` / `@vmz/protocol` JS
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { repoRoot } from '../_lib/repo-root.ts';
import {
    APPLICATION_CROSS_LINK_SCHEMA,
    APPLICATION_DESCRIPTOR_SCHEMA,
    APPLICATION_HOST_COMPOSITION_SCHEMA,
    APPLICATION_PROTOCOL,
    APPLICATIONS_CONFIG_SCHEMA,
    checkApplicationHostCompositionJson,
    queryApplicationProtocolCatalog,
} from 'vmz';

const root = repoRoot(import.meta.url);
const vmzBin = path.join(root, 'packages', 'runtimes', 'vmz', 'bin', 'vmz.js');

function fail(msg) {
    console.error(` GATE FAIL: ${msg}`);
    process.exit(1);
}

function writePkg(dir, name, id) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify(
            {
                name,
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

console.log('application-composition: protocol catalog includes host_composition / cross_link…');
const catalog = JSON.parse(queryApplicationProtocolCatalog());
if (catalog.protocol !== APPLICATION_PROTOCOL) fail('protocol');
for (const [kind, schema] of [
    ['cross_link', APPLICATION_CROSS_LINK_SCHEMA],
    ['host_composition', APPLICATION_HOST_COMPOSITION_SCHEMA],
]) {
    const row = catalog.documents.find((d) => d.kind === kind);
    if (!row || row.schema !== schema) fail(`missing ${kind}=${schema}`);
}
for (const code of ['vmz::application::route_not_public', 'vmz::application::mount_unreachable']) {
    if (!catalog.diagnostics.includes(code)) fail(`missing diagnostic ${code}`);
}

console.log('application-composition: catalog order + cross-app Link hrefs…');
const host = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-m4-host-'));
const alpha = path.join(host, 'packages', 'alpha');
const beta = path.join(host, 'packages', 'beta');
writePkg(alpha, '@gate/alpha', 'alpha');
writePkg(beta, '@gate/beta', 'beta');
fs.writeFileSync(path.join(host, 'package.json'), JSON.stringify({ name: '@gate/host', private: true, workspaces: ['packages/*'] }, null, 2));
fs.writeFileSync(
    path.join(host, 'applications.config.json5'),
    `{
  schema: '${APPLICATIONS_CONFIG_SCHEMA}',
  collections: [
    {
      id: 'public-apps',
      groups: [{ id: 'start', applications: ['beta', 'alpha'] }],
    },
  ],
  mounts: [
    { application: 'alpha', routeBase: '/apps/alpha' },
    { application: 'beta', routeBase: '/apps/beta' },
  ],
}
`,
);
fs.mkdirSync(path.join(host, 'src'), { recursive: true });
fs.writeFileSync(
    path.join(host, 'src', 'Index.vmz'),
    `<template>
  <section>
    <Link application="alpha" to="alpha.home" />
    <Link application="beta" to="beta.home" />
  </section>
</template>
`,
);

const report = JSON.parse(checkApplicationHostCompositionJson(host, [host, alpha, beta]));
if (report.schema !== APPLICATION_HOST_COMPOSITION_SCHEMA) fail(`schema ${report.schema}`);
if (report.diagnostics.some((d) => d.severity === 'error')) {
    fail(`unexpected errors: ${JSON.stringify(report.diagnostics)}`);
}
if (report.catalogOrderSource !== 'config-array') fail('catalogOrderSource');
const order = report.catalog.applications.map((a) => a.id);
if (JSON.stringify(order) !== JSON.stringify(['beta', 'alpha'])) {
    fail(`catalog order must follow config array, got ${JSON.stringify(order)}`);
}
for (const kind of ['homepage', 'examples', 'gallery']) {
    if (!report.forbiddenProductKinds.includes(kind)) fail(`missing forbidden kind ${kind}`);
}
if (report.crossApplicationLinks.length !== 2) {
    fail(`want 2 links, got ${report.crossApplicationLinks.length}`);
}
const alphaLink = report.crossApplicationLinks.find((l) => l.applicationId === 'alpha');
const betaLink = report.crossApplicationLinks.find((l) => l.applicationId === 'beta');
if (!alphaLink || alphaLink.href !== '/apps/alpha') fail(`alpha href ${JSON.stringify(alphaLink)}`);
if (!betaLink || betaLink.href !== '/apps/beta') fail(`beta href ${JSON.stringify(betaLink)}`);
if (!alphaLink.documentNavigation || !betaLink.documentNavigation) {
    fail('cross-app Links must be documentNavigation');
}
if (alphaLink.schema !== APPLICATION_CROSS_LINK_SCHEMA) fail('cross_link schema');

console.log('application-composition: route_not_public + unknown ApplicationId…');
const bad = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-m4-bad-'));
const only = path.join(bad, 'packages', 'alpha');
writePkg(only, '@gate/alpha', 'alpha');
fs.writeFileSync(
    path.join(bad, 'applications.config.json5'),
    `{
  schema: '${APPLICATIONS_CONFIG_SCHEMA}',
  collections: [],
  mounts: [{ application: 'alpha', routeBase: '/apps/alpha' }],
}
`,
);
fs.writeFileSync(
    path.join(bad, 'cross-links.json'),
    JSON.stringify([
        { application: 'alpha', to: 'alpha.secret' },
        { application: 'ghost', to: 'ghost.home' },
    ]),
);
const badReport = JSON.parse(checkApplicationHostCompositionJson(bad, [only]));
const codes = new Set(badReport.diagnostics.map((d) => d.code));
if (!codes.has('vmz::application::route_not_public')) {
    fail(`want route_not_public, got ${[...codes]}`);
}
if (!codes.has('vmz::application::unknown_reference')) {
    fail(`want unknown_reference, got ${[...codes]}`);
}

console.log('application-composition: mount_unreachable…');
const unmounted = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-m4-unmounted-'));
const u = path.join(unmounted, 'packages', 'alpha');
writePkg(u, '@gate/alpha', 'alpha');
fs.writeFileSync(
    path.join(unmounted, 'applications.config.json5'),
    `{
  schema: '${APPLICATIONS_CONFIG_SCHEMA}',
  collections: [{ id: 'c', groups: [{ id: 'g', applications: ['alpha'] }] }],
  mounts: [],
}
`,
);
fs.writeFileSync(path.join(unmounted, 'cross-links.json'), JSON.stringify([{ application: 'alpha', to: 'alpha.home' }]));
const umReport = JSON.parse(checkApplicationHostCompositionJson(unmounted, [u]));
if (!umReport.diagnostics.some((d) => d.code === 'vmz::application::mount_unreachable')) {
    fail(`want mount_unreachable, got ${JSON.stringify(umReport.diagnostics)}`);
}

console.log('application-composition: CLI application composition…');
const cli = spawnSync(process.execPath, [vmzBin, 'application', 'composition', host, '--json'], { encoding: 'utf8', cwd: root });
if (cli.status !== 0) fail(`CLI composition failed\n${cli.stdout}\n${cli.stderr}`);
const cliReport = JSON.parse(cli.stdout);
if (cliReport.schema !== APPLICATION_HOST_COMPOSITION_SCHEMA) fail('CLI schema');

fs.rmSync(host, { recursive: true, force: true });
fs.rmSync(bad, { recursive: true, force: true });
fs.rmSync(unmounted, { recursive: true, force: true });
console.log(' GATE OK: catalog consumption + cross-app Link document navigation');
