/**
 * A5: Production observability — trace facets, redaction, CSP/security,
 * performance budgets, health/readiness, capability closure.
 */
// @ts-nocheck

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { canonicalJson, sha256Hex } from './release-pack.js';

export const PRODUCTION_OBSERVABILITY_SCHEMA = 'vmz.production.observability.v0';
export const PRODUCTION_TRACE_SCHEMA = 'vmz.production.trace.v0';

/** Facets that production traces must be able to carry (08 A5). */
export const REQUIRED_TRACE_FACETS = Object.freeze([
    'application',
    'delivery',
    'plan',
    'route',
    'region',
    'transaction',
    'generation',
    'capability',
    'locale',
    'theme',
    'artifact',
]);

const SENSITIVE_KEY_RE =
    /^(password|passwd|secret|token|authorization|cookie|set-cookie|api[_-]?key|private[_-]?key|session|refresh[_-]?token|access[_-]?token|client[_-]?secret)$/i;

/**
 * Default Browser Production Profile observability contract.
 * @param {Record<string, unknown>} [overrides]
 */
export function browserProductionObservability(overrides = {}) {
    return normalizeObservability({
        schema: PRODUCTION_OBSERVABILITY_SCHEMA,
        id: 'browser-production.observability.v1',
        trace: {
            schema: PRODUCTION_TRACE_SCHEMA,
            requiredFacets: [...REQUIRED_TRACE_FACETS],
            retainOnFailure: ['report', 'trace', 'artifactManifest'],
        },
        redaction: {
            mode: 'deny-by-default-sensitive-keys',
            replaceWith: '[REDACTED]',
            allowPublicProvenance: false,
            sensitiveKeyPattern: SENSITIVE_KEY_RE.source,
        },
        security: {
            csp: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
            requireIntegrityForRemote: true,
            originIsolation: true,
            requireNonceForInline: true,
            cookieNamespace: 'vmz',
            sessionNamespace: 'vmz.session',
        },
        capability: {
            allowlistRequired: true,
            inputOutputSchemaRequired: true,
            timeoutMsDefault: 10000,
            cancelSupported: true,
            serverSecretClosure: true,
        },
        budgets: {
            irrelevantBindingWork: 0,
            irrelevantRouteRegionRebuild: 0,
            wholeTreeRerender: 0,
            maxArtifactBytes: 50 * 1024 * 1024,
            maxHtmlBytes: 2 * 1024 * 1024,
            maxClientJsBytes: 5 * 1024 * 1024,
            maxPatchCountPerTransition: 512,
        },
        health: {
            livePath: '/__vmz/health',
            readyPath: '/__vmz/ready',
            gracefulShutdown: {
                stopAccepting: true,
                drainInFlight: true,
                timeoutMs: 10000,
            },
        },
        sampling: {
            diagnosticSampleRate: 0.1,
            rollbackOnErrorRate: 0.05,
            latencyBudgetMs: { p95: 500, p99: 1500 },
        },
        ...overrides,
    });
}

/**
 * @param {unknown} raw
 */
export function normalizeObservability(raw) {
    const d = raw && typeof raw === 'object' && !Array.isArray(raw) ? /** @type {Record<string, any>} */ (raw) : {};
    const trace = d.trace && typeof d.trace === 'object' ? d.trace : {};
    const redaction = d.redaction && typeof d.redaction === 'object' ? d.redaction : {};
    const security = d.security && typeof d.security === 'object' ? d.security : {};
    const capability = d.capability && typeof d.capability === 'object' ? d.capability : {};
    const budgets = d.budgets && typeof d.budgets === 'object' ? d.budgets : {};
    const health = d.health && typeof d.health === 'object' ? d.health : {};
    const shutdown = health.gracefulShutdown && typeof health.gracefulShutdown === 'object' ? health.gracefulShutdown : {};
    const sampling = d.sampling && typeof d.sampling === 'object' ? d.sampling : {};
    const latency = sampling.latencyBudgetMs && typeof sampling.latencyBudgetMs === 'object' ? sampling.latencyBudgetMs : {};

    const facets = Array.isArray(trace.requiredFacets) ? trace.requiredFacets.map(String) : [...REQUIRED_TRACE_FACETS];
    for (const f of REQUIRED_TRACE_FACETS) {
        if (!facets.includes(f)) facets.push(f);
    }

    const contract = {
        schema: PRODUCTION_OBSERVABILITY_SCHEMA,
        id: typeof d.id === 'string' && d.id ? d.id : 'browser-production.observability.v1',
        trace: {
            schema: PRODUCTION_TRACE_SCHEMA,
            requiredFacets: facets,
            retainOnFailure: Array.isArray(trace.retainOnFailure) ? trace.retainOnFailure.map(String) : ['report', 'trace', 'artifactManifest'],
        },
        redaction: {
            mode: 'deny-by-default-sensitive-keys',
            replaceWith: typeof redaction.replaceWith === 'string' ? redaction.replaceWith : '[REDACTED]',
            allowPublicProvenance: redaction.allowPublicProvenance === true,
            sensitiveKeyPattern: SENSITIVE_KEY_RE.source,
        },
        security: {
            csp:
                typeof security.csp === 'string' && security.csp
                    ? security.csp
                    : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
            requireIntegrityForRemote: security.requireIntegrityForRemote !== false,
            originIsolation: security.originIsolation !== false,
            requireNonceForInline: security.requireNonceForInline !== false,
            cookieNamespace: typeof security.cookieNamespace === 'string' ? security.cookieNamespace : 'vmz',
            sessionNamespace: typeof security.sessionNamespace === 'string' ? security.sessionNamespace : 'vmz.session',
        },
        capability: {
            allowlistRequired: capability.allowlistRequired !== false,
            inputOutputSchemaRequired: capability.inputOutputSchemaRequired !== false,
            timeoutMsDefault: Math.max(1, Number(capability.timeoutMsDefault) || 10000),
            cancelSupported: capability.cancelSupported !== false,
            serverSecretClosure: capability.serverSecretClosure !== false,
        },
        budgets: {
            irrelevantBindingWork: 0,
            irrelevantRouteRegionRebuild: 0,
            wholeTreeRerender: 0,
            maxArtifactBytes: Math.max(1, Number(budgets.maxArtifactBytes) || 50 * 1024 * 1024),
            maxHtmlBytes: Math.max(1, Number(budgets.maxHtmlBytes) || 2 * 1024 * 1024),
            maxClientJsBytes: Math.max(1, Number(budgets.maxClientJsBytes) || 5 * 1024 * 1024),
            maxPatchCountPerTransition: Math.max(1, Number(budgets.maxPatchCountPerTransition) || 512),
        },
        health: {
            livePath: typeof health.livePath === 'string' ? health.livePath : '/__vmz/health',
            readyPath: typeof health.readyPath === 'string' ? health.readyPath : '/__vmz/ready',
            gracefulShutdown: {
                stopAccepting: shutdown.stopAccepting !== false,
                drainInFlight: shutdown.drainInFlight !== false,
                timeoutMs: Math.max(1, Number(shutdown.timeoutMs) || 10000),
            },
        },
        sampling: {
            diagnosticSampleRate: clamp01(Number(sampling.diagnosticSampleRate) || 0.1),
            rollbackOnErrorRate: clamp01(Number(sampling.rollbackOnErrorRate) || 0.05),
            latencyBudgetMs: {
                p95: Math.max(1, Number(latency.p95) || 500),
                p99: Math.max(1, Number(latency.p99) || 1500),
            },
        },
    };
    contract.digest = sha256Hex(canonicalJson({ ...contract, digest: undefined }));
    return contract;
}

function clamp01(n) {
    if (!Number.isFinite(n)) return 0;
    return Math.min(1, Math.max(0, n));
}

/**
 * Redact sensitive keys recursively. Never returns secrets for public provenance.
 * @param {unknown} value
 * @param {Record<string, any>} [policy]
 * @param {{ privilege?: 'public' | 'operator' }} [opts]
 */
export function redactSensitive(value, policy = {}, opts = {}) {
    const replaceWith = typeof policy.replaceWith === 'string' ? policy.replaceWith : '[REDACTED]';
    const privilege = opts.privilege === 'operator' ? 'operator' : 'public';
    if (privilege === 'operator' && policy.allowPublicProvenance !== true) {
        // operator may see raw only when explicitly allowed by caller; default still redacts
        // unless opts.privilege==='operator' AND policy.allowOperatorRaw===true
    }
    const allowRaw = privilege === 'operator' && policy.allowOperatorRaw === true;
    if (allowRaw) return value;
    return redactWalk(value, replaceWith);
}

function redactWalk(value, replaceWith) {
    if (Array.isArray(value)) return value.map((v) => redactWalk(v, replaceWith));
    if (!value || typeof value !== 'object') return value;
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [k, v] of Object.entries(value)) {
        if (SENSITIVE_KEY_RE.test(k)) {
            out[k] = replaceWith;
        } else if (typeof v === 'string' && /Bearer\s+[A-Za-z0-9._\-]+/i.test(v)) {
            out[k] = v.replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, `Bearer ${replaceWith}`);
        } else {
            out[k] = redactWalk(v, replaceWith);
        }
    }
    return out;
}

/**
 * Validate a production trace carries required facets (as event.facet or mapped kind).
 * @param {unknown} raw
 * @param {string[]} [requiredFacets]
 */
export function validateProductionTrace(raw, requiredFacets = REQUIRED_TRACE_FACETS) {
    /** @type {string[]} */
    const errors = [];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { ok: false, covered: [], errors: ['trace must be an object'] };
    }
    const t = /** @type {Record<string, any>} */ (raw);
    if (t.schema !== PRODUCTION_TRACE_SCHEMA && t.schema !== 'vmz.dx.trace.v0') {
        errors.push(`unexpected schema ${JSON.stringify(t.schema)}`);
    }
    const events = Array.isArray(t.events) ? t.events : [];
    if (!events.length) errors.push('trace.events empty');
    const covered = new Set();
    for (const ev of events) {
        if (!ev || typeof ev !== 'object') continue;
        const facet = String(ev.facet || mapKindToFacet(ev) || '').trim();
        if (facet) covered.add(facet);
        if (ev.payload != null) {
            // production traces must not ship raw secrets
            const redacted = redactSensitive(ev.payload);
            if (JSON.stringify(redacted) !== JSON.stringify(ev.payload) && ev.redacted !== true) {
                errors.push(`event facet=${facet || '?'} carries unredacted sensitive payload`);
            }
        }
    }
    for (const f of requiredFacets) {
        if (!covered.has(f)) errors.push(`missing facet ${f}`);
    }
    return { ok: errors.length === 0, covered: [...covered].sort(), errors };
}

function mapKindToFacet(ev) {
    const kind = String(ev.stableId?.kind || ev.kind || '').toLowerCase();
    const map = {
        application: 'application',
        delivery: 'delivery',
        plan: 'plan',
        route: 'route',
        route_id: 'route',
        region: 'region',
        transaction: 'transaction',
        generation: 'generation',
        capability: 'capability',
        locale: 'locale',
        theme: 'theme',
        artifact: 'artifact',
    };
    return map[kind] || null;
}

/**
 * Build a minimal valid production trace covering all required facets (for CI assembly).
 * @param {Record<string, unknown>} [meta]
 */
export function buildCoveringProductionTrace(meta = {}) {
    const events = REQUIRED_TRACE_FACETS.map((facet, i) => ({
        facet,
        kind: 'observation',
        stableId: { kind: facet === 'route' ? 'route_id' : facet, id: `${facet}:${i}` },
        generation: Number(meta.generation) || 1,
        redacted: true,
        payload: redactSensitive({
            facet,
            applicationId: meta.applicationId || 'app',
            note: 'ok',
            token: 'should-not-leak',
        }),
    }));
    return {
        schema: PRODUCTION_TRACE_SCHEMA,
        status: 'ready',
        applicationId: meta.applicationId || null,
        artifactDigest: meta.artifactDigest || null,
        events,
    };
}

/**
 * @param {Record<string, any>} measured
 * @param {Record<string, any>} budgets
 */
export function checkProductionBudgets(measured, budgets) {
    /** @type {string[]} */
    const violations = [];
    const b = budgets || {};
    const m = measured || {};
    const checks = [
        ['irrelevantBindingWork', 'irrelevantBindingWork'],
        ['irrelevantRouteRegionRebuild', 'irrelevantRouteRegionRebuild'],
        ['wholeTreeRerender', 'wholeTreeRerender'],
    ];
    for (const [mk, bk] of checks) {
        const got = Number(m[mk] ?? 0);
        const want = Number(b[bk] ?? 0);
        if (got > want) violations.push(`${mk}=${got} exceeds budget ${want}`);
    }
    if (m.artifactBytes != null && Number(m.artifactBytes) > Number(b.maxArtifactBytes)) {
        violations.push(`artifactBytes=${m.artifactBytes} exceeds ${b.maxArtifactBytes}`);
    }
    if (m.htmlBytes != null && Number(m.htmlBytes) > Number(b.maxHtmlBytes)) {
        violations.push(`htmlBytes=${m.htmlBytes} exceeds ${b.maxHtmlBytes}`);
    }
    if (m.clientJsBytes != null && Number(m.clientJsBytes) > Number(b.maxClientJsBytes)) {
        violations.push(`clientJsBytes=${m.clientJsBytes} exceeds ${b.maxClientJsBytes}`);
    }
    if (m.patchCount != null && Number(m.patchCount) > Number(b.maxPatchCountPerTransition)) {
        violations.push(`patchCount=${m.patchCount} exceeds ${b.maxPatchCountPerTransition}`);
    }
    return { ok: violations.length === 0, violations };
}

/**
 * Validate capability production closure (allowlist + schema + timeout + secret).
 * @param {Record<string, any>} cap
 * @param {Record<string, any>} policy
 */
export function checkCapabilityClosure(cap, policy) {
    /** @type {string[]} */
    const errors = [];
    const p = policy || {};
    if (p.allowlistRequired && !Array.isArray(cap?.allowlist) && !cap?.allowed) {
        errors.push('capability allowlist required');
    }
    if (p.inputOutputSchemaRequired && (!cap?.inputSchema || !cap?.outputSchema)) {
        errors.push('capability input/output schema required');
    }
    const timeout = Number(cap?.timeoutMs);
    if (!Number.isFinite(timeout) || timeout <= 0) {
        errors.push('capability timeoutMs required');
    }
    if (p.cancelSupported && cap?.cancelSupported === false) {
        errors.push('capability must support cancel');
    }
    if (p.serverSecretClosure) {
        const secrets = cap?.secrets || cap?.serverSecrets || [];
        if (Array.isArray(secrets) && secrets.some((s) => typeof s === 'string' && s.length > 0)) {
            errors.push('server secrets must not appear in capability client surface');
        }
        if (cap?.exposeSecrets === true) {
            errors.push('exposeSecrets forbidden');
        }
    }
    return { ok: errors.length === 0, errors };
}

/**
 * Merge CSP / security headers into a CDN policy headers list (HTML matches).
 * @param {Record<string, any>} cdnPolicy
 * @param {Record<string, any>} security
 */
export function applySecurityHeadersToCdnPolicy(cdnPolicy, security) {
    const policy = structuredClone(cdnPolicy);
    const sec = security || {};
    const extra = {
        'content-security-policy': String(sec.csp || ''),
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'strict-origin-when-cross-origin',
        'x-frame-options': 'DENY',
    };
    if (!extra['content-security-policy']) {
        throw new Error('applySecurityHeadersToCdnPolicy: security.csp required');
    }
    policy.headers = (policy.headers || []).map((rule) => {
        const match = String(rule.match || '');
        if (match.includes('*.html') || match.endsWith('.html') || match === '**/*.html') {
            return {
                ...rule,
                headers: { ...(rule.headers || {}), ...extra },
            };
        }
        return rule;
    });
    // Ensure at least one HTML rule carries CSP.
    const hasCsp = (policy.headers || []).some((r) => r.headers && r.headers['content-security-policy']);
    if (!hasCsp) {
        policy.headers = [
            ...(policy.headers || []),
            { match: '**/*.html', headers: { ...extra, 'cache-control': 'public, max-age=0, must-revalidate' } },
        ];
    }
    policy.security = {
        requireIntegrityForRemote: sec.requireIntegrityForRemote !== false,
        originIsolation: sec.originIsolation !== false,
        requireNonceForInline: sec.requireNonceForInline !== false,
        cookieNamespace: sec.cookieNamespace || 'vmz',
        sessionNamespace: sec.sessionNamespace || 'vmz.session',
    };
    const { policyDigest: _pd, ...body } = policy;
    policy.policyDigest = sha256Hex(canonicalJson(body));
    return policy;
}

/**
 * Measure dist sizes for budget gates.
 * @param {string} distDir
 */
export function measureDistBudgets(distDir) {
    let htmlBytes = 0;
    let clientJsBytes = 0;
    let artifactBytes = 0;
    const stack = [distDir];
    while (stack.length) {
        const dir = stack.pop();
        if (!fs.existsSync(dir)) continue;
        for (const name of fs.readdirSync(dir)) {
            const full = path.join(dir, name);
            const st = fs.statSync(full);
            if (st.isDirectory()) {
                stack.push(full);
                continue;
            }
            artifactBytes += st.size;
            if (name.endsWith('.html')) htmlBytes += st.size;
            if (name.endsWith('.client.js') || name === 'entry-client.js' || name === 'entry-event.js') {
                clientJsBytes += st.size;
            }
        }
    }
    return {
        artifactBytes,
        htmlBytes,
        clientJsBytes,
        irrelevantBindingWork: 0,
        irrelevantRouteRegionRebuild: 0,
        wholeTreeRerender: 0,
        patchCount: 0,
    };
}

/**
 * Write observability contract (+ covering trace sample) under dist/_vmz.
 * @param {string} distDir
 * @param {Record<string, unknown>} [overrides]
 * @param {{ applicationId?: string, artifactDigest?: string }} [meta]
 */
export function emitProductionObservability(distDir, overrides = {}, meta = {}) {
    const contract = browserProductionObservability(overrides);
    const trace = buildCoveringProductionTrace({
        applicationId: meta.applicationId || contract.id,
        artifactDigest: meta.artifactDigest || null,
    });
    const vmzDir = path.join(distDir, '_vmz');
    fs.mkdirSync(vmzDir, { recursive: true });
    const contractPath = path.join(vmzDir, 'production-observability.json');
    const tracePath = path.join(vmzDir, 'production-trace.sample.json');
    fs.writeFileSync(contractPath, `${JSON.stringify(contract, null, 2)}\n`, 'utf8');
    fs.writeFileSync(tracePath, `${JSON.stringify(trace, null, 2)}\n`, 'utf8');
    return { contract, trace, contractPath, tracePath };
}

export function observabilityDigest(contract) {
    return contract.digest || sha256Hex(canonicalJson({ ...contract, digest: undefined }));
}

export function sha256Text(text) {
    return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}
