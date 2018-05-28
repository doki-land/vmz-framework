/**
 * M3 gate: Application Isolation.
 *
 * Proves per-ApplicationId runtime/style/state/server/session/storage/trace
 * namespaces are unique, and failure containment returns structured 503
 * application_unavailable without taking down host/siblings.
 * Design: `规划设计/vmz/22` §10 M3.
 *
 * Usage (repo root): pnpm gate:m3
 * Requires: `pnpm napi:build` + built `vmz` / `@vmz/protocol` JS
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
    APPLICATION_DESCRIPTOR_SCHEMA,
    APPLICATION_ISOLATION_CHECK_SCHEMA,
    APPLICATION_ISOLATION_SCHEMA,
    APPLICATION_PROTOCOL,
    APPLICATIONS_CONFIG_SCHEMA,
    checkApplicationIsolationJson,
    queryApplicationProtocolCatalog,
} from 'vmz';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vmzBin = path.join(root, 'packages', 'runtimes', 'vmz', 'bin', 'vmz.js');

function fail(msg) {
    console.error(`M3 GATE FAIL: ${msg}`);
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

console.log('M3 gate: protocol catalog includes isolation…');
const catalog = JSON.parse(queryApplicationProtocolCatalog());
if (catalog.protocol !== APPLICATION_PROTOCOL) fail('protocol');
for (const [kind, schema] of [
    ['isolation', APPLICATION_ISOLATION_SCHEMA],
    ['isolation_check', APPLICATION_ISOLATION_CHECK_SCHEMA],
]) {
    const row = catalog.documents.find((d) => d.kind === kind);
    if (!row || row.schema !== schema) fail(`missing ${kind}=${schema}`);
}
for (const code of ['vmz::application::isolation_unproven', 'vmz::application::failure_containment']) {
    if (!catalog.diagnostics.includes(code)) fail(`missing diagnostic ${code}`);
}

console.log('M3 gate: unique namespaces + failure containment 503…');
const host = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-m3-host-'));
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
      groups: [{ id: 'start', applications: ['alpha', 'beta'] }],
    },
  ],
  mounts: [
    { application: 'alpha', routeBase: '/apps/alpha' },
    { application: 'beta', routeBase: '/apps/beta' },
  ],
}
`,
);

const report = JSON.parse(checkApplicationIsolationJson(host, [host, alpha, beta]));
if (report.schema !== APPLICATION_ISOLATION_CHECK_SCHEMA) fail(`schema ${report.schema}`);
if (report.diagnostics.some((d) => d.severity === 'error')) {
    fail(`unexpected errors: ${JSON.stringify(report.diagnostics)}`);
}
if (!Array.isArray(report.surfaces) || report.surfaces.length < 8) {
    fail(`surfaces ${JSON.stringify(report.surfaces)}`);
}
if (report.namespaces.length !== 2) fail(`want 2 namespaces, got ${report.namespaces.length}`);

const byId = Object.fromEntries(report.namespaces.map((n) => [n.applicationId, n]));
if (!byId.alpha || !byId.beta) fail('missing alpha/beta namespaces');
for (const id of ['alpha', 'beta']) {
    const ns = byId[id];
    if (ns.schema !== APPLICATION_ISOLATION_SCHEMA) fail(`${id} schema`);
    if (ns.style !== `vmz:style:${id}`) fail(`${id} style`);
    if (ns.state !== `vmz:state:${id}`) fail(`${id} state`);
    if (ns.server !== `vmz:server:${id}`) fail(`${id} server`);
    if (ns.session !== `vmz:session:${id}`) fail(`${id} session`);
    if (ns.storage !== `vmz:storage:${id}`) fail(`${id} storage`);
    if (ns.trace !== `vmz:trace:${id}`) fail(`${id} trace`);
    if (!ns.runtime.includes(id)) fail(`${id} runtime`);
}

const styleSet = new Set(report.namespaces.map((n) => n.style));
const runtimeSet = new Set(report.namespaces.map((n) => n.runtime));
const sessionSet = new Set(report.namespaces.map((n) => n.session));
if (styleSet.size !== 2) fail('style namespaces must be unique');
if (runtimeSet.size !== 2) fail('runtime namespaces must be unique');
if (sessionSet.size !== 2) fail('session namespaces must be unique');

if (report.failureContainment.length !== 2) {
    fail(`want 2 failureContainment proofs, got ${report.failureContainment.length}`);
}
for (const proof of report.failureContainment) {
    if (!proof.hostSurvives) fail(`host must survive failure of ${proof.failedApplicationId}`);
    if (proof.unavailable.status !== 503) {
        fail(`want 503, got ${proof.unavailable.status} for ${proof.failedApplicationId}`);
    }
    if (proof.unavailable.reason !== 'application_unavailable') {
        fail(`want application_unavailable, got ${proof.unavailable.reason}`);
    }
    const failed = proof.failedApplicationId;
    if (proof.siblingsSurvive.includes(failed)) fail('failed app listed as surviving sibling');
    const other = failed === 'alpha' ? 'beta' : 'alpha';
    if (!proof.siblingsSurvive.includes(other)) {
        fail(`sibling ${other} must survive failure of ${failed}`);
    }
}

console.log('M3 gate: CLI application isolation…');
const cli = spawnSync(process.execPath, [vmzBin, 'application', 'isolation', host, '--json'], { encoding: 'utf8', cwd: root });
if (cli.status !== 0) fail(`CLI isolation failed\n${cli.stdout}\n${cli.stderr}`);
const cliReport = JSON.parse(cli.stdout);
if (cliReport.schema !== APPLICATION_ISOLATION_CHECK_SCHEMA) fail('CLI schema');
if (cliReport.namespaces.length !== 2) fail('CLI namespaces count');
if (cliReport.failureContainment.some((p) => p.unavailable.status !== 503)) {
    fail('CLI containment status');
}

fs.rmSync(host, { recursive: true, force: true });
console.log('M3 GATE OK: isolation namespaces + failure containment 503 + CLI');
