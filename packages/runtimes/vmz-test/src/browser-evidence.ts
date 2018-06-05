/**
 * Browser Host evidence stub (U3 thin): failure screenshot + wall-clock step timing.
 * Not a full U3 artifact pack (no network.json / accessible-tree / trace viewer).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type StepTiming = {
    phase: 'action' | 'assertion';
    kind: string;
    ms: number;
    ok: boolean;
    detail?: string;
};

export type BrowserTiming = {
    schema: 'vmz.test.browser.timing.v0';
    totalMs: number;
    steps: StepTiming[];
};

export type EvidencePaths = {
    dir: string;
    screenshot?: string;
    timing?: string;
    dom?: string;
};

export function createArtifactsDir(outDir: string, testId: string): string {
    const safe = String(testId || 'anonymous').replace(/[^\w.-]+/g, '_');
    const base = path.join(outDir, '_vmz', 'test-artifacts', safe);
    fs.mkdirSync(base, { recursive: true });
    return base;
}

export function createTempArtifactsDir(testId: string): string {
    const safe = String(testId || 'anonymous').replace(/[^\w.-]+/g, '_');
    return fs.mkdtempSync(path.join(os.tmpdir(), `vmz-bh-${safe}-`));
}

export async function writeFailureEvidence(
    page: { screenshot?: (opts: { path: string; fullPage?: boolean }) => Promise<unknown>; content?: () => Promise<string> },
    artifactsDir: string,
    timing: BrowserTiming,
): Promise<EvidencePaths> {
    fs.mkdirSync(artifactsDir, { recursive: true });
    const out: EvidencePaths = { dir: artifactsDir };
    const timingPath = path.join(artifactsDir, 'timing.json');
    fs.writeFileSync(timingPath, JSON.stringify(timing, null, 2), 'utf8');
    out.timing = timingPath;
    try {
        if (typeof page.screenshot === 'function') {
            const shot = path.join(artifactsDir, 'screenshot.png');
            await page.screenshot({ path: shot, fullPage: true });
            out.screenshot = shot;
        }
    } catch {
        /* screenshot optional */
    }
    try {
        if (typeof page.content === 'function') {
            const domPath = path.join(artifactsDir, 'dom.html');
            fs.writeFileSync(domPath, await page.content(), 'utf8');
            out.dom = domPath;
        }
    } catch {
        /* optional */
    }
    return out;
}

export function writeTimingOnly(artifactsDir: string, timing: BrowserTiming): string {
    fs.mkdirSync(artifactsDir, { recursive: true });
    const timingPath = path.join(artifactsDir, 'timing.json');
    fs.writeFileSync(timingPath, JSON.stringify(timing, null, 2), 'utf8');
    return timingPath;
}
