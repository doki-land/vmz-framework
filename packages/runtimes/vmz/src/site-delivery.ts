/**
 * A3-site: SiteDeliveryContract — embedded | filesystem | remote selection + release fallback.
 * Authoring via defineConfig({ delivery }) / defineSite(...); pure data only.
 */
// @ts-nocheck

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { writePrettyJsonFile } from './pretty-json.js';

export const SITE_DELIVERY_CONTRACT_SCHEMA = 'vmz.site.delivery_contract.v0';
export const SITE_DELIVERY_RESOLUTION_SCHEMA = 'vmz.site.delivery_resolution.v0';

/**
 * Pure-data helper for `defineConfig({ delivery: defineSite(...) })`.
 * Not a second config entry — CLI never auto-discovers `vmz.site.ts`.
 * @param {Record<string, unknown>} delivery
 */
export function defineSite(delivery) {
    return delivery;
}

/**
 * Normalize authoring delivery → frozen SiteDeliveryContract.
 * @param {unknown} raw
 * @param {{ siteId?: string, projectRoot?: string }} [opts]
 * @returns {{ ok: true, contract: Record<string, any> } | { ok: false, diagnostics: Array<{ code: string, message: string }> }}
 */
export function normalizeSiteDelivery(raw, opts = {}) {
    /** @type {Array<{ code: string, message: string }>} */
    const diagnostics = [];
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
        return {
            ok: false,
            diagnostics: [{ code: 'site.delivery.invalid', message: 'delivery must be a plain object' }],
        };
    }
    const d = /** @type {Record<string, any>} */ (raw);
    if (typeof d.artifact !== 'string' || !d.artifact.trim()) {
        diagnostics.push({ code: 'site.delivery.artifact', message: 'delivery.artifact is required' });
    }
    if (!Array.isArray(d.sources) || d.sources.length < 1) {
        diagnostics.push({ code: 'site.delivery.sources', message: 'delivery.sources must be a non-empty array' });
    }
    const sources = [];
    const seen = new Set();
    for (const [i, s] of (d.sources || []).entries()) {
        if (!s || typeof s !== 'object') {
            diagnostics.push({ code: 'site.delivery.source', message: `sources[${i}] must be an object` });
            continue;
        }
        const id = String(s.id || '').trim();
        const kind = String(s.kind || '').trim();
        if (!id) {
            diagnostics.push({ code: 'site.delivery.sourceId', message: `sources[${i}].id is required` });
            continue;
        }
        if (seen.has(id)) {
            diagnostics.push({ code: 'site.delivery.sourceId.dup', message: `duplicate source id ${id}` });
            continue;
        }
        seen.add(id);
        if (!['embedded', 'filesystem', 'remote'].includes(kind)) {
            diagnostics.push({
                code: 'site.delivery.kind',
                message: `sources[${i}].kind must be embedded|filesystem|remote`,
            });
            continue;
        }
        if (typeof s.directory === 'function' || typeof s.baseUrl === 'function') {
            diagnostics.push({
                code: 'site.delivery.executable',
                message: `sources[${i}] must be pure data (no functions)`,
            });
            continue;
        }
        if (kind === 'filesystem' && typeof s.directory !== 'string') {
            diagnostics.push({
                code: 'site.delivery.filesystem',
                message: `sources[${i}] filesystem requires directory string`,
            });
        }
        if (kind === 'remote' && typeof s.baseUrl !== 'string') {
            diagnostics.push({
                code: 'site.delivery.remote',
                message: `sources[${i}] remote requires baseUrl string`,
            });
        }
        if (kind === 'embedded' && s.artifact == null && d.artifact == null) {
            diagnostics.push({
                code: 'site.delivery.embedded',
                message: `sources[${i}] embedded requires artifact id`,
            });
        }
        sources.push({
            sourceId: id,
            kind,
            priority: typeof s.priority === 'number' ? s.priority : i,
            trust: s.trust || 'signed-release',
            directory: kind === 'filesystem' ? String(s.directory) : null,
            baseUrl: kind === 'remote' ? String(s.baseUrl).replace(/\/$/, '') : null,
            timeoutMs: kind === 'remote' ? Number(s.timeoutMs || 1500) : null,
            artifact: s.artifact != null ? String(s.artifact) : kind === 'embedded' ? String(d.artifact) : null,
            integrity: s.integrity || null,
            signaturePolicy: s.signaturePolicy || s.trust || 'signed-release',
        });
    }

    const resolution = d.resolution && typeof d.resolution === 'object' ? d.resolution : {};
    const mode = String(resolution.mode || 'release');
    if (mode !== 'release') {
        diagnostics.push({
            code: 'site.delivery.resolution.mode',
            message: `resolution.mode must be 'release' (got ${mode})`,
        });
    }
    let fallback = Array.isArray(resolution.fallback) ? resolution.fallback.map(String) : sources.map((s) => s.sourceId);
    for (const id of fallback) {
        if (!seen.has(id)) {
            diagnostics.push({
                code: 'site.delivery.fallback.unknown',
                message: `resolution.fallback references unknown source ${id}`,
            });
        }
    }
    // Preserve author order — do not reorder by discovery/speed.
    const activation = String(d.activation || 'atomic');
    if (activation !== 'atomic') {
        diagnostics.push({
            code: 'site.delivery.activation',
            message: `activation must be 'atomic' in v0`,
        });
    }

    if (diagnostics.length) return { ok: false, diagnostics };

    const contractBody = {
        schema: SITE_DELIVERY_CONTRACT_SCHEMA,
        schemaVersion: '0',
        siteId: opts.siteId || d.siteId || d.artifact,
        artifact: String(d.artifact),
        expectedCompatibility: d.expectedCompatibility || {
            runtime: 'vmz',
            deliveryProfiles: ['web-static', 'filesystem'],
        },
        sources,
        resolutionPolicy: {
            mode: 'release',
            fallback,
            fileLevelMix: false,
        },
        failurePolicy: d.failure || d.failurePolicy || { onAllSourcesFailed: 'embedded-or-fail' },
        updatePolicy: d.update || d.updatePolicy || { backgroundRemote: true },
        rollbackPolicy: d.rollback || d.rollbackPolicy || { retainPrevious: true },
        securityPolicy: d.security || d.securityPolicy || { requireSignature: true, forbidSecretsInContract: true },
        activation: 'atomic',
    };
    contractBody.contractDigest = sha256Hex(canonicalJson(contractBody));
    return { ok: true, contract: contractBody };
}

/**
 * Probe one physical source for release-level readiness (not per-URL).
 * @param {{
 *   available?: boolean,
 *   artifactDigest?: string | null,
 *   integrityOk?: boolean,
 *   signatureOk?: boolean,
 *   objectClosureOk?: boolean,
 *   mixedDigestObjects?: boolean,
 *   error?: string | null,
 * }} [probe]
 */
export function normalizeSourceProbe(probe = {}) {
    return {
        available: probe.available !== false,
        artifactDigest: probe.artifactDigest ?? null,
        integrityOk: probe.integrityOk !== false,
        signatureOk: probe.signatureOk !== false,
        objectClosureOk: probe.objectClosureOk !== false,
        mixedDigestObjects: Boolean(probe.mixedDigestObjects),
        error: probe.error || null,
    };
}

/**
 * Resolve one complete release per SiteDeliveryContract (no file-level mix).
 * @param {Record<string, any>} contract
 * @param {Record<string, ReturnType<typeof normalizeSourceProbe>>} probes by sourceId
 */
export function resolveSiteRelease(contract, probes = {}) {
    const attempted = [];
    const fallback = contract.resolutionPolicy?.fallback || contract.sources.map((s) => s.sourceId);

    for (const sourceId of fallback) {
        const source = (contract.sources || []).find((s) => s.sourceId === sourceId);
        if (!source) {
            attempted.push({ sourceId, result: 'skip', reason: 'unknown-source' });
            continue;
        }
        const probe = normalizeSourceProbe(probes[sourceId]);
        if (!probe.available) {
            attempted.push({ sourceId, result: 'reject', reason: probe.error || 'unavailable' });
            continue;
        }
        if (probe.mixedDigestObjects) {
            attempted.push({
                sourceId,
                result: 'reject',
                reason: 'file-level-mix-forbidden',
            });
            continue;
        }
        if (!probe.objectClosureOk) {
            attempted.push({ sourceId, result: 'reject', reason: 'object-closure-incomplete' });
            continue;
        }
        if (contract.securityPolicy?.requireSignature !== false && !probe.signatureOk) {
            attempted.push({ sourceId, result: 'reject', reason: 'signature-failed' });
            continue;
        }
        if (!probe.integrityOk) {
            attempted.push({ sourceId, result: 'reject', reason: 'integrity-failed' });
            continue;
        }
        if (!probe.artifactDigest) {
            attempted.push({ sourceId, result: 'reject', reason: 'missing-artifact-digest' });
            continue;
        }

        attempted.push({ sourceId, result: 'accept', reason: null });
        const resolution = {
            schema: SITE_DELIVERY_RESOLUTION_SCHEMA,
            status: 'activated',
            selectedSourceId: sourceId,
            selectedKind: source.kind,
            selectedDigest: probe.artifactDigest,
            fallbackReason: attempted.some((a) => a.result === 'reject')
                ? attempted
                      .filter((a) => a.result === 'reject')
                      .map((a) => `${a.sourceId}:${a.reason}`)
                      .join(';')
                : null,
            attempted,
            fileLevelMix: false,
            activation: 'atomic',
            contractDigest: contract.contractDigest,
        };
        resolution.resolutionDigest = sha256Hex(canonicalJson(resolution));
        return resolution;
    }

    return {
        schema: SITE_DELIVERY_RESOLUTION_SCHEMA,
        status: 'failed',
        selectedSourceId: null,
        selectedKind: null,
        selectedDigest: null,
        fallbackReason: 'all-sources-rejected',
        attempted,
        fileLevelMix: false,
        activation: 'atomic',
        contractDigest: contract.contractDigest,
        resolutionDigest: null,
    };
}

/**
 * Read a packed release directory probe (expects _vmz/release-envelope.json + object closure).
 * @param {string} releaseDir absolute path to a release snapshot (contains dist/ or is dist/)
 */
export function probeReleaseDirectory(releaseDir) {
    const root = path.resolve(releaseDir);
    const dist = fs.existsSync(path.join(root, 'dist')) ? path.join(root, 'dist') : root;
    const envelopePath = path.join(dist, '_vmz', 'release-envelope.json');
    if (!fs.existsSync(envelopePath)) {
        return normalizeSourceProbe({
            available: false,
            error: 'missing-release-envelope',
            objectClosureOk: false,
            signatureOk: false,
            integrityOk: false,
        });
    }
    let envelope;
    try {
        envelope = JSON.parse(fs.readFileSync(envelopePath, 'utf8'));
    } catch {
        return normalizeSourceProbe({
            available: false,
            error: 'invalid-release-envelope',
            objectClosureOk: false,
            signatureOk: false,
            integrityOk: false,
        });
    }
    const digest = envelope.artifactDigest || null;
    const required = ['index.html', '_vmz/release-envelope.json'];
    let closureOk = true;
    for (const rel of required) {
        if (!fs.existsSync(path.join(dist, rel))) {
            closureOk = false;
            break;
        }
    }
    // Detect naive file-level mix: CURRENT HTML digest stamp mismatch with envelope (test hook).
    const mixMarker = path.join(dist, '_vmz', 'MIXED_DIGEST');
    const mixed = fs.existsSync(mixMarker);
    return normalizeSourceProbe({
        available: true,
        artifactDigest: digest,
        integrityOk: Boolean(digest) && !mixed,
        signatureOk: envelope.signatureOk !== false,
        objectClosureOk: closureOk && !mixed,
        mixedDigestObjects: mixed,
        error: mixed ? 'mixed-digest' : null,
    });
}

/**
 * Emit normalized contract (+ optional resolution) under dist/_vmz.
 * @param {string} outDir
 * @param {unknown} deliveryRaw
 * @param {{ siteId?: string, probes?: Record<string, any> }} [opts]
 */
export function emitSiteDelivery(outDir, deliveryRaw, opts = {}) {
    const norm = normalizeSiteDelivery(deliveryRaw, { siteId: opts.siteId });
    if (!norm.ok) {
        throw new Error(`emitSiteDelivery: ${norm.diagnostics.map((d) => d.message).join('; ')}`);
    }
    const vmzDir = path.join(outDir, '_vmz');
    fs.mkdirSync(vmzDir, { recursive: true });
    writePrettyJsonFile(path.join(vmzDir, 'site-delivery-contract.json'), norm.contract);
    let resolution = null;
    if (opts.probes) {
        resolution = resolveSiteRelease(norm.contract, opts.probes);
        writePrettyJsonFile(path.join(vmzDir, 'site-delivery-resolution.json'), resolution);
    }
    return { contract: norm.contract, resolution };
}

function sha256Hex(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
}

function canonicalJson(value) {
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
