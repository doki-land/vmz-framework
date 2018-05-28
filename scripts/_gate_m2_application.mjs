/**
 * M2 gate: Application Artifact Boundary.
 *
 * Proves independent ApplicationArtifact per ApplicationId, host MountTable/Catalog
 * hold refs only (no Program Graph / Execution Plan bodies), unique executable
 * ownership, and integrity linkage.
 * Design: `规划设计/vmz/22` §7.1 / §10 M2.
 *
 * Usage (repo root): pnpm gate:m2
 * Requires: `pnpm napi:build` + built `vmz` / `@vmz/protocol` JS
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
    APPLICATION_ARTIFACT_BOUNDARY_SCHEMA,
    APPLICATION_ARTIFACT_SCHEMA,
    APPLICATION_CATALOG_SCHEMA,
    APPLICATION_DESCRIPTOR_SCHEMA,
    APPLICATION_MOUNT_TABLE_SCHEMA,
    APPLICATION_PROTOCOL,
    APPLICATIONS_CONFIG_SCHEMA,
    checkApplicationArtifactBoundaryJson,
    queryApplicationProtocolCatalog,
} from 'vmz';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vmzBin = path.join(root, 'packages', 'runtimes', 'vmz', 'bin', 'vmz.js');

function fail(msg) {
    console.error(`M2 GATE FAIL: ${msg}`);
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

console.log('M2 gate: protocol catalog includes artifact/mount_table…');
const catalog = JSON.parse(queryApplicationProtocolCatalog());
if (catalog.protocol !== APPLICATION_PROTOCOL) fail('protocol');
for (const [kind, schema] of [
    ['artifact', APPLICATION_ARTIFACT_SCHEMA],
    ['mount_table', APPLICATION_MOUNT_TABLE_SCHEMA],
    ['artifact_boundary', APPLICATION_ARTIFACT_BOUNDARY_SCHEMA],
]) {
    const row = catalog.documents.find((d) => d.kind === kind);
    if (!row || row.schema !== schema) fail(`missing ${kind}=${schema}`);
}
for (const code of ['vmz::application::artifact_integrity', 'vmz::application::cross_runtime_reference']) {
    if (!catalog.diagnostics.includes(code)) fail(`missing diagnostic ${code}`);
}

console.log('M2 gate: independent artifacts + MountTable refs…');
const host = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-m2-host-'));
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

const report = JSON.parse(checkApplicationArtifactBoundaryJson(host, [host, alpha, beta]));
if (report.schema !== APPLICATION_ARTIFACT_BOUNDARY_SCHEMA) fail(`schema ${report.schema}`);
if (report.diagnostics.some((d) => d.severity === 'error')) {
    fail(`unexpected errors: ${JSON.stringify(report.diagnostics)}`);
}
if (report.artifacts.length !== 2) fail(`want 2 artifacts, got ${report.artifacts.length}`);
if (report.mountTable.schema !== APPLICATION_MOUNT_TABLE_SCHEMA) fail('mountTable schema');
if (report.catalog.schema !== APPLICATION_CATALOG_SCHEMA) fail('catalog schema');

const graphHashes = new Set(report.artifacts.map((a) => a.programGraphRef.hash));
const planHashes = new Set(report.artifacts.map((a) => a.executionPlanRef.hash));
const execIds = new Set(report.artifacts.map((a) => a.executableModuleId));
if (graphHashes.size !== 2) fail('programGraphRef hashes must be unique per ApplicationId');
if (planHashes.size !== 2) fail('executionPlanRef hashes must be unique per ApplicationId');
if (execIds.size !== 2) fail('executableModuleId must be unique per ApplicationId');

for (const a of report.artifacts) {
    for (const key of ['programGraphRef', 'executionPlanRef', 'routeManifestRef', 'assetManifestRef', 'serverDeploymentRef']) {
        if (!a[key] || !a[key].hash || !a[key].kind) fail(`artifact ${a.applicationId} missing ${key}`);
    }
    if (!a.integrity || a.integrity.length < 16) fail(`artifact ${a.applicationId} integrity`);
    if (!Array.isArray(a.publicRouteContracts) || !a.publicRouteContracts.includes(`${a.applicationId}.home`)) {
        fail(`publicRouteContracts for ${a.applicationId}`);
    }
}

const mountJson = JSON.stringify(report.mountTable);
for (const forbidden of ['"programGraph"', '"executionPlan"', '"executableModule"', '"modules"']) {
    if (mountJson.includes(forbidden)) fail(`MountTable embeds ${forbidden}`);
}
const catalogJson = JSON.stringify(report.catalog);
for (const forbidden of ['"programGraph"', '"executionPlan"', '"executableModuleId"']) {
    if (catalogJson.includes(forbidden)) fail(`Catalog embeds ${forbidden}`);
}

const integritySet = new Set(report.artifacts.map((a) => a.integrity));
if (report.mountTable.mounts.length !== 2) fail('want 2 mounts');
for (const m of report.mountTable.mounts) {
    if (!integritySet.has(m.artifactRef.hash)) {
        fail(`mount ${m.applicationId} artifactRef.hash not linked to ApplicationArtifact.integrity`);
    }
    if (!m.routeBase.startsWith('/apps/')) fail(`routeBase ${m.routeBase}`);
}

console.log('M2 gate: catalog order follows config (not package path sort)…');
const order = report.catalog.applications.map((a) => a.id);
if (JSON.stringify(order) !== JSON.stringify(['alpha', 'beta'])) {
    fail(`catalog order ${JSON.stringify(order)}`);
}

console.log('M2 gate: CLI application artifacts…');
const cli = spawnSync(process.execPath, [vmzBin, 'application', 'artifacts', host, '--json'], { encoding: 'utf8', cwd: root });
if (cli.status !== 0) fail(`CLI artifacts failed\n${cli.stdout}\n${cli.stderr}`);
const cliReport = JSON.parse(cli.stdout);
if (cliReport.schema !== APPLICATION_ARTIFACT_BOUNDARY_SCHEMA) fail('CLI schema');
if (cliReport.artifacts.length !== 2) fail('CLI artifacts count');

fs.rmSync(host, { recursive: true, force: true });
console.log('M2 GATE OK: ApplicationArtifact + MountTable refs + integrity + ownership');
