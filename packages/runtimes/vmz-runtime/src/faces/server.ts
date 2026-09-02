/**
 * Minimal VMZ runtime — `#server` invoke + RPC/REST HTTP + optional static/SSR.
 *
 * Browser-safe: no static `node:*` imports. Node builtins are loaded only inside
 * Node/SSR request handlers so client bundles can `import { callServer }`.
 */

import type { NodeRequestOptions, Route, RpcRequest, ServerModuleResolver } from '../shared/server.types.js';

const DEFAULT_RPC_PATH = '/__vmz/rpc';

let resolveServerModule: ServerModuleResolver | null = null;

let routes: Route[] = [];

/**
 * Map `#server/foo` �?filesystem / URL the host can `import`.
 * Only set this in Node/SSR hosts �?browser bundles must omit it so RPC goes HTTP.
 */
export function setServerModuleResolver(fn: ServerModuleResolver): void {
    resolveServerModule = fn;
}

export function setRoutes(next: Route[]): void {
    routes = Array.isArray(next) ? next : [];
}

export async function callServer(moduleId: string, method: string, args: unknown[] = []): Promise<unknown> {
    // Browser (or tests forcing HTTP): never touch server modules in-process.
    // Node SSR / smokes set a resolver and leave __VMZ_USE_HTTP_RPC unset �?local.
    if (globalThis.__VMZ_USE_HTTP_RPC || !resolveServerModule) {
        return callServerHttp(moduleId, method, args);
    }
    return callServerLocal(moduleId, method, args);
}

async function callServerLocal(moduleId, method, args) {
    if (!resolveServerModule) {
        throw new Error(`vmz:runtime callServer(${moduleId}): setServerModuleResolver() required in Node`);
    }
    const spec = resolveServerModule(moduleId);
    const mod = await import(typeof spec === 'string' ? spec : spec.href);
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

async function callServerHttp(moduleId, method, args) {
    let rpcPath = (typeof globalThis !== 'undefined' && globalThis.__VMZ_RPC_PATH) || DEFAULT_RPC_PATH;
    // Node undici `fetch` rejects relative URLs; browsers accept path-only.
    if (typeof rpcPath === 'string' && !/^https?:\/\//i.test(rpcPath)) {
        const origin =
            (typeof globalThis !== 'undefined' && globalThis.__VMZ_RPC_ORIGIN) ||
            (typeof window !== 'undefined' && window.location && window.location.origin) ||
            null;
        if (origin) {
            rpcPath = new URL(rpcPath, origin).href;
        } else if (typeof window === 'undefined') {
            const host = (typeof process !== 'undefined' && (process.env.VMZ_HOST || process.env.HOST)) || '127.0.0.1';
            const port = (typeof process !== 'undefined' && (process.env.VMZ_PORT || process.env.PORT)) || '5173';
            rpcPath = new URL(rpcPath, `http://${host}:${port}`).href;
        }
    }
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

export async function handleRpc(body) {
    return callServerLocal(body.moduleId, body.method, body.args ?? []);
}

/**
 * Match REST route from `vmz-routes.json`.
 */
export function matchRoute(verb, pathname) {
    const v = verb.toUpperCase();
    return routes.find((r) => r.verb.toUpperCase() === v && r.path === pathname) ?? null;
}

/**
 * Build `callServerLocal` args from a Fetch Request for REST routes.
 * GET/HEAD �?`[]`. JSON POST/PUT/PATCH �?`[body]`. form-urlencoded �?`[record]`.
 * Multipart �?`[record]` where File/Blob parts stay as File/Blob (tool-site binary upload).
 * Octet-stream PUT also forwards Upload resumable chunk headers (upload-id / chunk-index / chunk-total).
 * Extra args are ignored by zero-parameter server methods (JS).
 */
async function routeArgsFromRequest(request, verb) {
    const v = String(verb || 'GET').toUpperCase();
    if (v === 'GET' || v === 'HEAD' || v === 'OPTIONS') return [];
    const ctype = String(request.headers.get('content-type') || '');
    if (ctype.includes('application/json')) {
        const text = await request.text();
        if (!text || !String(text).trim()) return [{}];
        try {
            return [JSON.parse(text)];
        } catch (err) {
            throw new Error(`invalid JSON body: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    if (ctype.includes('multipart/form-data')) {
        // Parse from raw bytes �?undici Request.formData() can UTF-8-mangle high bytes in file parts
        // (0xFF/0xFE �?U+FFFD), which breaks Upload binary / tool-site intakes.
        const buf = Buffer.from(await request.arrayBuffer());
        return [parseMultipartBuffer(buf, ctype)];
    }
    // Object-store PUT / resumable chunk PUT �?keep bytes (never request.text()).
    if (
        ctype.includes('application/octet-stream') ||
        ((v === 'PUT' || v === 'PATCH') && !ctype.includes('json') && !ctype.includes('x-www-form-urlencoded'))
    ) {
        const buf = Buffer.from(await request.arrayBuffer());
        const key = String(request.headers.get('x-vmz-object-key') || '');
        const uploadId = String(request.headers.get('x-vmz-upload-id') || '');
        const chunkIndexRaw = request.headers.get('x-vmz-chunk-index');
        const chunkTotalRaw = request.headers.get('x-vmz-chunk-total');
        const chunkIndex = chunkIndexRaw != null && String(chunkIndexRaw).trim() !== '' ? Number(chunkIndexRaw) : undefined;
        const chunkTotal = chunkTotalRaw != null && String(chunkTotalRaw).trim() !== '' ? Number(chunkTotalRaw) : undefined;
        return [
            {
                bytes: buf,
                size: buf.byteLength,
                key,
                uploadId,
                chunkIndex: Number.isFinite(chunkIndex) ? chunkIndex : undefined,
                chunkTotal: Number.isFinite(chunkTotal) ? chunkTotal : undefined,
                contentType: ctype || 'application/octet-stream',
            },
        ];
    }
    const raw = await request.text();
    return [parseFormBody(raw, ctype)];
}

/**
 * Web Standards Fetch entry for ServerArtifact hosts (Node adapter, worker/edge parity).
 * Handles RPC + public ServerRoute only; static/SSR stay on Node host options.
 */
export async function handleFetchRequest(request) {
    const url = new URL(request.url);
    const verb = (request.method || 'GET').toUpperCase();
    try {
        if (verb === 'POST' && url.pathname === DEFAULT_RPC_PATH) {
            const body = await request.json();
            const result = await handleRpc(body);
            return Response.json(result);
        }

        const route = matchRoute(verb, url.pathname);
        if (route) {
            const args = await routeArgsFromRequest(request, verb);
            const result = await callServerLocal(route.moduleId, route.method, args);
            return Response.json(result);
        }

        return Response.json({ error: 'not found', path: url.pathname }, { status: 404 });
    } catch (err) {
        return Response.json(
            {
                error: err instanceof Error ? err.message : String(err),
            },
            { status: 500 },
        );
    }
}

/**
 * Node `http.createServer` listener: RPC + REST + optional static / SSR index.
 * RPC/REST go through {@link handleFetchRequest} so Node and Fetch hosts share one core.
 */
export async function handleNodeRequest(req, res, opts: any = {}) {
    const host = req.headers.host || '127.0.0.1';
    const url = new URL(req.url || '/', `http://${host}`);
    const verb = (req.method || 'GET').toUpperCase();

    try {
        const isRpc = verb === 'POST' && url.pathname === DEFAULT_RPC_PATH;
        const route = matchRoute(verb, url.pathname);
        if (isRpc || route) {
            const request = await incomingToRequest(req, url);
            const response = await handleFetchRequest(request);
            return await writeFetchResponse(res, response);
        }

        // Static first for assets + DocumentMount (`/d/�`) so docs aren't swallowed by SSR 404 shells.
        // static route HTML (`index.html`, `about/index.html`, �? is a CDN/deploy projection only �?        // when Server Host SSR is active, those files must not shadow live render (local/dev �?SSR truth).
        if (verb === 'GET' && opts.distDir) {
            const nodePath = await import('node:path');
            const { readFile, stat } = await import('node:fs/promises');
            const file = await resolveDistStatic(opts.distDir, url.pathname, nodePath, stat, {
                cookieHeader: String(req.headers.cookie || ''),
            });
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
            // Do not abort on IncomingMessage `close` �?that fires after a POST body is
            // fully read (normal), which would cancel SSR before the first chunk.
            req.on('aborted', onClientGone);
            res.on('close', () => {
                if (!res.writableEnded) onClientGone();
            });
            try {
                if (typeof opts.renderPageStream === 'function') {
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
            if (wantsBrowserHtml(req)) {
                sendHtml(res, 404, browserErrorHtml(404, 'Not Found', `No page matched ${url.pathname}`, undefined));
            } else {
                sendJson(res, 404, { error: 'not found', path: url.pathname });
            }
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
        const message = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : undefined;
        if (wantsBrowserHtml(req)) {
            sendHtml(res, 500, browserErrorHtml(500, 'Dev Error', message, stack));
        } else {
            sendJson(res, 500, { error: message });
        }
    }
}

async function incomingToRequest(req, url) {
    const method = (req.method || 'GET').toUpperCase();

    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
        if (v == null) continue;
        headers[k] = Array.isArray(v) ? v.join(', ') : String(v);
    }
    if (method === 'GET' || method === 'HEAD') {
        return new Request(url, { method, headers });
    }
    const raw = await readRawBody(req);
    // Node undici requires duplex when constructing Request with a body.
    return new Request(url, { method, headers, body: raw as BodyInit, duplex: 'half' } as RequestInit);
}

async function writeFetchResponse(res, response) {
    const headers = {};
    response.headers.forEach((value, key) => {
        headers[key] = value;
    });
    const buf = Buffer.from(await response.arrayBuffer());
    if (!headers['content-length'] && !headers['Content-Length']) {
        headers['content-length'] = String(buf.byteLength);
    }
    res.writeHead(response.status, headers);
    res.end(buf);
}

/**
 * Resolve a path under distDir; reject `..` escapes.
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
 * static profile emits per-route HTML beside client assets. That HTML is for CDN / local-static
 * delivery hosts �?not for Server Host when SSR is available. DocumentMount stays static.
 */
function isWebStaticHtmlShadow(file, pathname, nodePath) {
    const ext = nodePath.extname(file).toLowerCase();
    if (ext !== '.html' && ext !== '.htm') return false;
    let rel = decodeURIComponent(String(pathname || '').split('?')[0] || '/');
    if (!rel.startsWith('/')) rel = `/${rel}`;
    // Integrated DocumentMount �?keep static-first (see resolveDistStatic comment).
    if (rel === '/d' || rel.startsWith('/d/')) return false;
    return true;
}

/**
 * Static resolve for app assets + integrated document mounts:
 * `/d/` �?`d/index.html`, `/d/zh-hans/guide` �?`d/zh-hans/guide.html`.
 */
async function resolveDistStatic(distDir, pathname, nodePath, stat, _opts: { cookieHeader?: string } = {}) {
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

function staticPathCandidates(pathname) {
    let rel = decodeURIComponent(pathname.split('?')[0] || '/');
    if (!rel.startsWith('/')) rel = `/${rel}`;

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

function nodePathExt(p) {
    const base = p.split('/').pop() || '';
    const i = base.lastIndexOf('.');
    return i > 0 ? base.slice(i) : '';
}

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

function readRawBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        // Buffer �?never utf8-string: multipart File bytes must survive (Upload binary gate).
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

/**
 * Buffer-safe multipart/form-data parser (file parts stay binary).
 */
function parseMultipartBuffer(buf, contentType) {
    const bm = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(String(contentType || ''));
    const boundary = bm ? bm[1] || bm[2] : '';
    if (!boundary) {
        throw new Error('multipart: missing boundary');
    }
    const sep = Buffer.from(`--${boundary}`);

    const out = {};
    let start = indexOfBuffer(buf, sep, 0);
    if (start < 0) return out;
    start += sep.length;
    // Optional leading CRLF after first boundary is handled per-part.
    while (start < buf.length) {
        if (buf[start] === 0x2d && buf[start + 1] === 0x2d) break; // trailing --
        if (buf[start] === 0x0d && buf[start + 1] === 0x0a) start += 2;
        const next = indexOfBuffer(buf, sep, start);
        const end = next < 0 ? buf.length : next;
        let part = buf.subarray(start, end);
        // Trim trailing CRLF before boundary.
        if (part.length >= 2 && part[part.length - 2] === 0x0d && part[part.length - 1] === 0x0a) {
            part = part.subarray(0, part.length - 2);
        }
        const splitAt = indexOfBuffer(part, Buffer.from('\r\n\r\n'), 0);
        if (splitAt >= 0) {
            const headerText = part.subarray(0, splitAt).toString('utf8');
            const body = part.subarray(splitAt + 4);
            const nameM = /content-disposition:[^\r\n]*;\s*name="([^"]*)"/i.exec(headerText);
            const fileM = /content-disposition:[^\r\n]*;\s*filename="([^"]*)"/i.exec(headerText);
            const typeM = /content-type:\s*([^\r\n]+)/i.exec(headerText);
            const key = nameM ? nameM[1] : '';
            if (key) {
                if (fileM) {
                    const filename = fileM[1] || 'upload.bin';
                    const type = typeM ? String(typeM[1]).trim() : 'application/octet-stream';
                    // Copy body �?File may outlive the request buffer.
                    const copy = Buffer.from(body);
                    const file = new File([copy], filename, { type });
                    const prev = out[key];
                    if (prev == null) {
                        out[key] = file;
                    } else if (Array.isArray(prev)) {
                        prev.push(file);
                    } else {
                        out[key] = [prev, file];
                    }
                } else {
                    out[key] = body.toString('utf8');
                }
            }
        }
        if (next < 0) break;
        start = next + sep.length;
    }
    return out;
}

function indexOfBuffer(hay, needle, from) {
    if (!needle.length) return from;
    outer: for (let i = Math.max(0, from); i <= hay.length - needle.length; i++) {
        for (let j = 0; j < needle.length; j++) {
            if (hay[i + j] !== needle[j]) continue outer;
        }
        return i;
    }
    return -1;
}

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

function wantsBrowserHtml(req) {
    const accept = String(req.headers?.accept || '');
    const method = String(req.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') return false;

    // Document navigations: browsers send text/html and/or Sec-Fetch-Dest: document.
    // Bare `*/*` / empty Accept (Node fetch, many API clients) must stay JSON.
    const dest = String(req.headers?.['sec-fetch-dest'] || '');
    const mode = String(req.headers?.['sec-fetch-mode'] || '');
    if (dest === 'document' || mode === 'navigate') return true;

    if (!accept || accept === '*/*') return false;

    const html = accept.includes('text/html');
    const json = accept.includes('application/json');
    if (html && !json) return true;
    if (html && json) {
        const hi = accept.indexOf('text/html');
        const ji = accept.indexOf('application/json');
        return hi <= ji;
    }
    return false;
}

/**
 * Browser-facing error document (no N-API). Used when SSR returns null or throws
 * on a document navigation �?must not fall back to API-shaped JSON.
 */
function browserErrorHtml(status, title, message, stack) {
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const stackBlock = stack ? `<pre class="stack">${esc(stack)}</pre>` : '';
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <style>
    body{margin:0;background:#0f1115;color:#f4f4f5;font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
    main{max-width:56rem;margin:0 auto;padding:2rem 1.25rem}
    h1{margin:0 0 .75rem;color:#f87171;font-size:1.1rem}
    .code{opacity:.65;font-size:12px;margin-bottom:.75rem}
    pre{white-space:pre-wrap;margin:0 0 1rem}
    .stack{opacity:.7;font-size:12px}
    .hint{opacity:.65;font-size:12px}
  </style>
</head>
<body data-vmz-error="${status}">
  <main>
    <p class="code">HTTP ${status}</p>
    <h1>${esc(title)}</h1>
    <pre>${esc(message)}</pre>
    ${stackBlock}
    <p class="hint">Document navigation returns HTML errors �?not API JSON.</p>
  </main>
</body>
</html>
`;
}

function sendJson(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(payload),
    });
    res.end(payload);
}

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
 */
async function sendHtmlStream(res, status, source, signal) {
    const aborted = () => Boolean(signal?.aborted || res.destroyed || res.writableEnded || !res.writable);
    const headers = {
        'content-type': 'text/html; charset=utf-8',
        'transfer-encoding': 'chunked',
        'cache-control': 'no-cache',
    };
    // Defer writeHead until the first successful chunk so SSR throw �?clean 500
    // (not headersSent + destroy �?ERR_EMPTY_RESPONSE).
    let started = false;
    try {
        for await (const chunk of source) {
            if (aborted()) break;
            if (chunk == null || chunk === '') continue;
            const s = typeof chunk === 'string' ? chunk : String(chunk);
            if (!started) {
                res.writeHead(status, headers);
                started = true;
            }
            const ok = res.write(s);
            if (!ok) {
                await Promise.race([
                    new Promise<void>((resolve) => res.once('drain', resolve)),
                    new Promise<void>((resolve) => {
                        if (!signal) return;
                        if (signal.aborted) return resolve();
                        signal.addEventListener('abort', () => resolve(), { once: true });
                    }),
                    new Promise<void>((resolve) => res.once('close', resolve)),
                ]);
                if (aborted()) break;
            }
        }
        if (!started && !aborted()) {
            res.writeHead(status, headers);
            started = true;
        }
    } catch (err) {
        if (aborted()) return;
        // Before headers: let outer handler sendJson(500). After headers: rethrow �?destroy.
        throw err;
    }
    if (started && !res.writableEnded && !res.destroyed) {
        res.end();
    }
}

function sendBytes(res, status, body, type) {
    const headers = {
        'content-type': type,
        'content-length': body.byteLength,
    };
    // Dev: stylesheets are rebuilt in-place �?never cache @import siblings (VMZ-8).
    if (process.env.VMZ_DEV === '1' && typeof type === 'string' && type.startsWith('text/css')) {
        headers['cache-control'] = 'no-store';
    }
    res.writeHead(status, headers);
    res.end(body);
}
