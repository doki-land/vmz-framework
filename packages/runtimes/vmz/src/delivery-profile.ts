/**
 * B0 — Delivery profile authoring normalize + CLI --profile resolve.
 * Pure data only; expands legacy site-delivery sugar into profiles[default].
 */
// @ts-nocheck

import crypto from 'node:crypto';

export const DELIVERY_PROFILE_AUTHORING_SCHEMA = 'vmz.delivery.authoring.v0';
export const BUILD_PROFILE_SELECTION_SCHEMA = 'vmz.build.profile_selection.v0';

/** Browser-era assembly kinds (04 B5). */
export const ASSEMBLIES = Object.freeze(['local-static', 'static-cdn', 'server-host', 'cdn+server', 'rust-embedded']);

export const SERVER_RUNTIMES = Object.freeze(['node', 'worker', 'deno', 'bun', 'rust-host']);

/** Official built-in aliases when not overridden in config. */
export const BUILTIN_PROFILES = Object.freeze({
    'web-client': { host: 'browser', assembly: 'local-static' },
    'web-static': { host: 'browser', assembly: 'static-cdn' },
    'web-ssr': { host: 'browser', assembly: 'server-host', serverRuntime: 'node' },
    'web-hybrid': { host: 'browser', assembly: 'cdn+server', serverRuntime: 'node' },
});

function isPlainObject(v) {
    return v != null && typeof v === 'object' && !Array.isArray(v);
}

export function pickSiteAuthoring(raw) {
    if (!isPlainObject(raw)) return null;
    if (!Array.isArray(raw.sources) || raw.sources.length < 1) return null;
    if (typeof raw.artifact !== 'string' || !String(raw.artifact).trim()) return null;
    const site = {
        artifact: String(raw.artifact),
        sources: raw.sources,
    };
    for (const k of [
        'siteId',
        'resolution',
        'activation',
        'expectedCompatibility',
        'failure',
        'failurePolicy',
        'update',
        'updatePolicy',
        'rollback',
        'rollbackPolicy',
        'security',
        'securityPolicy',
    ]) {
        if (raw[k] !== undefined) site[k] = raw[k];
    }
    return site;
}

function normalizeProfileEntry(entry, id, diagnostics) {
    if (!isPlainObject(entry)) {
        diagnostics.push({ code: 'delivery.profile.invalid', message: `profiles.${id} must be an object` });
        return null;
    }
    const host = String(entry.host || 'browser');
    if (host !== 'browser') {
        diagnostics.push({
            code: 'delivery.profile.host',
            message: `profiles.${id}.host: only 'browser' is supported before Browser Production (got ${host})`,
        });
    }
    const assembly = String(entry.assembly || '').trim();
    if (!ASSEMBLIES.includes(assembly)) {
        diagnostics.push({
            code: 'delivery.profile.assembly',
            message: `profiles.${id}.assembly must be one of ${ASSEMBLIES.join('|')} (got ${assembly || '(empty)'})`,
        });
        return null;
    }
    let serverRuntime = null;
    if (assembly === 'server-host' || assembly === 'cdn+server') {
        serverRuntime = String(entry.serverRuntime || 'node');
        if (!SERVER_RUNTIMES.includes(serverRuntime)) {
            diagnostics.push({
                code: 'delivery.profile.serverRuntime',
                message: `profiles.${id}.serverRuntime must be one of ${SERVER_RUNTIMES.join('|')}`,
            });
        }
    }
    let sources = null;
    if (entry.sources != null) {
        if (isPlainObject(entry.sources) && Array.isArray(entry.sources.sources)) {
            sources = pickSiteAuthoring(entry.sources);
        } else if (Array.isArray(entry.sources)) {
            sources = pickSiteAuthoring({
                artifact: entry.artifact || entry.sourcesArtifact || id,
                sources: entry.sources,
                resolution: entry.resolution,
                activation: entry.activation,
            });
        } else {
            diagnostics.push({
                code: 'delivery.profile.sources',
                message: `profiles.${id}.sources must be defineSite({...}) or a sources array with artifact`,
            });
        }
        if (entry.sources != null && sources == null) {
            const already = diagnostics.some((d) => String(d.message || '').includes(`profiles.${id}`));
            if (!already) {
                diagnostics.push({
                    code: 'delivery.profile.sources.artifact',
                    message: `profiles.${id} site sources require artifact string`,
                });
            }
        }
    }
    return {
        id,
        host: 'browser',
        assembly,
        serverRuntime,
        sources,
    };
}

export function normalizeDeliveryAuthoring(raw) {
    const diagnostics = [];
    if (raw == null) {
        const profiles = { ...BUILTIN_PROFILES };
        const normalized = {};
        for (const [id, entry] of Object.entries(profiles)) {
            const n = normalizeProfileEntry(entry, id, diagnostics);
            if (n) normalized[id] = n;
        }
        const table = {
            schema: DELIVERY_PROFILE_AUTHORING_SCHEMA,
            default: 'web-ssr',
            profiles: normalized,
            sugar: false,
        };
        table.digest = sha256Hex(canonicalJson(table));
        return { ok: true, table };
    }
    if (!isPlainObject(raw)) {
        return {
            ok: false,
            diagnostics: [{ code: 'delivery.invalid', message: 'delivery must be a plain object' }],
        };
    }

    let profileInputs = {};
    let defaultId = '';
    let sugar = false;

    if (isPlainObject(raw.profiles)) {
        defaultId = String(raw.default || '').trim();
        profileInputs = { ...BUILTIN_PROFILES, ...raw.profiles };
        if (!defaultId) {
            const keys = Object.keys(raw.profiles);
            defaultId = keys[0] || 'web-ssr';
        }
    } else if (Array.isArray(raw.sources) || raw.artifact != null || raw.assembly != null) {
        sugar = true;
        const site = pickSiteAuthoring(raw);
        defaultId = String(raw.default || raw.artifact || 'web-ssr').trim() || 'web-ssr';
        const assembly =
            typeof raw.assembly === 'string' && ASSEMBLIES.includes(raw.assembly) ? raw.assembly : site ? 'rust-embedded' : 'server-host';
        profileInputs = {
            ...BUILTIN_PROFILES,
            [defaultId]: {
                host: raw.host || 'browser',
                assembly,
                serverRuntime: raw.serverRuntime || 'node',
                ...(site
                    ? {
                          artifact: site.artifact,
                          sources: site.sources,
                          resolution: site.resolution,
                          activation: site.activation,
                          expectedCompatibility: site.expectedCompatibility,
                          failure: site.failure,
                          failurePolicy: site.failurePolicy,
                          update: site.update,
                          updatePolicy: site.updatePolicy,
                          rollback: site.rollback,
                          rollbackPolicy: site.rollbackPolicy,
                          security: site.security,
                          securityPolicy: site.securityPolicy,
                      }
                    : {}),
            },
        };
    } else {
        return {
            ok: false,
            diagnostics: [
                {
                    code: 'delivery.shape',
                    message: 'delivery must declare profiles{} or legacy { artifact, sources }',
                },
            ],
        };
    }

    const profiles = {};
    for (const [id, entry] of Object.entries(profileInputs)) {
        const n = normalizeProfileEntry(entry, id, diagnostics);
        if (n) profiles[id] = n;
    }
    if (!profiles[defaultId]) {
        diagnostics.push({
            code: 'delivery.default',
            message: `delivery.default '${defaultId}' is not a known profile`,
        });
    }
    if (diagnostics.length) return { ok: false, diagnostics };

    const table = {
        schema: DELIVERY_PROFILE_AUTHORING_SCHEMA,
        default: defaultId,
        profiles,
        sugar,
    };
    table.digest = sha256Hex(canonicalJson(table));
    return { ok: true, table };
}

export function selectBuildProfile(table, cliProfile = '') {
    const id = String(cliProfile || '').trim() || table.default;
    const profile = table.profiles[id];
    if (!profile) {
        return {
            ok: false,
            diagnostics: [
                {
                    code: 'delivery.profile.unknown',
                    message: `unknown build --profile ${id} (known: ${Object.keys(table.profiles).join(', ')})`,
                },
            ],
        };
    }
    const selection = {
        schema: BUILD_PROFILE_SELECTION_SCHEMA,
        profileId: id,
        host: profile.host,
        assembly: profile.assembly,
        serverRuntime: profile.serverRuntime,
        hasSiteSources: Boolean(profile.sources),
        authoringDigest: table.digest,
        fromCli: Boolean(String(cliProfile || '').trim()),
    };
    selection.digest = sha256Hex(canonicalJson(selection));
    return { ok: true, selection, profile };
}

export function semanticIdsForAssembly(assembly) {
    switch (assembly) {
        case 'static-cdn':
            return ['static-delivery', 'asset-graph'];
        case 'server-host':
            return ['server-host', 'asset-graph'];
        case 'cdn+server':
            return ['server-host', 'static-delivery', 'asset-graph'];
        case 'rust-embedded':
            return ['site-fallback', 'asset-graph'];
        case 'local-static':
            return ['asset-graph'];
        default:
            return [];
    }
}

export function canonicalJson(value) {
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

export function sha256Hex(text) {
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}
