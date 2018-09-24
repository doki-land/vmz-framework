/**
 * Shared helpers for Browser Production Profile proof output.
 * Writes `dist/vmz.production.proof.json` at the repo root (never invents green status).
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { repoRoot, vmzBin } from './repo-root.ts';

export type CheckStatus = 'passed' | 'failed' | 'skipped' | 'not-implemented';

export type ProductionCheck = {
    id: string;
    status: CheckStatus;
    detail?: string;
};

export type ProductionProof = {
    schema: 'vmz.production.proof.v0';
    sourceRevision: string | null;
    toolchain: { node: string; pnpm?: string };
    oxcVersion: string | null;
    programDigest: string | null;
    planDigest: string | null;
    hostProfile: string | null;
    deliveryProfile: string | null;
    routeDigest: string | null;
    localeDigest: string | null;
    styleDigest: string | null;
    testManifestDigest: string | null;
    testReportDigest: string | null;
    artifactDigest: string | null;
    rollbackEvidence: string | null;
    performanceBudgets: Record<string, unknown> | null;
    securityChecks: ProductionCheck[];
    checks: ProductionCheck[];
    knownLimitations: string[];
    updatedAt: string;
};

export function proofPath(root = repoRoot()): string {
    return path.join(root, 'dist', 'vmz.production.proof.json');
}

export function emptyProof(): ProductionProof {
    return {
        schema: 'vmz.production.proof.v0',
        sourceRevision: gitHead(),
        toolchain: { node: process.version },
        oxcVersion: null,
        programDigest: null,
        planDigest: null,
        hostProfile: 'browser-web-surface',
        deliveryProfile: null,
        routeDigest: null,
        localeDigest: null,
        styleDigest: null,
        testManifestDigest: null,
        testReportDigest: null,
        artifactDigest: null,
        rollbackEvidence: null,
        performanceBudgets: null,
        securityChecks: [],
        checks: [],
        knownLimitations: [],
        updatedAt: new Date().toISOString(),
    };
}

export function readProof(root = repoRoot()): ProductionProof {
    const p = proofPath(root);
    if (!fs.existsSync(p)) return emptyProof();
    try {
        return { ...emptyProof(), ...JSON.parse(fs.readFileSync(p, 'utf8')) };
    } catch {
        return emptyProof();
    }
}

export function writeProof(proof: ProductionProof, root = repoRoot()): string {
    const out = proofPath(root);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    proof.updatedAt = new Date().toISOString();
    proof.sourceRevision = proof.sourceRevision ?? gitHead();
    fs.writeFileSync(out, JSON.stringify(proof, null, 2) + '\n', 'utf8');
    return out;
}

export function upsertCheck(proof: ProductionProof, check: ProductionCheck): void {
    const i = proof.checks.findIndex((c) => c.id === check.id);
    if (i >= 0) proof.checks[i] = check;
    else proof.checks.push(check);
}

export function addLimitation(proof: ProductionProof, line: string): void {
    if (!proof.knownLimitations.includes(line)) proof.knownLimitations.push(line);
}

function gitHead(): string | null {
    const r = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
    if (r.status !== 0) return null;
    return (r.stdout || '').trim() || null;
}

export function runVmzTest(
    exampleRel: string,
    args: string[],
    root = repoRoot(),
    opts: { reportName?: string } = {},
): { status: number; stdout: string; stderr: string; report: unknown | null; reportPath: string } {
    const example = path.join(root, ...exampleRel.split('/'));
    const name = opts.reportName || `${path.basename(exampleRel)}-${Date.now()}.json`;
    const reportPath = path.join(root, 'dist', 'production-reports', name);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    const run = spawnSync(process.execPath, [vmzBin(root), 'test', example, ...args, '--json', reportPath], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let report: unknown | null = null;
    if (fs.existsSync(reportPath)) {
        try {
            report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
        } catch {
            report = null;
        }
    }
    return { status: run.status ?? 1, stdout: run.stdout || '', stderr: run.stderr || '', report, reportPath };
}

/**
 * CLI `vmz build` — artifacts land under `<out-dir>/<profile.name>` (default name = profile id).
 * No config → builtin default `web-ssr` → `dist/web-ssr`.
 */
export function runVmzBuild(
    exampleRel: string,
    root = repoRoot(),
    opts: { profile?: string; outDir?: string } = {},
): { status: number; stdout: string; stderr: string; dist: string } {
    // Absolute paths (temp fixtures) must not be joined onto repo root.
    const example = path.isAbsolute(exampleRel) ? exampleRel : path.join(root, ...exampleRel.split('/'));
    // Always pass --profile so artifact dir matches `<out-dir>/<name>` (name defaults to profile id).
    const profileId = String(opts.profile || 'web-ssr').trim() || 'web-ssr';
    const outDirRoot = opts.outDir ? path.resolve(example, opts.outDir) : path.join(example, 'dist');
    const dist = path.join(outDirRoot, profileId);
    const args = [vmzBin(root), 'build', example, '--out-dir', outDirRoot, '--profile', profileId];
    const run = spawnSync(process.execPath, args, {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: run.status ?? 1, stdout: run.stdout || '', stderr: run.stderr || '', dist };
}

/** Scan built application client JS for production-forbidden patterns (not runtime libs). */
export function scanForbiddenHotPath(distDir: string): string[] {
    const hits: string[] = [];
    if (!fs.existsSync(distDir)) return ['dist missing'];
    const skipNames = new Set(['vmz-runtime.js', 'vmz-dom.js', 'vmz.css']);
    const stack = [distDir];
    while (stack.length) {
        const dir = stack.pop()!;
        for (const name of fs.readdirSync(dir)) {
            const full = path.join(dir, name);
            const st = fs.statSync(full);
            if (st.isDirectory()) {
                stack.push(full);
                continue;
            }
            if (skipNames.has(name)) continue;
            // Application Direct emit only — ignore shared runtime copies.
            if (!/\.client\.js$/.test(name)) continue;
            const text = fs.readFileSync(full, 'utf8');
            if (/\brender\s*\(/.test(text) && /__vmz|blueprint|kind:\s*"if"/.test(text)) {
                hits.push(`${path.relative(distDir, full)}: render(`);
            }
            if (/kind:\s*"(if|each)"/.test(text) && /blueprint/.test(text)) {
                hits.push(`${path.relative(distDir, full)}: blueprint kind dispatcher`);
            }
            if (/function\s+render\s*\(/.test(text) || /exports\.render\s*=/.test(text)) {
                hits.push(`${path.relative(distDir, full)}: exported/function render`);
            }
        }
    }
    return hits;
}
