/**
 * Pack consumer evidence — run the same artifact gates against the real
 * consumer sites, not just the fixture.
 *
 * verify id: pack-consumer-evidence
 *
 * Sites: `packages/homepage` (in-repo, always available) and the sibling
 * repo `vmz-bbs` project `vmz-official` when present locally (never in CI).
 * Each site is built per available delivery profile; the pack tree must then
 * satisfy manifest closure, reference integrity, and module uniqueness.
 *
 * A failing consumer build is a failing gate with the build diagnostics
 * quoted verbatim — blockage is reported, never greenwashed.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
    assertManifestClosed,
    assertModulesUnique,
    assertNestedSsrImportsResolve,
    assertReferenceIntegrity,
    loadPack,
    type LoadedPack,
} from '../_lib/pack-artifact-gates.ts';
import { addLimitation, readProof, runVmzBuild, upsertCheck, writeProof } from '../_lib/production-proof.ts';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const VMZ_OFFICIAL = 'e:/vmz 全栈开发/vmz-bbs/projects/vmz-official';

function fail(msg: string): never {
    console.error(`pack-consumer-evidence FAIL: ${msg}`);
    process.exit(1);
}

interface SiteRun {
    label: string;
    dist: string;
    status: number;
    stdout: string;
    stderr: string;
}

function buildSite(label: string, exampleAbsOrRel: string, profile: string, artifactName?: string): SiteRun {
    console.log(`pack-consumer-evidence: build ${label} (${profile})…`);
    const run = runVmzBuild(exampleAbsOrRel, root, { profile, artifactName });
    return { label, dist: run.dist, status: run.status, stdout: run.stdout, stderr: run.stderr };
}

function assertSite(label: string, run: SiteRun): string[] {
    const errors: string[] = [];
    if (run.status !== 0) {
        const tail = `${run.stdout}\n${run.stderr}`.trim().split('\n').slice(-6).join('\n');
        errors.push(`${label} build exited ${run.status}:\n${tail}`);
        return errors;
    }
    const loaded = loadPack(run.dist);
    if (!loaded.ok) {
        errors.push(...loaded.errors.map((e) => `${label}: ${e}`));
        return errors;
    }
    const pack: LoadedPack = loaded.value;
    for (const line of assertManifestClosed(pack)) errors.push(`${label}: ${line}`);
    for (const line of assertReferenceIntegrity(pack)) errors.push(`${label}: ${line}`);
    for (const line of assertModulesUnique(pack)) errors.push(`${label}: ${line}`);
    const total = pack.manifest.chunks.reduce((sum, c) => sum + c.bytes, 0);
    console.log(`  ${label}: chunks=${pack.manifest.chunks.length} totalJs=${total}B`);
    return errors;
}

const allErrors: string[] = [];
const notes: string[] = [];

// --- homepage: static + cdn-flavored (web-hybrid) ---------------------------
allErrors.push(...assertSite('homepage/static', buildSite('homepage', 'packages/homepage', 'static')));
const homepageWebHybrid = buildSite('homepage', 'packages/homepage', 'web-hybrid');
allErrors.push(...assertSite('homepage/web-hybrid', homepageWebHybrid));
if (homepageWebHybrid.status === 0) {
    for (const line of assertNestedSsrImportsResolve(homepageWebHybrid.dist)) {
        allErrors.push(`homepage/web-hybrid: ${line}`);
    }
}

// --- vmz-official (sibling repo, local only) ---------------------------------
if (!fs.existsSync(VMZ_OFFICIAL)) {
    notes.push('vmz-official not present locally — skipped (CI never has the sibling checkout)');
    console.log('pack-consumer-evidence: vmz-official absent, skipped');
} else {
    // The site pins a single `static` profile whose `name` is `pages`
    // (artifacts land in `dist/pages`); a cdn profile does not exist
    // there — record that instead of inventing one.
    allErrors.push(...assertSite('vmz-official/static', buildSite('vmz-official', VMZ_OFFICIAL, 'static', 'pages')));
    notes.push('vmz-official ships only the `static` profile (no cdn profile authored)');
}

if (allErrors.length) {
    const proof = readProof(root);
    upsertCheck(proof, {
        id: 'pack-consumer-evidence',
        status: 'failed',
        detail: `${allErrors.length} error(s)`,
    });
    writeProof(proof, root);
    fail(`${allErrors.length} error(s):\n  - ${allErrors.slice(0, 10).join('\n  - ')}`);
}

const proof = readProof(root);
upsertCheck(proof, {
    id: 'pack-consumer-evidence',
    status: 'passed',
    detail: 'homepage static + web-hybrid, vmz-official when present',
});
for (const note of notes) addLimitation(proof, `pack-consumer-evidence: ${note}`);
writeProof(proof, root);
console.log('pack-consumer-evidence PASS');
