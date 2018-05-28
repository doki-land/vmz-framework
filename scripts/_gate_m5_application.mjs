/**
 * M5 gate: Dev / Test / Deploy.
 *
 * Proves per-ApplicationId independent sessions, dirty→affected selection
 * (child source does not rebuild siblings), MountTable proxy dispatch with
 * 503 application_unavailable, mounted-test selection modes, and deploy
 * adapter refs-only boundary.
 * Design: `规划设计/vmz/22` §7 / §10 M5.
 *
 * Usage (repo root): pnpm gate:m5
 * Requires: `pnpm napi:build` + built `vmz` / `@vmz/protocol` JS
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
    APPLICATION_AFFECTED_SCHEMA,
    APPLICATION_DEPLOY_ADAPTER_SCHEMA,
    APPLICATION_DESCRIPTOR_SCHEMA,
    APPLICATION_DEV_CHECK_SCHEMA,
    APPLICATION_DEV_SESSIONS_SCHEMA,
    APPLICATION_MOUNTED_TEST_SCHEMA,
    APPLICATION_PROTOCOL,
    APPLICATION_PROXY_DISPATCH_SCHEMA,
    APPLICATIONS_CONFIG_SCHEMA,
    checkApplicationDevTestDeployJson,
    queryApplicationProtocolCatalog,
} from 'vmz';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vmzBin = path.join(root, 'packages', 'runtimes', 'vmz', 'bin', 'vmz.js');

function fail(msg) {
    console.error(`M5 GATE FAIL: ${msg}`);
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

console.log('M5 gate: protocol catalog includes M5 documents…');
const catalog = JSON.parse(queryApplicationProtocolCatalog());
if (catalog.protocol !== APPLICATION_PROTOCOL) fail('protocol');
for (const [kind, schema] of [
    ['dev_sessions', APPLICATION_DEV_SESSIONS_SCHEMA],
    ['affected', APPLICATION_AFFECTED_SCHEMA],
    ['proxy_dispatch', APPLICATION_PROXY_DISPATCH_SCHEMA],
    ['mounted_test', APPLICATION_MOUNTED_TEST_SCHEMA],
    ['deploy_adapter', APPLICATION_DEPLOY_ADAPTER_SCHEMA],
    ['dev_check', APPLICATION_DEV_CHECK_SCHEMA],
]) {
    const row = catalog.documents.find((d) => d.kind === kind);
    if (!row || row.schema !== schema) fail(`missing ${kind}=${schema}`);
}
for (const code of ['vmz::application::session_shared', 'vmz::application::proxy_misroute', 'vmz::application::affected_leak']) {
    if (!catalog.diagnostics.includes(code)) fail(`missing diagnostic ${code}`);
}

console.log('M5 gate: sessions + affected + proxy + deploy…');
const host = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-m5-host-'));
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
    { id: 'public-apps', groups: [{ id: 'start', applications: ['alpha', 'beta'] }] },
  ],
  mounts: [
    { application: 'alpha', routeBase: '/apps/alpha' },
    { application: 'beta', routeBase: '/apps/beta' },
  ],
}
`,
);
fs.mkdirSync(path.join(alpha, 'src'), { recursive: true });
const dirty = path.join(alpha, 'src', 'Index.vmz');
fs.writeFileSync(dirty, '<template>alpha</template>\n');
fs.writeFileSync(path.join(host, 'unavailable-applications.json'), JSON.stringify(['beta']));

const report = JSON.parse(checkApplicationDevTestDeployJson(host, [host, alpha, beta], [dirty]));
if (report.schema !== APPLICATION_DEV_CHECK_SCHEMA) fail(`schema ${report.schema}`);
if (report.diagnostics.some((d) => d.severity === 'error')) {
    fail(`unexpected errors: ${JSON.stringify(report.diagnostics)}`);
}
if (report.sessions.schema !== APPLICATION_DEV_SESSIONS_SCHEMA) fail('sessions schema');
if (report.sessions.sessions.length !== 3) {
    fail(`want 3 sessions, got ${report.sessions.sessions.length}`);
}
if (!report.sessions.sessions.every((s) => s.independent === true)) {
    fail('all sessions must be independent');
}

if (report.affected.schema !== APPLICATION_AFFECTED_SCHEMA) fail('affected schema');
const rebuilt = report.affected.units.map((u) => u.applicationId);
if (JSON.stringify(rebuilt) !== JSON.stringify(['alpha'])) {
    fail(`child_source must rebuild only alpha, got ${JSON.stringify(rebuilt)}`);
}
if (!report.affected.notRebuilt.includes('beta')) {
    fail('beta must be in notRebuilt');
}
if (!report.affected.units.every((u) => u.reason === 'child_source')) {
    fail('expected child_source reason');
}

if (report.proxy.schema !== APPLICATION_PROXY_DISPATCH_SCHEMA) fail('proxy schema');
const alphaCase = report.proxy.cases.find((c) => c.url === '/apps/alpha');
const betaCase = report.proxy.cases.find((c) => c.url === '/apps/beta');
const miss = report.proxy.cases.find((c) => c.url === '/__vmz_no_such_mount');
if (!alphaCase || alphaCase.status !== 200 || alphaCase.applicationId !== 'alpha') {
    fail(`alpha proxy ${JSON.stringify(alphaCase)}`);
}
if (!betaCase || betaCase.status !== 503 || betaCase.reason !== 'application_unavailable' || betaCase.applicationId !== 'beta') {
    fail(`beta unavailable proxy ${JSON.stringify(betaCase)}`);
}
if (!miss || miss.status !== 404) fail(`404 case ${JSON.stringify(miss)}`);

if (report.tests.schema !== APPLICATION_MOUNTED_TEST_SCHEMA) fail('tests schema');
if (report.tests.application.testScope !== 'standalone') fail('application testScope');
if (JSON.stringify(report.tests.mounted.contracts) !== JSON.stringify(['relocation', 'host_boundary'])) {
    fail(`mounted contracts ${JSON.stringify(report.tests.mounted.contracts)}`);
}
if (!report.tests.mounted.selectedApplicationIds.includes('alpha')) {
    fail('mounted selection must include target app');
}

if (report.deploy.schema !== APPLICATION_DEPLOY_ADAPTER_SCHEMA) fail('deploy schema');
if (!report.deploy.mountTableRefsOnly) fail('mountTableRefsOnly');
if (!report.deploy.perApplicationDeploymentRefs) fail('perApplicationDeploymentRefs');
if (!report.deploy.adapters.includes('vmz-deployment-adapter')) fail('adapter list');

console.log('M5 gate: CLI application dev…');
const cli = spawnSync(process.execPath, [vmzBin, 'application', 'dev', host, '--dirty', dirty, '--json'], { encoding: 'utf8', cwd: root });
if (cli.status !== 0) fail(`CLI dev failed\n${cli.stdout}\n${cli.stderr}`);
const cliReport = JSON.parse(cli.stdout);
if (cliReport.schema !== APPLICATION_DEV_CHECK_SCHEMA) fail('CLI schema');
if (JSON.stringify(cliReport.affected.units.map((u) => u.applicationId)) !== JSON.stringify(['alpha'])) {
    fail('CLI affected mismatch');
}

console.log('M5 gate: CLI test --application / --mounted help surface…');
const help = spawnSync(process.execPath, [vmzBin, 'help'], { encoding: 'utf8', cwd: root });
if (help.status !== 0) fail(`help failed\n${help.stderr}`);
if (!String(help.stdout).includes('--application') || !String(help.stdout).includes('--mounted')) {
    fail('CLI help must document --application / --mounted');
}

fs.rmSync(host, { recursive: true, force: true });
console.log('M5 GATE OK: sessions + affected + proxy + mounted tests + deploy adapter');
