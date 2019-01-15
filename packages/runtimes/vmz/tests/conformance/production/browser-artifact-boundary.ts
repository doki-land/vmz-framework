/**
 * 0.1.27 — record browser artifact dependency boundary (not thin-runtime close).
 * verify id: browser-artifact-boundary
 */

import fs from 'node:fs';
import path from 'node:path';
import { BROWSER_ARTIFACT_BOUNDARY_SCHEMA, boundaryPath, recordBrowserArtifactBoundary } from '../_lib/browser-artifact-boundary.ts';
import { addLimitation, readProof, runVmzBuild, upsertCheck, writeProof } from '../_lib/production-proof.ts';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const EXAMPLE = 'packages/examples/production-catalog';

function fail(msg: string): never {
    console.error(`browser-artifact-boundary FAIL: ${msg}`);
    process.exit(1);
}

console.log('browser-artifact-boundary: build production-catalog…');
const build = runVmzBuild(EXAMPLE, root);
if (build.status !== 0) {
    fail(`vmz build exited ${build.status}\n${build.stdout}\n${build.stderr}`);
}

console.log('browser-artifact-boundary: record modules + interpreter signals…');
let boundary: ReturnType<typeof recordBrowserArtifactBoundary>;
try {
    boundary = recordBrowserArtifactBoundary({
        root,
        fixtureRel: EXAMPLE,
        profileId: 'web-ssr',
        distDir: build.dist,
    });
} catch (e) {
    fail(e instanceof Error ? e.message : String(e));
}

const outPath = boundaryPath(root);
if (!fs.existsSync(outPath)) fail(`missing ${path.relative(root, outPath)}`);
if (boundary.schema !== BROWSER_ARTIFACT_BOUNDARY_SCHEMA) fail('schema mismatch');
if (boundary.thinRuntimeClaim !== true) fail('thinRuntimeClaim must be true (0.1.32 proof)');
if (boundary.productionReadyClaim !== false) fail('productionReadyClaim must stay false');
if (!boundary.modules.generatedComponents.length) fail('expected generated *.client.js entries');
if (!boundary.modules.runtimeShared.length) fail('expected runtimeShared modules in delivery dist');
if (!boundary.pack.generatedEntries.length) fail('pack-manifest units missing');

const proof = readProof(root);
proof.hostProfile = proof.hostProfile ?? 'browser-web-surface';
proof.deliveryProfile = proof.deliveryProfile ?? 'browser-ssr-direct-resume';
proof.browserArtifactBoundaryPath = path.relative(root, outPath).replace(/\\/g, '/');
upsertCheck(proof, {
    id: 'browser-artifact-boundary',
    status: 'passed',
    detail: `js=${boundary.totals.jsFileCount}; generated=${boundary.modules.generatedComponents.length}; runtimeShared=${boundary.modules.runtimeShared.length}; hostSuspect=${boundary.modules.hostOrNodeSuspect.length}; interpreterSignals=${boundary.interpreterSignals.length}; out=${path.relative(root, outPath).replace(/\\/g, '/')}`,
});
addLimitation(proof, '0.1.27: browser-artifact-boundary is record-only; thin runtime / inventory audit remain 0.1.28–0.1.32');
if (boundary.interpreterSignals.length) {
    addLimitation(
        proof,
        `0.1.27: interpreter signals still present in delivery dist (${boundary.interpreterSignals.map((s) => s.id).join(', ')})`,
    );
}
writeProof(proof, root);

console.log(
    `browser-artifact-boundary PASS: ${path.relative(root, outPath)} generated=${boundary.modules.generatedComponents.length} runtimeShared=${boundary.modules.runtimeShared.length} signals=${boundary.interpreterSignals.map((s) => s.id).join('|') || 'none'}`,
);
console.log('browser-artifact-boundary NOTE: does not claim thin runtime or production-ready');
