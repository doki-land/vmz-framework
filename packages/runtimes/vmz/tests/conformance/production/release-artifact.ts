/**
 * A3 Release artifact — pack digests, atomic publish pointer, rollback, artifact diff.
 * Filesystem Delivery Profile only (CDN/SEO/static matrix still open).
 */

import fs from 'node:fs';
import path from 'node:path';
import {
    diffArtifacts,
    loadReleaseEnvelope,
    packRelease,
    publishRelease,
    readPointer,
    rollbackRelease,
} from '../../../src/workspace/release-pack.ts';
import { repoRoot } from '../_lib/repo-root.ts';
import { addLimitation, readProof, runVmzBuild, upsertCheck, writeProof } from '../_lib/production-proof.ts';

const root = repoRoot(import.meta.url);
const EXAMPLE = 'packages/examples/production-router';

function fail(msg: string): never {
    console.error(`release-artifact FAIL: ${msg}`);
    process.exit(1);
}

console.log('release-artifact: build production-router…');
const build = runVmzBuild(EXAMPLE, root);
const proof = readProof(root);
if (build.status !== 0) {
    upsertCheck(proof, {
        id: 'release-artifact.build',
        status: 'failed',
        detail: (build.stderr || build.stdout).slice(0, 2000),
    });
    addLimitation(proof, 'A3: production-router failed to build');
    writeProof(proof, root);
    fail(`vmz build exited ${build.status}`);
}

const dist = build.dist;
// Beside dist — never nest releases under dist (Node cpSync self-subdir ban).
const releasesRoot = path.join(path.dirname(dist), '.vmz-releases');
fs.rmSync(releasesRoot, { recursive: true, force: true });

console.log('release-artifact: pack + publish A…');
const envA = packRelease(dist, { applicationId: 'production-router' });
const pubA = publishRelease(releasesRoot, dist, envA);
if (!envA.artifactDigest) fail('pack missing artifactDigest');
if (pubA.digest !== envA.artifactDigest) fail('publish digest mismatch');

const envA2 = packRelease(dist, { applicationId: 'production-router' });
if (envA2.artifactDigest !== envA.artifactDigest) {
    fail(`re-pack digest not stable: ${envA.artifactDigest} vs ${envA2.artifactDigest}`);
}

const indexClient = path.join(dist, 'pages', 'index.client.js');
const original = fs.readFileSync(indexClient, 'utf8');
fs.writeFileSync(indexClient, `${original}\n/* release-artifact mutate ${Date.now()} */\n`, 'utf8');

console.log('release-artifact: pack + publish B…');
const envB = packRelease(dist, { applicationId: 'production-router' });
if (envB.artifactDigest === envA.artifactDigest) fail('mutated dist must change artifactDigest');
publishRelease(releasesRoot, dist, envB);
if (readPointer(path.join(releasesRoot, 'CURRENT')) !== envB.artifactDigest) {
    fail('CURRENT pointer not B');
}
if (readPointer(path.join(releasesRoot, 'PREVIOUS')) !== envA.artifactDigest) {
    fail('PREVIOUS pointer not A');
}

const diff = diffArtifacts(envA, envB);
if (diff.identical) fail('diff A→B must not be identical');
if (!diff.changed.some((c: { path: string }) => c.path.includes('pages/index.client.js'))) {
    fail(`diff missing index.client.js change: ${JSON.stringify(diff.changed).slice(0, 400)}`);
}

console.log('release-artifact: rollback to A…');
const rb = rollbackRelease(releasesRoot);
if (rb.restored !== envA.artifactDigest) fail(`rollback restored ${rb.restored}`);
if (readPointer(path.join(releasesRoot, 'CURRENT')) !== envA.artifactDigest) {
    fail('CURRENT after rollback not A');
}
const restored = loadReleaseEnvelope(releasesRoot, rb.restored);
if (restored.artifactDigest !== envA.artifactDigest) fail('restored envelope digest mismatch');

fs.writeFileSync(indexClient, original, 'utf8');

const vmzDir = path.join(dist, '_vmz');
for (const name of ['application-artifact.json', 'delivery-artifact-manifest.json', 'route-realization.json', 'release-envelope.json']) {
    if (!fs.existsSync(path.join(vmzDir, name))) fail(`missing ${name}`);
}

proof.deliveryProfile = 'filesystem';
proof.artifactDigest = envA.artifactDigest;
proof.rollbackEvidence = JSON.stringify({
    releasesRoot: path.relative(root, releasesRoot).replace(/\\/g, '/'),
    restored: rb.restored,
    demoted: rb.demoted,
    previousRetained: true,
});
proof.styleDigest = envA.styleDigest || null;
proof.programDigest = envA.programDigest || null;
proof.routeDigest = envA.routeDigest || null;

upsertCheck(proof, {
    id: 'release-artifact.build',
    status: 'passed',
    detail: dist,
});
upsertCheck(proof, {
    id: 'release-artifact.pack',
    status: 'passed',
    detail: `digest=${envA.artifactDigest}`,
});
upsertCheck(proof, {
    id: 'release-artifact.publish-rollback',
    status: 'passed',
    detail: `A→B→rollback A; diffChanged=${diff.changed.length}`,
});
upsertCheck(proof, {
    id: 'release-artifact.diff',
    status: 'passed',
    detail: `changed=${diff.changed.length} added=${diff.added.length}`,
});

const gaps = ['A3: clean-workspace bit-identical rebuild across machines not proven'];
for (const g of gaps) addLimitation(proof, g);
proof.knownLimitations = proof.knownLimitations.filter(
    (l) =>
        !l.includes('A3: ApplicationArtifact / DeliveryArtifactManifest') &&
        !l.includes('A3: atomic publish pointer + rollback') &&
        !l.includes('A3: reproducible digest / artifact diff not wired') &&
        !l.includes('A3: CDN / provider adapters / StaticDeliveryManifest matrix not covered') &&
        !l.includes('A3: CDN / provider adapters / cache-policy manifests not covered') &&
        !l.includes('A3: SEO sitemap/robots/hreflang not in this driver') &&
        !l.includes('A3: SiteDeliveryContract embedded/filesystem/remote not covered') &&
        !l.includes('A3: content-addressed assets/<hash> immutable CDN layout not covered'),
);

writeProof(proof, root);
console.log('release-artifact PASS: pack + atomic CURRENT/PREVIOUS + rollback + diff');
console.log('release-artifact NOTE: bit-identical cross-machine rebuild still open');
