// @ts-nocheck
/**
 * Minimal VMZ runtime — `#server` invoke + RPC/REST HTTP + optional static/SSR.
 *
 *
 * Browser-safe: no static `node:*` imports. Node builtins are loaded only inside
 * Node/SSR request handlers so client bundles can `import { callServer }`.
 */

/** @typedef {{ moduleId: string, method: string, args?: unknown[] }} RpcRequest */
/** @typedef {{ verb: string, path: string, moduleId: string, method: string, className?: string }} Route */
/**
 * @typedef {{
 * distDir?: string,
 * renderIndex?: => Promise<string> | string,
 * renderIndexStream?: (opts?: { signal?: AbortSignal }) => AsyncIterable<string>,
 * renderPage?: (pathname: string) => Promise<string | null> | string | null,
 * renderPageStream?: (pathname: string, opts?: { signal?: AbortSignal, searchParams?: URLSearchParams, cookieHeader?: string, method?: string, body?: unknown }) => Promise<AsyncIterable<string> | { status?: number, stream?: AsyncIterable<string>, redirect?: string, headers?: Record<string, string> } | null> | AsyncIterable<string> | null,
 * req?: import('node:http').IncomingMessage,
 * }} NodeRequestOptions
 */

const DEFAULT_RPC_PATH = '/__vmz/rpc';

/** @type {((id: string) => string | URL) | null} */
let resolveServerModule = null;

/** @type {Route[]} */
let routes = [];

/**
 * Map `#server/foo` → filesystem / URL the host can `import`.
 * Only set this in Node/SSR hosts — browser bundles must omit it so RPC goes HTTP.
 */
export function setServerModuleResolver(fn) {
    resolveServerModule = fn;
}

/** @param {Route[]} next */
export function setRoutes(next) {
    routes = Array.isArray(next) ? next : [];
}

/**
 * @param {string} moduleId
 * @param {string} method
 * @param {unknown[]} args
 */
export async function callServer(moduleId, method, args = []) {
    // Browser (or tests forcing HTTP): never touch server modules in-process.
    // Node SSR / smokes set a resolver and leave __VMZ_USE_HTTP_RPC unset → local.
    if (globalThis.__VMZ_USE_HTTP_RPC || !resolveServerModule) {
        return callServerHttp(moduleId, method, args);
    }
    return callServerLocal(moduleId, method, args);
}

/**
 * @param {string} moduleId
 * @param {string} method
 * @param {unknown[]} args
 */
async function callServerLocal(moduleId, method, args) {
    if (!resolveServerModule) {
        throw new Error(`vmz:runtime callServer(${moduleId}): setServerModuleResolver() required in Node`);
    }
    const spec = resolveServerModule(moduleId);
    const mod = await import(spec);
    const Ctor = mod.default ?? mod[exportGuess(moduleId)];
    if (typeof Ctor !== 'function') {
        throw new Error(`vmz:runtime: no class export for ${moduleId}`);
    }
    const instance = new Ctor();
    const fn = instance[method];
    if (typeof fn !== 'function') {
        throw new Error(`vmz:runtime: ${moduleId}.${method} is not a function`);
    }
    return fn.apply(instance, args);
}

/**
 * @param {string} moduleId
 * @param {string} method
 * @param {unknown[]} args
 */
async function callServerHttp(moduleId, method, args) {
    const rpcPath = (typeof globalThis !== 'undefined' && globalThis.__VMZ_RPC_PATH) || DEFAULT_RPC_PATH;
    const res = await fetch(rpcPath, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ moduleId, method, args }),
    });
    if (!res.ok) {
        throw new Error(`vmz:runtime RPC ${res.status} for ${moduleId}.${method}`);
    }
    return res.json();
}

function exportGuess(moduleId) {
    const base = moduleId.split('/').pop() || 'Server';
    return `${base}Server`;
}

/**
 * @param {RpcRequest} body
 */
export async function handleRpc(body) {
    return callServerLocal(body.moduleId, body.method, body.args ?? []);
}

/**
 * Match REST route from `vmz-routes.json`.
 * @param {string} verb
 * @param {string} pathname
 * @returns {Route | null}
 */
export function matchRoute(verb, pathname) {
    const v = verb.toUpperCase();
    return routes.find((r) => r.verb.toUpperCase() === v && r.path === pathname) ?? null;
}

/**
 * Node `http.createServer` listener: RPC + REST + optional static / SSR index.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {NodeRequestOptions} [opts]
 */
export async function handleNodeRequest(req, res, opts = {}) {
    const host = req.headers.host || '127.0.0.1';
    const url = new URL(req.url || '/', `http://${host}`);
    const verb = (req.method || 'GET').toUpperCase();

    try {
        if (verb === 'POST' && url.pathname === DEFAULT_RPC_PATH) {
            const body = await readJson(req);
            const result = await handleRpc(body);
            return sendJson(res, 200, result);
        }

        const route = matchRoute(verb, url.pathname);
        if (route) {
            const result = await callServerLocal(route.moduleId, route.method, []);
            return sendJson(res, 200, result);
        }

        // Static first for assets + DocumentMount (`/d/…`) so docs aren't swallowed by SSR 404 shells.
        // web-static route HTML (`index.html`, `about/index.html`, …) is a CDN/deploy projection only —
        // when Server Host SSR is active, those files must not shadow live render (local/dev ≡ SSR truth).
        if (verb === 'GET' && opts.distDir) {
            const nodePath = await import('node:path');
            const { readFile, stat } = await import('node:fs/promises');
            const file = await resolveDistStatic(opts.distDir, url.pathname, nodePath, stat);
            const hasSsr =
                typeof opts.renderPageStream === 'function' ||
                typeof opts.renderPage === 'function' ||
                typeof opts.renderIndexStream === 'function' ||
                typeof opts.renderIndex === 'function';
            if (file && !(hasSsr && isWebStaticHtmlShadow(file, url.pathname, nodePath))) {
                try {
                    const body = await readFile(file);
                    return sendBytes(res, 200, body, contentType(file, nodePath));
                } catch (err) {
                    if (err && (err.code === 'ENOENT' || err.code === 'EISDIR')) {
                        /* fall through */
                    } else {
                        throw err;
                    }
                }
            }
        }

        if ((verb === 'GET' || verb === 'POST') && (opts.renderPageStream || opts.renderPage || opts.renderIndexStream || opts.renderIndex)) {
            const ac = new AbortController();
            const onClientGone = () => {
                try {
                    ac.abort();
                } catch {
                    /* ignore */
                }
            };
            // Do not abort on IncomingMessage `close` — that fires after a POST body is
            // fully read (normal), which would cancel SSR before the first chunk.
            req.on('aborted', onClientGone);
            res.on('close', () => {
                if (!res.writableEnded) onClientGone();
            });
            try {
                if (typeof opts.renderPageStream === 'function') {
                    /** @type {unknown} */
                    let body;
                    if (verb === 'POST') {
                        const ctype = String(req.headers['content-type'] || '');
                        if (ctype.includes('application/json')) {
                            body = await readJson(req);
                        } else {
                            const raw = await readRawBody(req);
                            body = parseFormBody(raw, ctype);
                        }
                    }
                    const rendered = await opts.renderPageStream(url.pathname, {
                        signal: ac.signal,
                        searchParams: url.searchParams,
                        cookieHeader: String(req.headers.cookie || ''),
                        method: verb,
                        body,
                    });
                    if (rendered) {
                        if (typeof rendered === 'object' && rendered.redirect) {
                            const status = Number(rendered.status) || 302;
                            const headers = {
                                Location: String(rendered.redirect),
                                ...(rendered.headers && typeof rendered.headers === 'object' ? rendered.headers : {}),
                            };
                            res.writeHead(status, headers);
                            res.end();
                            return;
                        }
                        const status = rendered && typeof rendered === 'object' && 'status' in rendered ? Number(rendered.status) || 200 : 200;
                        const stream = rendered && typeof rendered === 'object' && rendered.stream ? rendered.stream : rendered;
                        return await sendHtmlStream(res, status, stream, ac.signal);
                    }
                } else if (verb === 'GET' && typeof opts.renderPage === 'function') {
                    const html = await opts.renderPage(url.pathname);
                    if (html != null) {
                        return sendHtml(res, 200, html);
                    }
                } else if (verb === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
                    // Legacy index-only SSR (pre multi-page file routes).
                    if (typeof opts.renderIndexStream === 'function') {
                        return await sendHtmlStream(res, 200, opts.renderIndexStream({ signal: ac.signal }), ac.signal);
                    }
                    if (typeof opts.renderIndex === 'function') {
                        return sendHtml(res, 200, await opts.renderIndex());
                    }
                }
            } finally {
                req.off('aborted', onClientGone);
            }
        }

        if (!res.headersSent) {
            sendJson(res, 404, { error: 'not found', path: url.pathname });
        }
    } catch (err) {
        if (res.headersSent || res.writableEnded || res.destroyed) {
            console.error('vmz serve: request failed after headers', err);
            try {
                res.destroy(err instanceof Error ? err : undefined);
            } catch {
                /* ignore */
            }
            return;
        }
        sendJson(res, 500, {
            error: err instanceof Error ? err.message : String(err),
        });
    }
}

/**
 * Resolve a path under distDir; reject `..` escapes.
 * @param {string} distDir
 * @param {string} pathname
 * @param {typeof import('node:path')} nodePath
 * @returns {string | null}
 */
function safeDistFile(distDir, pathname, nodePath) {
    let rel = decodeURIComponent(pathname.split('?')[0] || '/');
    if (rel === '/' || rel === '') return null;
    if (rel.startsWith('/')) rel = rel.slice(1);
    if (!rel || rel.includes('\0')) return null;
    const root = nodePath.resolve(distDir);
    const full = nodePath.resolve(root, rel);
    if (full !== root && !full.startsWith(root + nodePath.sep)) return null;
    return full;
}

/**
 * web-static emits per-route HTML beside client assets. That HTML is for CDN / local-static
 * delivery hosts — not for Server Host when SSR is available. DocumentMount stays static.
 * @param {string} file
 * @param {string} pathname
 * @param {typeof import('node:path')} nodePath
 */
function isWebStaticHtmlShadow(file, pathname, nodePath) {
    const ext = nodePath.extname(file).toLowerCase();
    if (ext !== '.html' && ext !== '.htm') return false;
    let rel = decodeURIComponent(String(pathname || '').split('?')[0] || '/');
    if (!rel.startsWith('/')) rel = `/${rel}`;
    // Integrated DocumentMount — keep static-first (see resolveDistStatic comment).
    if (rel === '/d' || rel.startsWith('/d/')) return false;
    return true;
}

/**
 * Static resolve for app assets + integrated document mounts:
 * `/d/` → `d/index.html`, `/d/zh-hans/guide` → `d/zh-hans/guide.html`.
 * @param {string} distDir
 * @param {string} pathname
 * @param {typeof import('node:path')} nodePath
 * @param {typeof import('node:fs/promises').stat} stat
 * @returns {Promise<string | null>}
 */
async function resolveDistStatic(distDir, pathname, nodePath, stat) {
    const candidates = staticPathCandidates(pathname);
    for (const candidate of candidates) {
        const full = safeDistFile(distDir, candidate, nodePath);
        if (!full) continue;
        try {
            const st = await stat(full);
            if (st.isFile()) return full;
            if (st.isDirectory()) {
                const index = nodePath.join(full, 'index.html');
                const indexSt = await stat(index).catch(() => null);
                if (indexSt && indexSt.isFile()) return index;
            }
        } catch {
            /* try next */
        }
    }
    return null;
}

/**
 * @param {string} pathname
 * @returns {string[]}
 */
function staticPathCandidates(pathname) {
    let rel = decodeURIComponent(pathname.split('?')[0] || '/');
    if (!rel.startsWith('/')) rel = `/${rel}`;
    /** @type {string[]} */
    const out = [];
    const push = (p) => {
        if (p && !out.includes(p)) out.push(p);
    };
    push(rel);
    if (rel.endsWith('/')) {
        push(`${rel}index.html`);
        const trimmed = rel.replace(/\/+$/, '');
        if (trimmed) {
            push(`${trimmed}.html`);
            push(trimmed);
        }
    } else {
        push(`${rel}/`);
        push(`${rel}/index.html`);
        if (!nodePathExt(rel)) {
            push(`${rel}.html`);
        }
    }
    return out;
}

/** @param {string} p */
function nodePathExt(p) {
    const base = p.split('/').pop() || '';
    const i = base.lastIndexOf('.');
    return i > 0 ? base.slice(i) : '';
}

/**
 * @param {string} filePath
 * @param {typeof import('node:path')} nodePath
 */
function contentType(filePath, nodePath) {
    const ext = nodePath.extname(filePath).toLowerCase();
    switch (ext) {
        case '.html':
            return 'text/html; charset=utf-8';
        case '.js':
        case '.mjs':
            return 'text/javascript; charset=utf-8';
        case '.css':
            return 'text/css; charset=utf-8';
        case '.json':
            return 'application/json; charset=utf-8';
        case '.svg':
            return 'image/svg+xml';
        case '.map':
            return 'application/json; charset=utf-8';
        default:
            return 'application/octet-stream';
    }
}

/**
 * @param {import('node:http').IncomingMessage} req
 */
function readJson(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
            try {
                const raw = Buffer.concat(chunks).toString('utf8') || '{}';
                resolve(JSON.parse(raw));
            } catch (e) {
                reject(e);
            }
        });
        req.on('error', reject);
    });
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<string>}
 */
function readRawBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

/**
 * @param {string} raw
 * @param {string} contentType
 * @returns {Record<string, string> | string}
 */
function parseFormBody(raw, contentType) {
    if (!raw) return {};
    if (contentType.includes('application/x-www-form-urlencoded')) {
        const out = {};
        for (const [k, v] of new URLSearchParams(raw)) out[k] = v;
        return out;
    }
    try {
        return JSON.parse(raw);
    } catch {
        return { raw };
    }
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
function sendJson(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(payload),
    });
    res.end(payload);
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {string} html
 */
function sendHtml(res, status, html) {
    const payload = typeof html === 'string' ? html : String(html);
    res.writeHead(status, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': Buffer.byteLength(payload),
    });
    res.end(payload);
}

/**
 * Stream HTML without buffering the full document (event-flow / stream SSR host).
 * Honors AbortSignal + response destroy for cancel; awaits drain for backpressure.
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {AsyncIterable<string> | Iterable<string> | AsyncGenerator<string, any, any>} source
 * @param {AbortSignal} [signal]
 */
async function sendHtmlStream(res, status, source, signal) {
    res.writeHead(status, {
        'content-type': 'text/html; charset=utf-8',
        'transfer-encoding': 'chunked',
        'cache-control': 'no-cache',
    });
    const aborted = () => Boolean(signal?.aborted || res.destroyed || res.writableEnded || !res.writable);
    try {
        for await (const chunk of source) {
            if (aborted()) break;
            if (chunk == null || chunk === '') continue;
            const s = typeof chunk === 'string' ? chunk : String(chunk);
            const ok = res.write(s);
            if (!ok) {
                await Promise.race([
                    new Promise((resolve) => res.once('drain', resolve)),
                    new Promise((resolve) => {
                        if (!signal) return;
                        if (signal.aborted) return resolve();
                        signal.addEventListener('abort', () => resolve(), { once: true });
                    }),
                    new Promise((resolve) => res.once('close', resolve)),
                ]);
                if (aborted()) break;
            }
        }
    } catch (err) {
        if (!aborted()) throw err;
    }
    if (!res.writableEnded && !res.destroyed) {
        res.end();
    }
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {Buffer} body
 * @param {string} type
 */
function sendBytes(res, status, body, type) {
    res.writeHead(status, {
        'content-type': type,
        'content-length': body.byteLength,
    });
    res.end(body);
}
