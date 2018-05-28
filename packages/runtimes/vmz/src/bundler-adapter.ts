// @ts-nocheck
/**
 * Bundler adapter (N4) — consumes Deployment IR; does not invent VMZ semantics.
 *
 * Design: `规划设计/vmz/14` — VPG/Deployment IR → bundler executes pack/minify/assets.
 * Vite/Rolldown may call these helpers; they must not reverse the arrow.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * @typedef {object} DeploymentUnit
 * @property {string} chunkId
 * @property {string} kind
 * @property {string} source
 * @property {string} clientEntry
 * @property {string} programIr
 * @property {string[]} [dependsOn]
 * @property {string[]} [dependedBy]
 * @property {boolean} [rebuilt]
 */

/**
 * @typedef {object} DeploymentIr
 * @property {string} schema
 * @property {DeploymentUnit[]} units
 * @property {string[]} [affectedChunks]
 * @property {string[]} [seedChunks]
 * @property {boolean} [islandHmr]
 * @property {boolean} [full]
 */

/**
 * @param {string} outDir
 * @returns {DeploymentIr}
 */
export function loadDeploymentIr(outDir) {
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

/**
 * Map Deployment IR → bundler entry points (absolute paths under outDir).
 * @param {string} outDir
 * @param {DeploymentIr} [ir]
 */
export function planBundleInputs(outDir, ir = loadDeploymentIr(outDir)) {
    return (ir.units || []).map((u) => ({
        chunkId: u.chunkId,
        kind: u.kind,
        entry: path.join(outDir, u.clientEntry),
        programIr: path.join(outDir, u.programIr),
        source: u.source,
        rebuilt: Boolean(u.rebuilt),
    }));
}

/**
 * Entries that were rebuilt in the last emit (HMR / incremental pack).
 * @param {string} outDir
 * @param {DeploymentIr} [ir]
 */
export function planAffectedBundleInputs(outDir, ir = loadDeploymentIr(outDir)) {
    const affected = new Set(ir.affectedChunks || []);
    return planBundleInputs(outDir, ir).filter((e) => e.rebuilt || affected.has(e.chunkId));
}

/**
 * Thin Vite plugin factory: only reads Deployment IR. No `.vmz` transform hooks.
 * @param {{ outDir?: string, root?: string }} [options]
 */
export function createVitePluginVmzAdapter(options = {}) {
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

/**
 * Thin Rolldown plugin factory (N4.2) — same contract as Vite adapter: read Deployment IR only.
 * @param {{ outDir?: string, root?: string }} [options]
 */
export function createRolldownPluginVmzAdapter(options = {}) {
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
        options(inputOptions) {
            return inputOptions;
        },
    };
}
