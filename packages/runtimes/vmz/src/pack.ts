/**
 * Pack stage: consume Deployment IR (VPG-owned units), emit pack manifest,
 * and lower browser-unreachable bare package imports to `dist/vendor/**`.
 * Full oxc minify/chunk-split lands progressively (`oxc-pending` on release minify).
 */
// @ts-nocheck

import crypto from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadDeploymentIr, planBundleInputs } from './bundler-adapter.js';
import { packClientBareImports } from './pack-client-packages.js';
import { writePrettyJsonFile } from './pretty-json.js';

export const PACK_MANIFEST_SCHEMA = 'vmz.pack.manifest.v0';

/**
 * Ensure dom split companions sit next to vmz-dom.js (barrel imports ./dom-core.js).
 * Always refresh from `@vmz/core` when present so SSR/runtime fixes are not sticky in outDir.
 * @param {string} outDir
 * @param {string | null | undefined} coreDist `@vmz/core` dist root
 * @returns {string[]} copied relative names
 */
export function ensureRuntimeCompanions(outDir, coreDist) {
    if (!coreDist) return [];
    const names = ['dom-core.js', 'dom-ssr.js', 'dom.client.js'];
    const copied = [];
    for (const name of names) {
        const src = path.join(coreDist, name);
        if (!existsSync(src)) continue;
        const dest = path.join(outDir, name);
        copyFileSync(src, dest);
        copied.push(name);
    }
    return copied;
}

/**
 * @param {string} outDir
 * @param {{
 *   release?: boolean,
 *   profileId?: string,
 *   assembly?: string,
 *   preferredClientFace?: string,
 *   coreDist?: string | null,
 *   projectRoot?: string | null,
 * }} [opts]
 */
export function packFromDeploymentIr(outDir, opts = {}) {
    ensureRuntimeCompanions(outDir, opts.coreDist);

    // Browser ESM cannot resolve bare npm specs — materialize reachable packages first
    // so digests below reflect the rewritten graph.
    const clientPackages = packClientBareImports(outDir, { projectRoot: opts.projectRoot || null });

    const ir = loadDeploymentIr(outDir);
    const inputs = planBundleInputs(outDir, ir);
    const units = [];
    for (const entry of inputs) {
        const abs = entry.entry;
        let digest = null;
        let bytes = 0;
        let present = false;
        if (existsSync(abs)) {
            present = true;
            const buf = readFileSync(abs);
            bytes = buf.length;
            digest = crypto.createHash('sha256').update(buf).digest('hex');
        }
        units.push({
            chunkId: entry.chunkId,
            kind: entry.kind,
            entry: path.relative(outDir, abs).replace(/\\/g, '/'),
            programIr: path.relative(outDir, entry.programIr).replace(/\\/g, '/'),
            source: entry.source,
            present,
            bytes,
            digest,
            rebuilt: Boolean(entry.rebuilt),
        });
    }

    const body = {
        schema: PACK_MANIFEST_SCHEMA,
        profileId: opts.profileId || null,
        assembly: opts.assembly || null,
        release: Boolean(opts.release),
        preferredClientFace: opts.preferredClientFace || '@vmz/core/dom/client',
        deploymentSchema: ir.schema,
        unitCount: units.length,
        units,
        minify: opts.release ? 'oxc-pending' : 'dev-identity',
        treeShakeBasis: 'vpg-deployment-ir',
        bundler: 'vmz-pack',
        clientPackageLowering: {
            status: 'thin',
            rewrittenFiles: clientPackages.rewrittenFiles,
            bareSpecs: clientPackages.bareSpecs,
            vendoredModules: clientPackages.vendoredModules,
            unresolvedBareSpecs: clientPackages.unresolvedBareSpecs || [],
            skippedVmzExports: clientPackages.skippedVmzExports || [],
            remainingBareSpecs: clientPackages.remainingBareSpecs || [],
        },
    };
    body.packDigest = sha256Hex(stableStringify({ ...body }));

    const vmzDir = path.join(outDir, '_vmz');
    mkdirSync(vmzDir, { recursive: true });
    const file = path.join(vmzDir, 'pack-manifest.json');
    writePrettyJsonFile(file, body);
    return { manifest: body, path: file, clientPackages };
}

function stableStringify(value) {
    return JSON.stringify(sortKeys(value));
}

function sortKeys(value) {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (value && typeof value === 'object') {
        const out = {};
        for (const k of Object.keys(value).sort()) out[k] = sortKeys(value[k]);
        return out;
    }
    return value;
}

function sha256Hex(text) {
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}
