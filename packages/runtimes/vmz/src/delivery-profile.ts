/**
 * B0 — Delivery profile authoring normalize + CLI --profile resolve.
 * Pure data only; expands legacy site-delivery sugar into profiles[default].
 */

import crypto from 'node:crypto';
import path from 'node:path';

export const DELIVERY_PROFILE_AUTHORING_SCHEMA = 'vmz.delivery.authoring.v0';
export const BUILD_PROFILE_SELECTION_SCHEMA = 'vmz.build.profile_selection.v0';

/** Browser-era assembly kinds (04 B5). `static-cdn` was renamed to `web-static`. */
export const ASSEMBLIES = Object.freeze(['local-static', 'web-static', 'server-host', 'cdn+server', 'rust-embedded']);

export const SERVER_RUNTIMES = Object.freeze(['node', 'worker', 'deno', 'bun', 'rust-host']);

interface SiteAuthoring {
    artifact: string;
    sources: unknown;
    siteId?: unknown;
    resolution?: unknown;
    activation?: unknown;
    expectedCompatibility?: unknown;
    failure?: unknown;
    failurePolicy?: unknown;
    update?: unknown;
    updatePolicy?: unknown;
    rollback?: unknown;
    rollbackPolicy?: unknown;
    security?: unknown;
    securityPolicy?: unknown;
}

export interface WechatPackagingData {
    appId?: string;
    projectName?: string;
    title?: string;
}

interface DeliveryAuthoringTable {
    schema: string;
    default: string;
    profiles: Record<string, unknown>;
    sugar: boolean;
    packaging?: { wechat: WechatPackagingData };
    digest?: string;
}

interface BuildProfileSelection {
    schema: string;
    profileId: string;
    name: string;
    nameExplicit: boolean;
    host: string;
    assembly: string;
    serverRuntime: string | null;
    hasSiteSources: boolean;
    authoringDigest: string | undefined;
    fromCli: boolean;
    digest?: string;
}

/** Official built-in aliases when not overridden in config. */
export const BUILTIN_PROFILES = Object.freeze({
    'web-client': { host: 'browser', assembly: 'local-static' },
    static: { host: 'browser', assembly: 'web-static' },
    'web-ssr': { host: 'browser', assembly: 'server-host', serverRuntime: 'node' },
    'web-hybrid': { host: 'browser', assembly: 'cdn+server', serverRuntime: 'node' },
});

/**
 * Profile artifact directory name under CLI `--out-dir` (default = profile id).
 * @param {string} id
 * @param {unknown} rawName
 * @param {Array<{ code: string, message: string }>} diagnostics
 * @returns {string | null}
 */
export function normalizeProfileArtifactName(id, rawName, diagnostics) {
    const fallback = String(id || '').trim();
    if (rawName == null || rawName === '') return fallback || null;
    if (typeof rawName !== 'string') {
        diagnostics.push({
            code: 'delivery.profile.name',
            message: `profiles.${id}.name must be a string (got ${typeof rawName})`,
        });
        return null;
    }
    const name = rawName.trim();
    if (!name) {
        diagnostics.push({
            code: 'delivery.profile.name',
            message: `profiles.${id}.name must be a non-empty string`,
        });
        return null;
    }
    if (name === '.' || name === '..' || name.includes('/') || name.includes('\\') || name.includes('\0')) {
        diagnostics.push({
            code: 'delivery.profile.name',
            message: `profiles.${id}.name must be a single path segment under --out-dir (got '${name}')`,
        });
        return null;
    }
    return name;
}

/**
 * Workspace `--out-dir` + profile `name` → artifact root.
 * Always nests: `path.join(outDir, name)` where `name` defaults to profile id
 * (`name: 'cdn'` → `dist/cdn`; omit → `dist/static` for profile `static`).
 * @param {string} outDir
 * @param {{ name?: string, id?: string } | null | undefined} profile
 */
export function resolveProfileArtifactDir(outDir, profile) {
    const name = String(profile?.name || profile?.id || '').trim();
    if (!name) return outDir;
    return path.join(outDir, name);
}

function isPlainObject(v) {
    return v != null && typeof v === 'object' && !Array.isArray(v);
}

export function pickSiteAuthoring(raw) {
    if (!isPlainObject(raw)) return null;
    if (!Array.isArray(raw.sources) || raw.sources.length < 1) return null;
    if (typeof raw.artifact !== 'string' || !String(raw.artifact).trim()) return null;
    const site: SiteAuthoring = {
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

/**
 * `delivery.packaging.wechat` — vendor identity, not WeChat JSON / wx APIs.
 * @param {unknown} raw
 * @param {Array<{ code: string, message: string }>} diagnostics
 */
export function pickDeliveryPackaging(
    raw: unknown,
    diagnostics: Array<{ code: string; message: string }>,
): { wechat: WechatPackagingData } | null {
    if (!isPlainObject(raw) || (raw as { packaging?: unknown }).packaging == null) return null;
    const packagingRaw = (raw as { packaging: unknown }).packaging;
    if (!isPlainObject(packagingRaw)) {
        diagnostics.push({ code: 'delivery.packaging', message: 'delivery.packaging must be an object' });
        return null;
    }
    for (const key of Object.keys(packagingRaw)) {
        if (key !== 'wechat') {
            diagnostics.push({
                code: 'delivery.packaging.vendor',
                message: `delivery.packaging.${key} is not a known vendor (wechat)`,
            });
        }
    }
    const wechat = (packagingRaw as { wechat?: unknown }).wechat;
    if (wechat == null) return null;
    if (!isPlainObject(wechat)) {
        diagnostics.push({
            code: 'delivery.packaging.wechat',
            message: 'delivery.packaging.wechat must be an object',
        });
        return null;
    }
    const wechatObj = wechat as Record<string, unknown>;
    for (const [k, v] of Object.entries(wechatObj)) {
        if (typeof v === 'function') {
            diagnostics.push({
                code: 'delivery.packaging.executable',
                message: `delivery.packaging.wechat.${k} must be pure data (no functions)`,
            });
            continue;
        }
        if (k !== 'appId' && k !== 'projectName' && k !== 'title') {
            diagnostics.push({
                code: 'delivery.packaging.wechat.field',
                message: `delivery.packaging.wechat.${k} is not a known field (appId|projectName|title)`,
            });
        } else if (v != null && typeof v !== 'string') {
            diagnostics.push({
                code: 'delivery.packaging.wechat.type',
                message: `delivery.packaging.wechat.${k} must be a string`,
            });
        }
    }
    const out: WechatPackagingData = {};
    if (typeof wechatObj.appId === 'string' && wechatObj.appId.trim()) out.appId = wechatObj.appId.trim();
    if (typeof wechatObj.projectName === 'string' && wechatObj.projectName.trim()) {
        out.projectName = wechatObj.projectName.trim();
    }
    if (typeof wechatObj.title === 'string' && wechatObj.title.trim()) out.title = wechatObj.title.trim();
    return { wechat: out };
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
    let assembly = String(entry.assembly || '').trim();
    if (assembly === 'static-cdn') {
        diagnostics.push({
            code: 'delivery.profile.assembly.renamed',
            message: `profiles.${id}.assembly 'static-cdn' was renamed to 'web-static'`,
        });
        return null;
    }
    if (!ASSEMBLIES.includes(assembly)) {
        diagnostics.push({
            code: 'delivery.profile.assembly',
            message: `profiles.${id}.assembly must be one of ${ASSEMBLIES.join('|')} (got ${assembly || '(empty)'})`,
        });
        return null;
    }
    const nameExplicit = entry.name != null && String(entry.name).trim() !== '';
    const name = normalizeProfileArtifactName(id, nameExplicit ? entry.name : id, diagnostics);
    if (!name) return null;
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
        name,
        /** True when author set `profiles.<id>.name`; false → `name` defaulted to profile id. */
        nameExplicit,
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
        const table: DeliveryAuthoringTable = {
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
    } else if (isPlainObject(raw.packaging)) {
        defaultId = String(raw.default || 'web-ssr').trim() || 'web-ssr';
        profileInputs = { ...BUILTIN_PROFILES };
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

    const profiles: Record<string, unknown> = {};
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

    const packaging = pickDeliveryPackaging(raw, diagnostics);
    if (diagnostics.length) return { ok: false, diagnostics };

    const table: DeliveryAuthoringTable = {
        schema: DELIVERY_PROFILE_AUTHORING_SCHEMA,
        default: defaultId,
        profiles,
        sugar,
    };
    if (packaging) table.packaging = packaging;
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
    const selection: BuildProfileSelection = {
        schema: BUILD_PROFILE_SELECTION_SCHEMA,
        profileId: id,
        name: profile.name,
        nameExplicit: Boolean(profile.nameExplicit),
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
        case 'web-static':
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
