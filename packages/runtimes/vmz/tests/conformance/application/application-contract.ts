/**
 * application-contract: Application Collection / Mount contract.
 *
 * Freezes descriptor + applications.config.json5 schemas, ApplicationId resolution,
 * mount collision / unknown reference / duplicate id diagnostics.
 *
 * Requires: `pnpm napi:build` (or existing packages/runtimes/vmz/*.node)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from '../_lib/repo-root.ts';
import {
    APPLICATION_CATALOG_SCHEMA,
    APPLICATION_CHECK_SCHEMA,
    APPLICATION_DESCRIPTOR_SCHEMA,
    APPLICATION_PROTOCOL,
    APPLICATIONS_CONFIG_SCHEMA,
    checkApplicationsJson,
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
                        tags: ['gate'],
                    },
                },
            },
            null,
            2,
        ),
    );
}

console.log('application-contract: protocol catalog…');
let catalog;
try {
    catalog = JSON.parse(queryApplicationProtocolCatalog());
} catch (e) {
    fail(`catalog not JSON: ${e}`);
}
if (catalog.schema !== APPLICATION_PROTOCOL || catalog.protocol !== APPLICATION_PROTOCOL) {
    fail(`protocol mismatch: ${JSON.stringify(catalog).slice(0, 300)}`);
}
const wantDocs = [
    ['descriptor', APPLICATION_DESCRIPTOR_SCHEMA],
    ['config', APPLICATIONS_CONFIG_SCHEMA],
    ['catalog', APPLICATION_CATALOG_SCHEMA],
    ['check', APPLICATION_CHECK_SCHEMA],
];
for (const [kind, schema] of wantDocs) {
    const row = catalog.documents.find((d) => d.kind === kind);
    if (!row || row.schema !== schema) fail(`catalog missing ${kind}=${schema}`);
}
for (const code of ['vmz::application::duplicate_id', 'vmz::application::unknown_reference', 'vmz::application::mount_collision']) {
    if (!catalog.diagnostics.includes(code)) fail(`catalog missing diagnostic ${code}`);
}

console.log('application-contract: happy path + catalog order…');
const host = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-m0-host-'));
const zebra = path.join(host, 'packages', 'zebra-dir');
const aardvark = path.join(host, 'packages', 'aardvark-dir');
writePkg(zebra, '@gate/zebra', 'zebra');
writePkg(aardvark, '@gate/aardvark', 'aardvark');
fs.writeFileSync(path.join(host, 'package.json'), JSON.stringify({ name: '@gate/host', private: true, workspaces: ['packages/*'] }, null, 2));
fs.writeFileSync(
    path.join(host, 'applications.config.json5'),
    `{
  schema: '${APPLICATIONS_CONFIG_SCHEMA}',
  collections: [
    {
      id: 'public-apps',
      groups: [
        { id: 'start', title: 'Start', applications: ['zebra', 'aardvark'] },
      ],
    },
  ],
  mounts: [
    { application: 'zebra', routeBase: '/apps/zebra' },
    { application: 'aardvark', routeBase: '/apps/aardvark' },
  ],
}
`,
);

const okRaw = checkApplicationsJson(host, [host, zebra, aardvark]);
let ok;
try {
    ok = JSON.parse(okRaw);
} catch (e) {
    fail(`check report not JSON: ${e}`);
}
if (ok.schema !== APPLICATION_CHECK_SCHEMA) fail(`check schema: ${ok.schema}`);
if (ok.diagnostics.some((d) => d.severity === 'error')) {
    fail(`happy path errors: ${JSON.stringify(ok.diagnostics)}`);
}
if (ok.catalog.schema !== APPLICATION_CATALOG_SCHEMA) fail('catalog schema');
const order = ok.catalog.applications.map((a) => a.id);
if (JSON.stringify(order) !== JSON.stringify(['zebra', 'aardvark'])) {
    fail(`catalog order must follow config array, got ${JSON.stringify(order)}`);
}
if (ok.catalog.applications[0].routeBase !== '/apps/zebra') {
    fail(`catalog routeBase: ${ok.catalog.applications[0].routeBase}`);
}

console.log('application-contract: directory name is not ApplicationId…');
const onlyDir = ok.descriptors.every((d) => d.id === 'zebra' || d.id === 'aardvark');
if (!onlyDir) fail('descriptor ids must come from package.json, not directory names');
if (ok.descriptors.some((d) => d.id === 'zebra-dir' || d.id === 'aardvark-dir')) {
    fail('must not derive ApplicationId from directory name');
}

console.log('application-contract: mount collision + unknown reference…');
const bad = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-m0-bad-'));
const alpha = path.join(bad, 'alpha');
const beta = path.join(bad, 'beta');
writePkg(alpha, '@gate/alpha', 'alpha');
writePkg(beta, '@gate/beta', 'beta');
fs.writeFileSync(
    path.join(bad, 'applications.config.json5'),
    `{
  schema: '${APPLICATIONS_CONFIG_SCHEMA}',
  collections: [
    { id: 'c', groups: [{ id: 'g', applications: ['ghost'] }] },
  ],
  mounts: [
    { application: 'alpha', routeBase: '/examples' },
    { application: 'beta', routeBase: '/examples/beta' },
  ],
}
`,
);
const badReport = JSON.parse(checkApplicationsJson(bad, [alpha, beta]));
const codes = new Set(badReport.diagnostics.map((d) => d.code));
if (!codes.has('vmz::application::unknown_reference')) {
    fail(`want unknown_reference, got ${[...codes]}`);
}
if (!codes.has('vmz::application::mount_collision')) {
    fail(`want mount_collision, got ${[...codes]}`);
}

console.log('application-contract: duplicate ApplicationId…');
const dup = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-m0-dup-'));
const d1 = path.join(dup, 'one');
const d2 = path.join(dup, 'two');
writePkg(d1, '@gate/one', 'same');
writePkg(d2, '@gate/two', 'same');
const dupReport = JSON.parse(checkApplicationsJson(dup, [d1, d2]));
if (!dupReport.diagnostics.some((d) => d.code === 'vmz::application::duplicate_id')) {
    fail(`want duplicate_id, got ${JSON.stringify(dupReport.diagnostics)}`);
}

console.log('application-contract: CLI application check…');
const { spawnSync } = await import('node:child_process');
const cli = spawnSync(process.execPath, [vmzBin, 'application', 'check', host, '--json'], {
    encoding: 'utf8',
    cwd: root,
});
if (cli.status !== 0) fail(`CLI check failed\n${cli.stdout}\n${cli.stderr}`);
let cliReport;
try {
    cliReport = JSON.parse(cli.stdout);
} catch (e) {
    fail(`CLI stdout not JSON: ${cli.stdout.slice(0, 400)}`);
}
if (cliReport.schema !== APPLICATION_CHECK_SCHEMA) fail('CLI schema');

const schemasCli = spawnSync(process.execPath, [vmzBin, 'application', 'schemas'], {
    encoding: 'utf8',
    cwd: root,
});
if (schemasCli.status !== 0) fail(`CLI schemas failed\n${schemasCli.stderr}`);
const schemasOut = JSON.parse(schemasCli.stdout);
if (schemasOut.protocol !== APPLICATION_PROTOCOL) fail('CLI schemas protocol');

fs.rmSync(host, { recursive: true, force: true });
fs.rmSync(bad, { recursive: true, force: true });
fs.rmSync(dup, { recursive: true, force: true });

console.log(' GATE OK: schemas + ApplicationId resolution + mount collision + CLI');
