/**
 * VMZ-owned deterministic Mini Host (TemplateSurface).
 * Interprets MiniProgramArtifact tables — not vendor runtime, not WXML.
 */

/**
 * @typedef {object} MiniDeployPackage
 * @property {string} schema
 * @property {string} [platformId]
 * @property {object} [host]
 * @property {object} [vendorTooling]
 * @property {object} [constraints]
 * @property {Array<{chunkId?: string, artifactPath?: string}>} [artifacts]
 * @property {Array<{routeId?: string, chunkId?: string}>} [pages]
 * @property {Array<{routeId?: string, fromChunkId?: string}>} [routeLinks]
 * @property {Array<{method?: string, chunkId?: string}>} [serverCapabilities]
 */

/**
 * @typedef {object} MiniPageArtifact
 * @property {string} [template]
 * @property {string} [logic]
 * @property {string} [eventTable]
 * @property {string} [dataPatchTable]
 * @property {string} [manifest]
 * @property {string} [style]
 * @property {string} [platformId]
 */

/**
 * @param {unknown} value
 * @returns {any}
 */
function parseMaybeJson(value) {
    if (value == null) return null;
    if (typeof value === 'object') return value;
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        } catch {
            return null;
        }
    }
    return null;
}

/**
 * @param {string} path
 * @param {Record<string, unknown>} data
 * @param {unknown} value
 */
function setDataPath(path, data, value) {
    const parts = String(path).split('.').filter(Boolean);
    if (!parts.length) return;
    /** @type {any} */
    let cur = data;
    for (let i = 0; i < parts.length - 1; i++) {
        const key = parts[i];
        if (cur[key] == null || typeof cur[key] !== 'object') cur[key] = {};
        cur = cur[key];
    }
    cur[parts[parts.length - 1]] = value;
}

/**
 * Create a deterministic Mini Host over a deploy package + on-disk artifacts.
 * @param {object} opts
 * @param {MiniDeployPackage} opts.package
 * @param {(artifactPath: string) => MiniPageArtifact} opts.loadArtifact
 */
export function createMiniHost(opts) {
    const pkg = opts.package;
    if (!pkg || pkg.schema !== 'vmz.mini.deploy_package.v0') {
        throw new Error(`createMiniHost: expected vmz.mini.deploy_package.v0, got ${pkg?.schema}`);
    }
    if (pkg.constraints?.wxmlEmitter === true || pkg.constraints?.wxssEmitter === true) {
        throw new Error('createMiniHost: package must not claim WXML/WXSS emitter');
    }
    if (pkg.constraints?.serverImplInMiniPackage === true) {
        throw new Error('createMiniHost: server impl must not ship in mini package');
    }
    if (pkg.host?.schema !== 'vmz.mini.host.v0' || pkg.host?.kind !== 'deterministic-interpreter') {
        throw new Error(`createMiniHost: invalid host descriptor ${JSON.stringify(pkg.host)}`);
    }
    if (pkg.vendorTooling?.role !== 'transport-conformance') {
        throw new Error('createMiniHost: vendor tooling must stay transport-conformance');
    }
    if (pkg.vendorTooling?.invokedInCi !== false) {
        throw new Error('createMiniHost: vendor tooling must not be invoked in CI gate');
    }

    /** @type {string | null} */
    let currentChunkId = null;
    /** @type {MiniPageArtifact | null} */
    let currentArt = null;
    /** @type {Record<string, unknown>} */
    let data = {};
    /** @type {string[]} */
    const appliedPatches = [];
    /** @type {Array<{method: string, scheme: string}>} */
    const serverCalls = [];
    /** @type {string[]} */
    const navigations = [];
    /** @type {string[]} */
    const lifecycle = [];

    function resolveArtifact(chunkId) {
        const row = (pkg.artifacts || []).find((a) => a.chunkId === chunkId);
        if (!row?.artifactPath) {
            throw new Error(`createMiniHost: unknown chunk ${chunkId}`);
        }
        return opts.loadArtifact(row.artifactPath);
    }

    return {
        package: pkg,

        /** @param {string} [chunkId] */
        mount(chunkId) {
            const pages = pkg.pages || [];
            const home = pages.find((p) => p.routeId === 'IndexPage' || String(p.chunkId || '').includes('pages/index')) || pages[0];
            const pick = chunkId || home?.chunkId || pkg.artifacts?.[0]?.chunkId;
            if (!pick) throw new Error('createMiniHost.mount: no page chunk');
            currentArt = resolveArtifact(pick);
            currentChunkId = pick;
            const logic = parseMaybeJson(currentArt.logic) || {};
            data = structuredClone(logic.initialData || {});
            lifecycle.push('mount');
            return { chunkId: pick, data };
        },

        /** @param {string} handlerId */
        dispatchEvent(handlerId) {
            if (!currentArt) throw new Error('createMiniHost.dispatchEvent: not mounted');
            const events = parseMaybeJson(currentArt.eventTable);
            if (!events || events.schema !== 'vmz.mini.event_table.v0') {
                throw new Error('createMiniHost: missing event_table');
            }
            const handler = (events.handlers || []).find((h) => h.handlerId === handlerId);
            if (!handler) throw new Error(`createMiniHost: unknown handler ${handlerId}`);
            const stamp = `patched:${handler.method || handlerId}`;
            for (const p of handler.patchPaths || []) {
                setDataPath(p, data, stamp);
                appliedPatches.push(p);
            }
            lifecycle.push(`event:${handlerId}`);
            return {
                handlerId,
                method: handler.method,
                patchPaths: [...(handler.patchPaths || [])],
                data,
            };
        },

        /** @param {string} routeId */
        navigate(routeId) {
            const pages = pkg.pages || [];
            const hit = pages.find((p) => p.routeId === routeId) || pages.find((p) => String(p.chunkId || '').includes(routeId));
            if (!hit?.chunkId) {
                throw new Error(`createMiniHost.navigate: unknown RouteId ${routeId}`);
            }
            const links = pkg.routeLinks || [];
            const linked = !links.length || links.some((l) => l.routeId === routeId) || String(currentChunkId || '') === hit.chunkId;
            if (!linked && currentChunkId) {
                // Allow workspace-level pages even without a Link from current page.
            }
            currentArt = resolveArtifact(hit.chunkId);
            currentChunkId = hit.chunkId;
            const logic = parseMaybeJson(currentArt.logic) || {};
            data = structuredClone(logic.initialData || {});
            navigations.push(routeId);
            lifecycle.push(`navigate:${routeId}`);
            return { routeId, chunkId: hit.chunkId, data };
        },

        /** @param {string} method */
        callServerStub(method) {
            const caps = pkg.serverCapabilities || [];
            const hit = caps.find((c) => c.method === method);
            if (!hit) throw new Error(`createMiniHost.callServerStub: unknown ${method}`);
            if (pkg.constraints?.serverImplInMiniPackage !== false) {
                throw new Error('createMiniHost: server impl leaked into mini package');
            }
            serverCalls.push({ method, scheme: '#server' });
            lifecycle.push(`server-stub:${method}`);
            return {
                method,
                scheme: '#server',
                transport: 'mini-request',
                pending: true,
                bodyShipped: false,
            };
        },

        getState() {
            return {
                chunkId: currentChunkId,
                data: structuredClone(data),
                appliedPatches: [...appliedPatches],
                navigations: [...navigations],
                serverCalls: [...serverCalls],
                lifecycle: [...lifecycle],
            };
        },
    };
}
