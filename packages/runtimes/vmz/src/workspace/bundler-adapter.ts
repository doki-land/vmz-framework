/**
 * Bundler adapter (session) — consumes Deployment IR; does not invent VMZ semantics.
 *
 * Vite/Rolldown may call these helpers; they must not reverse the arrow.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface DeploymentUnit {
    chunkId: string;
    kind: string;
    source: string;
    clientEntry: string;
    programIr: string;
    dependsOn?: string[];
    dependedBy?: string[];
    rebuilt?: boolean;
}

export interface DeploymentIr {
    schema: string;
    units: DeploymentUnit[];
    affectedChunks?: string[];
    seedChunks?: string[];
    islandHmr?: boolean;
    full?: boolean;
}

export interface VmzAdapterOptions {
    outDir?: string;
    root?: string;
}

export function loadDeploymentIr(outDir: string): DeploymentIr {
    const file = path.join(outDir, 'vmz-deployment.json');
    if (!existsSync(file)) {
        throw new Error(`Deployment IR missing: ${file} (run vmz build first)`);
    }
    const ir = JSON.parse(readFileSync(file, 'utf8'));
    if (ir.schema !== 'vmz.deployment.v0') {
        throw new Error(`unsupported deployment schema: ${ir.schema}`);
    }
    return ir;
}

/** Map Deployment IR → bundler entry points (absolute paths under outDir). */
export function planBundleInputs(
    outDir: string,
    ir: DeploymentIr = loadDeploymentIr(outDir),
): Array<{
    chunkId: string;
    kind: string;
    entry: string;
    programIr: string;
    source: string;
    rebuilt: boolean;
}> {
    return (ir.units || []).map((u) => ({
        chunkId: u.chunkId,
        kind: u.kind,
        entry: path.join(outDir, u.clientEntry),
        programIr: path.join(outDir, u.programIr),
        source: u.source,
        rebuilt: Boolean(u.rebuilt),
    }));
}

/** Entries that were rebuilt in the last emit (HMR / incremental pack). */
export function planAffectedBundleInputs(outDir: string, ir: DeploymentIr = loadDeploymentIr(outDir)) {
    const affected = new Set(ir.affectedChunks || []);
    return planBundleInputs(outDir, ir).filter((e) => e.rebuilt || affected.has(e.chunkId));
}

/** Thin Vite plugin factory: only reads Deployment IR. No `.vmz` transform hooks. */
export function createVitePluginVmzAdapter(options: VmzAdapterOptions = {}) {
    const outDir = options.outDir ?? 'dist';
    return {
        name: 'vmz-deployment-adapter',
        // Enforce direction: bundler consumes IR, never owns VMZ semantics.
        buildStart() {
            const abs = path.isAbsolute(outDir) ? outDir : path.join(options.root ?? process.cwd(), outDir);
            if (!existsSync(path.join(abs, 'vmz-deployment.json'))) {
                this.warn?.(`[vmz] ${abs}/vmz-deployment.json missing — run \`vmz build\` before bundling`);
            }
        },
        /**
         * Expose IR to other plugins via meta (optional).
         */
        configResolved() {
            /* no-op — presence documents the adapter surface */
        },
    };
}

/** Thin Rolldown plugin factory (deployment) — same contract as Vite adapter: read Deployment IR only. */
export function createRolldownPluginVmzAdapter(options: VmzAdapterOptions = {}) {
    const outDir = options.outDir ?? 'dist';
    return {
        name: 'vmz-deployment-adapter-rolldown',
        buildStart() {
            const abs = path.isAbsolute(outDir) ? outDir : path.join(options.root ?? process.cwd(), outDir);
            if (!existsSync(path.join(abs, 'vmz-deployment.json'))) {
                this.warn?.(`[vmz] ${abs}/vmz-deployment.json missing — run \`vmz build\` before bundling`);
            }
        },
        // Rolldown may call `options` / `buildStart`; keep surface identical and semantic-free.
        options(inputOptions: unknown) {
            return inputOptions;
        },
    };
}
