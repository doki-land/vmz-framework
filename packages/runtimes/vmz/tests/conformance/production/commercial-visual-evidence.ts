/**
 * Commercial visual spec §7 — viewport overflow evidence for home, console, and commercial.
 * verify id: commercial-visual-evidence
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { addLimitation, readProof, runVmzBuild, upsertCheck, writeProof } from '../_lib/production-proof.ts';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const HOMEPAGE = 'packages/homepage';
const SCRIPT = path.join(root, 'scripts/dev/capture-commercial-visual-evidence.mjs');
const MANIFEST = path.join(root, HOMEPAGE, 'evidence/commercial-visual/manifest.json');
const PORT = String(Number(process.env.VMZ_COMMERCIAL_VISUAL_PORT || 18831));

function fail(msg: string): never {
    console.error(`commercial-visual-evidence FAIL: ${msg}`);
    process.exit(1);
}

console.log('commercial-visual-evidence: build homepage…');
const build = runVmzBuild(HOMEPAGE, root);
if (build.status !== 0) {
    fail(`homepage build exited ${build.status}\n${(build.stderr || build.stdout).slice(0, 1200)}`);
}

console.log('commercial-visual-evidence: capture viewports…');
const run = spawnSync(process.execPath, [SCRIPT], {
    cwd: root,
    encoding: 'utf8',
    env: {
        ...process.env,
        SKIP_BUILD: '1',
        VMZ_EVIDENCE_PORT: PORT,
    },
});
if (run.status !== 0) {
    fail((run.stderr || run.stdout || 'capture-commercial-visual-evidence failed').trim().slice(0, 2000));
}

let detail = 'home, console, and commercial at 1440, 1024, and 390 without horizontal overflow';
let shotCount = 0;
if (fs.existsSync(MANIFEST)) {
    try {
        const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) as { shots?: unknown[] };
        shotCount = Array.isArray(manifest.shots) ? manifest.shots.length : 0;
        if (shotCount > 0) {
            detail = `${shotCount} viewport shots recorded with overflow=false`;
        }
    } catch (e) {
        fail(e instanceof Error ? e.message : String(e));
    }
} else {
    fail(`missing manifest at ${path.relative(root, MANIFEST)}`);
}

const proof = readProof(root);
upsertCheck(proof, {
    id: 'commercial-visual-evidence',
    status: 'passed',
    detail,
});
addLimitation(
    proof,
    'commercial-visual-evidence: PNG artifacts stay gitignored under packages/homepage/evidence/commercial-visual/',
);
writeProof(proof, root);

console.log(`commercial-visual-evidence PASS: ${detail}`);
