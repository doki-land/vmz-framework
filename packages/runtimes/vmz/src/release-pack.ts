/**
 * A3 filesystem release packaging — digests, atomic pointer, rollback, artifact diff.
 *
 * Not the full CDN/StaticDelivery matrix. Same VPG build (`dist/`) is packed into
 * `_vmz/*` manifests + content digests; publish retains previous release for rollback
 * without rebuild.
 */
// @ts-nocheck

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const RELEASE_ENVELOPE_SCHEMA = 'vmz.release.envelope.v0';
export const APPLICATION_ARTIFACT_SCHEMA = 'vmz.application.artifact.v0';
export const DELIVERY_ARTIFACT_MANIFEST_SCHEMA = 'vmz.profile.delivery_artifact_manifest.v0';
export const ROUTE_REALIZATION_TABLE_SCHEMA = 'vmz.profile.route_realization_table.v0';
export const ARTIFACT_DIFF_SCHEMA = 'vmz.artifact.diff.v0';

/**
 * @param {Buffer | string} data
 */
export function sha256Hex(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * @param {string} filePath
 */
export function sha256File(filePath) {
    return sha256Hex(fs.readFileSync(filePath));
}

/**
 * @param {unknown} value
 */
export function canonicalJson(value) {
    return JSON.stringify(sortKeys(value));
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function sortKeys(value) {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (value && typeof value === 'object') {
        /** @type {Record<string, unknown>} */
        const out = {};
        for (const k of Object.keys(value).sort()) {
            out[k] = sortKeys(/** @type {Record<string, unknown>} */ (value)[k]);
        }
        return out;
    }
    return value;
}

/**
 * @param {string} distDir
 * @returns {string[]}
 */
function listContentFiles(distDir) {
    /** @type {string[]} */
    const out = [];
    const skipDir = new Set(['_vmz', 'node_modules']);
    const skipName = new Set(['vmz-serve-host.mjs', 'vmz-serve-host.js']);
    /** @param {string} abs */
    /** @param {string} rel */
    function walk(abs, rel) {
        let ents;
        try {
            ents = fs.readdirSync(abs, { withFileTypes: true });
        } catch {
            return;
        }
        for (const e of ents) {
            if (e.name.startsWith('.')) continue;
            const nextAbs = path.join(abs, e.name);
            const nextRel = rel ? `${rel}/${e.name}` : e.name;
            if (e.isDirectory()) {
                if (skipDir.has(e.name)) continue;
                walk(nextAbs, nextRel);
                continue;
            }
            if (skipName.has(e.name)) continue;
            out.push(nextRel.replace(/\\/g, '/'));
        }
    }
    walk(distDir, '');
    out.sort();
    return out;
}

/**
 * @param {string} chunkId
 */
function pathPatternFromChunk(chunkId) {
    const rel = chunkId.replace(/^pages\//, '');
    const parts = rel.split('/').filter(Boolean);
    const segs = [];
    for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (p === 'index' && i === parts.length - 1) continue;
        segs.push(p);
    }
    return segs.length ? `/${segs.join('/')}` : '/';
}

/**
 * Pack `dist/` into `_vmz` manifests + release envelope (filesystem Delivery Profile).
 * @param {string} distDir
 * @param {{ applicationId?: string }} [opts]
 */
export function packRelease(distDir, opts = {}) {
    const abs = path.resolve(distDir);
    if (!fs.existsSync(abs)) {
        throw new Error(`packRelease: missing dist ${abs}`);
    }
    const deploymentPath = path.join(abs, 'vmz-deployment.json');
    if (!fs.existsSync(deploymentPath)) {
        throw new Error(`packRelease: missing ${deploymentPath}`);
    }
    const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
    const files = listContentFiles(abs);
    /** @type {Record<string, string>} */
    const fileDigests = {};
    for (const rel of files) {
        fileDigests[rel] = sha256File(path.join(abs, ...rel.split('/')));
    }

    const pages = (deployment.units || []).filter((u) => u.kind === 'page');
    const routeRealization = {
        schema: ROUTE_REALIZATION_TABLE_SCHEMA,
        routes: pages.map((u) => ({
            routeId: String(u.chunkId),
            chunkId: String(u.chunkId),
            pathPattern: pathPatternFromChunk(String(u.chunkId)),
            clientEntry: u.clientEntry || null,
            programIr: u.programIr || null,
        })),
    };

    const programParts = pages
        .map((u) => u.programIr)
        .filter(Boolean)
        .map((rel) => fileDigests[String(rel).replace(/\\/g, '/')] || '')
        .filter(Boolean)
        .sort();
    const programDigest = sha256Hex(programParts.join('|'));
    const styleDigest = typeof deployment.styleBundleHash === 'string' && deployment.styleBundleHash ? deployment.styleBundleHash : null;
    const deploymentDigest = fileDigests['vmz-deployment.json'] || sha256File(deploymentPath);

    const applicationId = opts.applicationId || 'production-router';
    const applicationArtifact = {
        schema: APPLICATION_ARTIFACT_SCHEMA,
        applicationId,
        deliveryProfile: 'filesystem',
        programDigest,
        planDigest: programDigest,
        deploymentDigest,
        styleDigest,
        routeDigest: sha256Hex(canonicalJson(routeRealization)),
        fileDigests,
        publicRouteContracts: routeRealization.routes.map((r) => r.routeId),
    };
    applicationArtifact.integrity = sha256Hex(canonicalJson({ ...applicationArtifact, integrity: undefined }));

    const deliveryManifest = {
        schema: DELIVERY_ARTIFACT_MANIFEST_SCHEMA,
        deliveryProfile: 'filesystem',
        copiesSemanticIr: false,
        applicationId,
        applicationIntegrity: applicationArtifact.integrity,
        routeCount: routeRealization.routes.length,
        assetCount: Object.keys(fileDigests).length,
        styleDigest,
        deploymentDigest,
    };

    const envelopeBody = {
        schema: RELEASE_ENVELOPE_SCHEMA,
        applicationId,
        deliveryProfile: 'filesystem',
        applicationIntegrity: applicationArtifact.integrity,
        deploymentDigest,
        programDigest,
        styleDigest,
        routeDigest: applicationArtifact.routeDigest,
        fileDigests,
        manifests: {
            applicationArtifact: '_vmz/application-artifact.json',
            deliveryArtifactManifest: '_vmz/delivery-artifact-manifest.json',
            routeRealization: '_vmz/route-realization.json',
        },
    };
    const artifactDigest = sha256Hex(canonicalJson(envelopeBody));
    const envelope = { ...envelopeBody, artifactDigest };

    const vmzDir = path.join(abs, '_vmz');
    fs.mkdirSync(vmzDir, { recursive: true });
    writeJson(path.join(vmzDir, 'application-artifact.json'), applicationArtifact);
    writeJson(path.join(vmzDir, 'delivery-artifact-manifest.json'), deliveryManifest);
    writeJson(path.join(vmzDir, 'route-realization.json'), routeRealization);
    writeJson(path.join(vmzDir, 'release-envelope.json'), envelope);

    return envelope;
}

/**
 * @param {string} file
 * @param {unknown} value
 */
function writeJson(file, value) {
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/**
 * @param {string} pointerPath
 * @param {string} digest
 */
export function atomicWritePointer(pointerPath, digest) {
    const dir = path.dirname(pointerPath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${pointerPath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, `${digest.trim()}\n`, 'utf8');
    try {
        fs.renameSync(tmp, pointerPath);
    } catch {
        if (fs.existsSync(pointerPath)) fs.unlinkSync(pointerPath);
        fs.renameSync(tmp, pointerPath);
    }
}

/**
 * @param {string} pointerPath
 * @returns {string | null}
 */
export function readPointer(pointerPath) {
    if (!fs.existsSync(pointerPath)) return null;
    const t = fs.readFileSync(pointerPath, 'utf8').trim();
    return t || null;
}

/**
 * Publish packed dist into releases root; retain previous pointer for rollback.
 * @param {string} releasesRoot
 * @param {string} distDir
 * @param {ReturnType<typeof packRelease>} envelope
 */
export function publishRelease(releasesRoot, distDir, envelope) {
    const digest = envelope.artifactDigest;
    if (!digest) throw new Error('publishRelease: envelope missing artifactDigest');
    const root = path.resolve(releasesRoot);
    const srcDist = path.resolve(distDir);
    // Node fs.cpSync refuses copying a directory into any subdirectory of itself.
    // Releases root must sit beside dist (e.g. .vmz-releases), never under dist/.
    const dest = path.join(root, digest);
    const destDist = path.join(dest, 'dist');
    if (root === srcDist || root.startsWith(srcDist + path.sep) || destDist.startsWith(srcDist + path.sep)) {
        throw new Error(`publishRelease: releasesRoot must not be under distDir (got releasesRoot=${root}, distDir=${srcDist})`);
    }
    fs.mkdirSync(dest, { recursive: true });
    // Immutable snapshot of packed dist (exclude prior releases nesting).
    fs.rmSync(destDist, { recursive: true, force: true });
    fs.cpSync(srcDist, destDist, {
        recursive: true,
        filter: (src) => {
            const n = src.replace(/\\/g, '/');
            return (
                !n.includes('/.vmz-releases/') &&
                !n.includes('/.vmz-cdn-releases/') &&
                !n.includes('/releases-cdn/') &&
                !/\/dist\/releases(\/|$)/.test(n)
            );
        },
    });
    writeJson(path.join(dest, 'envelope.json'), envelope);

    const currentPath = path.join(root, 'CURRENT');
    const previousPath = path.join(root, 'PREVIOUS');
    const prev = readPointer(currentPath);
    if (prev && prev !== digest) {
        atomicWritePointer(previousPath, prev);
    }
    atomicWritePointer(currentPath, digest);
    return {
        digest,
        previous: prev && prev !== digest ? prev : readPointer(previousPath),
        currentPath,
        releaseDir: dest,
    };
}

/**
 * Rollback CURRENT → PREVIOUS without rebuild.
 * @param {string} releasesRoot
 */
export function rollbackRelease(releasesRoot) {
    const root = path.resolve(releasesRoot);
    const currentPath = path.join(root, 'CURRENT');
    const previousPath = path.join(root, 'PREVIOUS');
    const current = readPointer(currentPath);
    const previous = readPointer(previousPath);
    if (!previous) {
        throw new Error('rollbackRelease: no PREVIOUS pointer');
    }
    if (!fs.existsSync(path.join(root, previous, 'envelope.json'))) {
        throw new Error(`rollbackRelease: missing retained release ${previous}`);
    }
    if (current) {
        atomicWritePointer(previousPath, current);
    }
    atomicWritePointer(currentPath, previous);
    return {
        restored: previous,
        demoted: current,
        releaseDir: path.join(root, previous),
    };
}

/**
 * Structured diff between two release envelopes / digest maps.
 * @param {{ fileDigests?: Record<string, string>, artifactDigest?: string }} a
 * @param {{ fileDigests?: Record<string, string>, artifactDigest?: string }} b
 */
export function diffArtifacts(a, b) {
    const da = a.fileDigests || {};
    const db = b.fileDigests || {};
    const keys = new Set([...Object.keys(da), ...Object.keys(db)]);
    /** @type {string[]} */
    const added = [];
    /** @type {string[]} */
    const removed = [];
    /** @type {Array<{ path: string, before: string, after: string }>} */
    const changed = [];
    for (const k of [...keys].sort()) {
        if (!(k in da)) added.push(k);
        else if (!(k in db)) removed.push(k);
        else if (da[k] !== db[k]) changed.push({ path: k, before: da[k], after: db[k] });
    }
    return {
        schema: ARTIFACT_DIFF_SCHEMA,
        beforeDigest: a.artifactDigest || null,
        afterDigest: b.artifactDigest || null,
        added,
        removed,
        changed,
        identical: added.length === 0 && removed.length === 0 && changed.length === 0,
    };
}

/**
 * @param {string} releasesRoot
 * @param {string} digest
 */
export function loadReleaseEnvelope(releasesRoot, digest) {
    const p = path.join(path.resolve(releasesRoot), digest, 'envelope.json');
    return JSON.parse(fs.readFileSync(p, 'utf8'));
}
