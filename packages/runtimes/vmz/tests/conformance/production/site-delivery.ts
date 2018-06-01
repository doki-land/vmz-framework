/**
 * A3-site — SiteDeliveryContract: embedded / filesystem / remote selection,
 * release-level fallback, reject file-level mix.
 * verify ids: embedded-site + site-fallback (same driver).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    defineConfig,
    defineSite,
    emitSiteDelivery,
    normalizeSiteDelivery,
    normalizeSourceProbe,
    probeReleaseDirectory,
    resolveSiteRelease,
} from 'vmz';
import { repoRoot } from '../_lib/repo-root.ts';
import { addLimitation, readProof, upsertCheck, writeProof } from '../_lib/production-proof.ts';

const root = repoRoot(import.meta.url);

function fail(msg: string): never {
    console.error(`site-delivery FAIL: ${msg}`);
    process.exit(1);
}

const errors: string[] = [];

console.log('site-delivery: normalize defineConfig({ delivery })…');
const authoring = defineSite({
    artifact: 'web-production',
    sources: [
        {
            id: 'installed',
            kind: 'filesystem',
            directory: './site',
            trust: 'signed-release',
        },
        {
            id: 'updates',
            kind: 'remote',
            baseUrl: 'https://updates.example.com/panel/',
            trust: 'signed-release',
            timeoutMs: 1500,
        },
        {
            id: 'baseline',
            kind: 'embedded',
            artifact: 'baseline',
        },
    ],
    resolution: {
        mode: 'release',
        fallback: ['installed', 'updates', 'baseline'],
    },
    activation: 'atomic',
});
const cfg = defineConfig({
    application: { id: 'panel' },
    delivery: authoring,
});
if (!cfg.delivery || (cfg.delivery as { artifact?: string }).artifact !== 'web-production') {
    errors.push('defineConfig must retain delivery');
}

const norm = normalizeSiteDelivery(cfg.delivery, { siteId: 'panel' });
if (!norm.ok) fail(`normalize failed: ${JSON.stringify(norm.diagnostics)}`);
const contract = norm.contract;
if (contract.schema !== 'vmz.site.delivery_contract.v0') errors.push(`bad schema ${contract.schema}`);
if (contract.resolutionPolicy?.fileLevelMix !== false) errors.push('fileLevelMix must be false');
if (JSON.stringify(contract.resolutionPolicy?.fallback) !== JSON.stringify(['installed', 'updates', 'baseline'])) {
    errors.push(`fallback order rewritten: ${JSON.stringify(contract.resolutionPolicy?.fallback)}`);
}

// Reject executable authoring
const bad = normalizeSiteDelivery({
    artifact: 'x',
    sources: [{ id: 'fs', kind: 'filesystem', directory: () => './x' }],
});
if (bad.ok) errors.push('functions in delivery must be rejected');

console.log('site-delivery: resolve fallback chain…');
const digA = 'digest-a-filesystem';
const digB = 'digest-b-remote';
const digE = 'digest-e-embedded';

const preferFs = resolveSiteRelease(contract, {
    installed: normalizeSourceProbe({ available: true, artifactDigest: digA }),
    updates: normalizeSourceProbe({ available: true, artifactDigest: digB }),
    baseline: normalizeSourceProbe({ available: true, artifactDigest: digE }),
});
if (preferFs.status !== 'activated' || preferFs.selectedSourceId !== 'installed' || preferFs.selectedDigest !== digA) {
    errors.push(`preferred filesystem failed: ${JSON.stringify(preferFs)}`);
}

const preferRemote = resolveSiteRelease(contract, {
    installed: normalizeSourceProbe({ available: false, error: 'offline-disk' }),
    updates: normalizeSourceProbe({ available: true, artifactDigest: digB }),
    baseline: normalizeSourceProbe({ available: true, artifactDigest: digE }),
});
if (preferRemote.selectedSourceId !== 'updates') {
    errors.push(`filesystem down → remote, got ${preferRemote.selectedSourceId}`);
}

const preferEmbedded = resolveSiteRelease(contract, {
    installed: normalizeSourceProbe({ available: false, error: 'offline-disk' }),
    updates: normalizeSourceProbe({ available: false, error: 'timeout' }),
    baseline: normalizeSourceProbe({ available: true, artifactDigest: digE }),
});
if (preferEmbedded.selectedSourceId !== 'baseline' || preferEmbedded.selectedKind !== 'embedded') {
    errors.push(`fallback to embedded failed: ${JSON.stringify(preferEmbedded)}`);
}

console.log('site-delivery: embedded-only startup…');
const embeddedOnly = normalizeSiteDelivery({
    artifact: 'baseline',
    sources: [{ id: 'baseline', kind: 'embedded', artifact: 'baseline' }],
    resolution: { mode: 'release', fallback: ['baseline'] },
    activation: 'atomic',
});
if (!embeddedOnly.ok) fail(`embedded-only normalize: ${JSON.stringify(embeddedOnly.diagnostics)}`);
const embRes = resolveSiteRelease(embeddedOnly.contract, {
    baseline: normalizeSourceProbe({ available: true, artifactDigest: digE }),
});
if (embRes.status !== 'activated' || embRes.selectedKind !== 'embedded') {
    errors.push('embedded-only must activate without filesystem/remote');
}

console.log('site-delivery: reject mix / tamper / incomplete closure…');
const mix = resolveSiteRelease(contract, {
    installed: normalizeSourceProbe({
        available: true,
        artifactDigest: digA,
        mixedDigestObjects: true,
    }),
    updates: normalizeSourceProbe({ available: true, artifactDigest: digB }),
    baseline: normalizeSourceProbe({ available: true, artifactDigest: digE }),
});
if (mix.selectedSourceId !== 'updates') {
    errors.push(`file-level mix must skip installed, got ${mix.selectedSourceId}`);
}
if (!mix.attempted?.some((a: { reason: string }) => a.reason === 'file-level-mix-forbidden')) {
    errors.push('missing file-level-mix-forbidden attempt');
}

const tamper = resolveSiteRelease(contract, {
    installed: normalizeSourceProbe({
        available: true,
        artifactDigest: digA,
        signatureOk: false,
    }),
    updates: normalizeSourceProbe({ available: true, artifactDigest: digB, signatureOk: false }),
    baseline: normalizeSourceProbe({ available: true, artifactDigest: digE }),
});
if (tamper.selectedSourceId !== 'baseline') {
    errors.push(`tampered signatures must fall to embedded, got ${tamper.selectedSourceId}`);
}

const incomplete = resolveSiteRelease(contract, {
    installed: normalizeSourceProbe({
        available: true,
        artifactDigest: digA,
        objectClosureOk: false,
    }),
    updates: normalizeSourceProbe({ available: false, error: 'timeout' }),
    baseline: normalizeSourceProbe({ available: true, artifactDigest: digE }),
});
if (incomplete.selectedSourceId !== 'baseline') {
    errors.push(`incomplete closure must not silently mix; got ${incomplete.selectedSourceId}`);
}

console.log('site-delivery: probeReleaseDirectory + emit…');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-site-'));
try {
    const goodDist = path.join(tmp, 'good', 'dist');
    fs.mkdirSync(path.join(goodDist, '_vmz'), { recursive: true });
    fs.writeFileSync(path.join(goodDist, 'index.html'), '<p>ok</p>\n');
    fs.writeFileSync(
        path.join(goodDist, '_vmz', 'release-envelope.json'),
        JSON.stringify({ artifactDigest: 'snap-1', signatureOk: true }, null, 2),
    );
    const goodProbe = probeReleaseDirectory(path.join(tmp, 'good'));
    if (!goodProbe.available || goodProbe.artifactDigest !== 'snap-1' || !goodProbe.objectClosureOk) {
        errors.push(`good probe failed: ${JSON.stringify(goodProbe)}`);
    }

    const mixedDist = path.join(tmp, 'mixed', 'dist');
    fs.mkdirSync(path.join(mixedDist, '_vmz'), { recursive: true });
    fs.writeFileSync(path.join(mixedDist, 'index.html'), '<p>mix</p>\n');
    fs.writeFileSync(
        path.join(mixedDist, '_vmz', 'release-envelope.json'),
        JSON.stringify({ artifactDigest: 'snap-2', signatureOk: true }, null, 2),
    );
    fs.writeFileSync(path.join(mixedDist, '_vmz', 'MIXED_DIGEST'), '1\n');
    const mixProbe = probeReleaseDirectory(path.join(tmp, 'mixed'));
    if (!mixProbe.mixedDigestObjects || mixProbe.objectClosureOk) {
        errors.push(`mixed probe must flag mix: ${JSON.stringify(mixProbe)}`);
    }

    const outDir = path.join(tmp, 'out');
    fs.mkdirSync(outDir, { recursive: true });
    const emitted = emitSiteDelivery(outDir, cfg.delivery, {
        siteId: 'panel',
        probes: {
            installed: goodProbe,
            updates: normalizeSourceProbe({ available: false, error: 'timeout' }),
            baseline: normalizeSourceProbe({ available: true, artifactDigest: digE }),
        },
    });
    if (!fs.existsSync(path.join(outDir, '_vmz', 'site-delivery-contract.json'))) {
        errors.push('missing site-delivery-contract.json');
    }
    if (!fs.existsSync(path.join(outDir, '_vmz', 'site-delivery-resolution.json'))) {
        errors.push('missing site-delivery-resolution.json');
    }
    if (emitted.resolution?.selectedSourceId !== 'installed') {
        errors.push(`emit resolution want installed, got ${emitted.resolution?.selectedSourceId}`);
    }
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}

const proof = readProof(root);
upsertCheck(proof, {
    id: 'embedded-site',
    status: errors.some((e) => e.includes('embedded')) ? 'failed' : 'passed',
    detail: 'embedded-only activate + contract normalize from defineConfig/defineSite',
});
upsertCheck(proof, {
    id: 'site-fallback',
    status: errors.some(
        (e) =>
            e.includes('fallback') ||
            e.includes('mix') ||
            e.includes('tamper') ||
            e.includes('closure') ||
            e.includes('preferred') ||
            e.includes('filesystem'),
    )
        ? 'failed'
        : 'passed',
    detail: 'release-level fallback fs→remote→embedded; reject file-level mix / tamper / incomplete closure',
});

const gaps = [
    'A3: Rust include_bytes / resource-section packaging adapter not covered',
    'A3: live remote HTTP fetch + signature crypto not covered (probes are host-supplied)',
];
for (const g of gaps) addLimitation(proof, g);
proof.knownLimitations = proof.knownLimitations.filter(
    (l) =>
        !l.includes('A3: SiteDeliveryContract embedded/filesystem/remote not covered') &&
        !l.includes('SiteDeliveryContract resolver not covered') &&
        !l.includes('A3: content-addressed assets/<hash> cross-source immutable fetch not covered'),
);

writeProof(proof, root);
if (errors.length) fail(errors.join('\n'));

console.log('site-delivery PASS: embedded-site + site-fallback (release-level, no file mix)');
console.log('site-delivery NOTE: Rust packaging adapter / live remote crypto still open');
