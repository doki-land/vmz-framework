// @ts-nocheck
/**
 * Generic VMZ Node host — SSR file-route pages + dist static + RPC/REST.
 *
 * Invoked by `vmz serve` / `vmz dev` (or: node dist/vmz-serve-host.mjs).
 *
 * Pathname → `pages/**` (PascalCase stem → lowercase URL; `index` → parent;
 * `[Param]` / `[...rest]` dynamic). Not an SPA shell.
 *
 * `VMZ_DEV=1`: POST `/__vmz/reload` soft-reloads modules (cache-bust import);
 * GET `/__vmz/events` SSE notifies the browser:
 * - island HMR → re-import `entry-client.js` (no full document reload)
 * - otherwise → `location.reload`
 */

import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerComponents, renderToStream, renderToString } from './vmz-dom.js';
import { handleNodeRequest, setRoutes, setServerModuleResolver } from './vmz-runtime.js';

const distDir = process.env.VMZ_DIST ? path.resolve(process.env.VMZ_DIST) : path.dirname(fileURLToPath(import.meta.url));

const host = process.env.VMZ_HOST || '127.0.0.1';
const port = Number(process.env.VMZ_PORT || process.env.PORT || 5173);
const isDev = process.env.VMZ_DEV === '1' || process.env.VMZ_DEV === 'true';

/** @type {number} */
let reloadToken = Date.now();
/** @type {Array<{ chunkId: string, pageRel: string, segs: ReturnType<typeof parseChunkSegments> }>} */
let pageCatalog = [];
/** @type {Map<string, any>} */
const pageCtors = new Map();
/** Stylesheet from deployment `cssEntry` (e.g. vmz.css). */
let cssEntry = null;
/** @type {{ defaultThemeId: string, themeIds: string[], activationAttr: string, contentHash: string|null } | null} */
let styleTheme = null;
/** Locale route realization artifact from `_vmz/locale-route-realization.json` (optional). */
let localeArtifact = null;
/** @type {Set<import('node:http').ServerResponse>} */
const sseClients = new Set();
/** In-flight HTTP requests (graceful shutdown drain). */
let inFlight = 0;
/** When true, refuse new work except health. */
let shuttingDown = false;
let ready = false;
/** @type {{ message: string, stack?: string, at: number } | null} */
let lastDevError = null;

setServerModuleResolver((moduleId) => {
    const rel = moduleId.replace(/^#server\//, '') + '.js';
    return bustUrl(pathToFileURL(path.join(distDir, '#server', rel)).href);
});

try {
    await softReload({ quiet: true });
    ready = true;
} catch (err) {
    lastDevError = normalizeDevError(err);
    ready = true; // still accept HTTP — serve error page / recover on next reload
    console.error('vmz serve: initial load failed (dev host stays up)', lastDevError.message);
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<string>}
 */
function readRequestBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

/**
 * @param {string} pathname
 * @returns {Promise<string | null>}
 */
async function renderPage(pathname, opts = {}) {
    const rendered = await renderPageStream(pathname, opts);
    if (!rendered) return null;
    const stream = rendered.stream ?? rendered;
    let html = '';
    for await (const chunk of stream) {
        html += chunk;
    }
    return html;
}

/**
 * Stream shell + Direct serialize body for the matched file-route page.
 * Runs Page.access (closed allow/redirect/not-found/deny) before load;
 * POST may run Page.action before re-render.
 * @param {string} pathname
 * @param {{ signal?: AbortSignal, searchParams?: URLSearchParams, cookieHeader?: string, method?: string, body?: unknown }} [opts]
 * @returns {Promise<{ status: number, stream?: AsyncGenerator<string, void, void>, redirect?: string, headers?: Record<string, string> } | null>}
 */
async function renderPageStream(pathname, opts = {}) {
    if (isDev && lastDevError && pageCtors.size === 0) {
        return { status: 500, stream: emitDevErrorHtml(lastDevError) };
    }

    const localePlan = resolveLocalePath(pathname);
    if (localePlan.redirectTo) {
        return { status: 302, redirect: localePlan.redirectTo, headers: { Location: localePlan.redirectTo } };
    }
    const routePath = localePlan.restPath || pathname;

    let match = matchFileRoute(routePath, pageCatalog);
    let status = 200;

    const gated = await runRouteGate(routePath, match?.chunkId);
    if (gated === 'not_found') {
        match = findRootCatchAll(pageCatalog);
        status = 404;
    } else if (!match) {
        match = findRootCatchAll(pageCatalog);
        status = 404;
    } else if (isRootCatchAll(match)) {
        status = 404;
    }

    if (!match) {
        if (isDev && lastDevError) {
            return { status: 500, stream: emitDevErrorHtml(lastDevError) };
        }
        return null;
    }
    const Page = await loadPageCtor(match.chunkId);
    if (!Page) {
        if (isDev && lastDevError) {
            return { status: 500, stream: emitDevErrorHtml(lastDevError) };
        }
        return null;
    }
    const params = extractRouteParams(match.segs, routePath);
    const method = String(opts.method || 'GET').toUpperCase();
    const localeCtx = {
        localeId: localePlan.localeId,
        dir: localePlan.dir,
        pathname,
        routePath,
        alternates: pageMetaAlternates(match.chunkId, localePlan.localeId),
    };

    if (typeof Page.access === 'function') {
        const access = await Page.access({
            params,
            pathname: routePath,
            chunkId: match.chunkId,
            signal: opts.signal,
            searchParams: opts.searchParams,
            method,
            localeId: localeCtx.localeId,
        });
        const closed = normalizeAccessResult(access);
        if (closed.kind === 'redirect') {
            return { status: 302, redirect: closed.location, headers: { Location: closed.location } };
        }
        if (closed.kind === 'deny') {
            return { status: 403, stream: emitAccessShell('route-access-deny') };
        }
        if (closed.kind === 'not-found') {
            const catchAll = findRootCatchAll(pageCatalog);
            if (catchAll) {
                const NotFound = await loadPageCtor(catchAll.chunkId);
                if (NotFound) {
                    const resumeEntries = await loadPageResumeEntries(distDir, catchAll.chunkId);
                    const eventOnlyShell = isEventOnlyShell(resumeEntries.map((e) => e.strategy));
                    return {
                        status: 404,
                        stream: emitPageHtml(NotFound, catchAll.chunkId, eventOnlyShell, { ...params }, opts, [], localeCtx),
                    };
                }
            }
            return { status: 404, stream: emitAccessShell('route-access-not-found') };
        }
    }

    let props = { ...params };
    if (method === 'POST' && typeof Page.action === 'function') {
        const acted = await Page.action({
            params,
            pathname: routePath,
            chunkId: match.chunkId,
            signal: opts.signal,
            searchParams: opts.searchParams,
            body: opts.body,
            method,
            localeId: localeCtx.localeId,
        });
        const actionClosed = normalizeActionResult(acted);
        if (actionClosed.kind === 'redirect') {
            return { status: 302, redirect: actionClosed.location, headers: { Location: actionClosed.location } };
        }
        if (actionClosed.kind === 'deny') {
            return { status: 403, stream: emitAccessShell('route-action-deny') };
        }
        if (actionClosed.kind === 'not-found') {
            return { status: 404, stream: emitAccessShell('route-action-not-found') };
        }
        if (actionClosed.props) {
            props = { ...props, ...actionClosed.props };
        }
    }

    if (typeof Page.load === 'function') {
        const loaded = await Page.load({
            params,
            pathname: routePath,
            chunkId: match.chunkId,
            signal: opts.signal,
            searchParams: opts.searchParams,
            localeId: localeCtx.localeId,
        });
        if (opts.signal?.aborted) {
            return { status: 499, stream: emitAccessShell('route-nav-cancelled') };
        }
        if (loaded && typeof loaded === 'object' && !Array.isArray(loaded)) {
            props = { ...props, ...loaded };
        }
    }
    if (opts.signal?.aborted) {
        return { status: 499, stream: emitAccessShell('route-nav-cancelled') };
    }
    const resumeEntries = await loadPageResumeEntries(distDir, match.chunkId);
    const strategies = resumeEntries.map((e) => e.strategy);
    const eventOnlyShell = isEventOnlyShell(strategies);
    const layoutChain = resolveLayoutChain(match.chunkId);
    return {
        status,
        stream: emitPageHtml(Page, match.chunkId, eventOnlyShell, props, opts, layoutChain, localeCtx),
    };
}

/**
 * @param {unknown} access
 * @returns {{ kind: 'allow' } | { kind: 'redirect', location: string } | { kind: 'deny' } | { kind: 'not-found' }}
 */
function normalizeAccessResult(access) {
    if (access == null || access === true) return { kind: 'allow' };
    if (typeof access === 'string') {
        const k = access.toLowerCase();
        if (k === 'allow') return { kind: 'allow' };
        if (k === 'deny') return { kind: 'deny' };
        if (k === 'not-found' || k === 'notfound') return { kind: 'not-found' };
    }
    if (typeof access === 'object') {
        const kind = String(access.kind || access.type || 'allow').toLowerCase();
        if (kind === 'redirect') {
            const location = String(access.location || access.to || access.href || '');
            if (!location) return { kind: 'deny' };
            return { kind: 'redirect', location };
        }
        if (kind === 'deny') return { kind: 'deny' };
        if (kind === 'not-found' || kind === 'notfound') return { kind: 'not-found' };
        return { kind: 'allow' };
    }
    return { kind: 'allow' };
}

/**
 * @param {unknown} acted
 * @returns {{ kind: 'allow', props?: Record<string, unknown> } | { kind: 'redirect', location: string } | { kind: 'deny' } | { kind: 'not-found' }}
 */
function normalizeActionResult(acted) {
    const base = normalizeAccessResult(acted);
    if (base.kind !== 'allow') return base;
    if (acted && typeof acted === 'object' && acted.props && typeof acted.props === 'object') {
        return { kind: 'allow', props: acted.props };
    }
    if (acted && typeof acted === 'object' && !('kind' in acted) && !('type' in acted) && !Array.isArray(acted)) {
        return { kind: 'allow', props: acted };
    }
    return { kind: 'allow' };
}

/**
 * Minimal HTML for closed access/action results when no NotFound page exists.
 * @param {string} marker
 */
async function* emitAccessShell(marker) {
    yield `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><title>VMZ</title></head>
<body><p>${marker}</p></body>
</html>`;
}

/**
 * @param {any} Page
 * @param {string} chunkId
 * @param {boolean} eventOnlyShell
 * @param {Record<string, unknown>} props
 * @param {{ signal?: AbortSignal, searchParams?: URLSearchParams, cookieHeader?: string }} [opts]
 * @param {string[]} [layoutChain] layout chunk ids outer→inner
 */
async function* emitPageHtml(Page, chunkId, eventOnlyShell, props = {}, opts = {}, layoutChain = [], localeCtx = {}) {
    const signal = opts.signal;
    const live = isDev
        ? `\n  <script>
  (() => {
    const es = new EventSource("/__vmz/events");
    function showOverlay(err) {
      let el = document.getElementById("vmz-dev-overlay");
      if (!el) {
        el = document.createElement("div");
        el.id = "vmz-dev-overlay";
        el.setAttribute("role", "alert");
        Object.assign(el.style, {
          position: "fixed", inset: "0", zIndex: "2147483646",
          background: "rgba(15,17,21,0.92)", color: "#f4f4f5",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          padding: "2rem", overflow: "auto",
        });
        document.documentElement.appendChild(el);
      }
      const msg = (err && err.message) || String(err || "Unknown error");
      const stack = (err && err.stack) || "";
      const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
      el.innerHTML = "<div style=\\"max-width:56rem;margin:0 auto\\">"
        + "<p style=\\"margin:0 0 .5rem;color:#f87171;font-weight:700\\">VMZ Dev Error</p>"
        + "<pre style=\\"white-space:pre-wrap;margin:0 0 1rem;font-size:13px;line-height:1.45\\">" + esc(msg) + "</pre>"
        + (stack ? "<pre style=\\"white-space:pre-wrap;opacity:.7;font-size:12px\\">" + esc(stack) + "</pre>" : "")
        + "<p style=\\"opacity:.65;font-size:12px\\">Fix the file and save — soft reload will clear this overlay.</p>"
        + "</div>";
    }
    function hideOverlay() {
      const el = document.getElementById("vmz-dev-overlay");
      if (el) el.remove();
    }
    es.onmessage = async (ev) => {
      let msg = null;
      try { msg = JSON.parse(ev.data); } catch { /* plain string */ }
      if (msg && msg.type === "error") {
        showOverlay(msg);
        return;
      }
      if (!msg || msg.type !== "hmr") {
        if (ev.data === "reload") location.reload();
        return;
      }
      hideOverlay();
      if (msg.mode === "island") {
        try {
          const { registerComponents, hydrate } = await import("/vmz-dom.js?t=" + msg.token);
          const names = (msg.affectedChunks || [])
            .map((c) => String(c))
            .filter((c) => c.startsWith("components/") || !c.includes("/"))
            .map((c) => c.split("/").pop())
            .filter(Boolean);
          const map = {};
          for (const name of names) {
            let mod;
            try {
              mod = await import("/components/" + name + ".client.js?t=" + msg.token);
            } catch {
              mod = await import("/" + name + ".client.js?t=" + msg.token);
            }
            map[name] = mod.default;
          }
          if (Object.keys(map).length) registerComponents(map);
          const root = document.getElementById("app");
          const pageChunk = root && root.getAttribute("data-vmz-page");
          if (root && pageChunk) {
            const pageMod = await import("/" + pageChunk + ".client.js?t=" + msg.token);
            let hmrProps = {};
            try {
              const raw = root.getAttribute("data-vmz-props");
              if (raw) hmrProps = JSON.parse(raw);
            } catch { /* ignore */ }
            await hydrate(pageMod.default, root, hmrProps, { preserveState: true, skipOnMount: true });
          } else {
            location.reload();
          }
        } catch (err) {
          console.error("vmz island HMR failed", err);
          showOverlay({ message: String(err && err.message || err), stack: err && err.stack });
        }
        return;
      }
      location.reload();
    };
  })();
  </script>`
        : '';
    const bootOverlay =
        isDev && lastDevError
            ? `\n  <script>window.__VMZ_DEV_ERROR__=${JSON.stringify(lastDevError)};` +
              `(function(){var e=window.__VMZ_DEV_ERROR__;if(!e)return;` +
              `var ev=new Event("message");ev.data=JSON.stringify({type:"error",message:e.message,stack:e.stack});` +
              `/* paint immediately */` +
              `var d=document.createElement("div");d.id="vmz-dev-overlay";d.setAttribute("role","alert");` +
              `Object.assign(d.style,{position:"fixed",inset:"0",zIndex:"2147483646",background:"rgba(15,17,21,0.92)",color:"#f4f4f5",fontFamily:"ui-monospace,monospace",padding:"2rem",overflow:"auto"});` +
              `d.innerHTML="<div style='max-width:56rem;margin:0 auto'><p style='color:#f87171;font-weight:700'>VMZ Dev Error</p><pre style='white-space:pre-wrap'>"+String(e.message||e).replace(/[<>&]/g,function(c){return {"<":"&lt;",">":"&gt;","&":"&amp;"}[c]})+"</pre></div>";` +
              `document.documentElement.appendChild(d);})();</script>`
            : '';
    if (signal?.aborted) return;
    const themeId = resolveThemeId(opts.searchParams, opts.cookieHeader);
    const htmlTheme = htmlThemeAttributeForId(themeId);
    const themeBoot = themeBootstrapScript();
    const cssLink = cssEntry ? `  <link rel="stylesheet" href="/${String(cssEntry).replace(/^\/+/, '')}?t=${reloadToken}" />\n` : '';
    const propsJson = JSON.stringify(props ?? {});
    const layoutAttr = layoutChain.length ? ` data-vmz-layout="${escapeAttr(layoutChain.join(','))}"` : '';
    const localeId = localeCtx.localeId || localeArtifact?.defaultLocale || 'en';
    const dir = localeCtx.dir || 'ltr';
    const localeAttr = ` data-vmz-locale="${escapeAttr(localeId)}" data-vmz-dir="${escapeAttr(dir)}"`;
    const routingJson = localeArtifact?.routing
        ? escapeAttr(
              JSON.stringify({
                  strategy: localeArtifact.routing.strategy || 'prefix',
                  defaultPrefix: localeArtifact.routing.defaultPrefix || 'include',
                  defaultLocale: localeArtifact.defaultLocale,
                  locales: (localeArtifact.locales || []).map((l) => l.id),
              }),
          )
        : '';
    const routingAttr = routingJson ? ` data-vmz-locale-routing="${routingJson}"` : '';
    const hreflangLinks = (localeCtx.alternates || [])
        .map((a) => `  <link rel="alternate" hreflang="${escapeAttr(a.hreflang)}" href="${escapeAttr(a.href)}" />`)
        .join('\n');
    const hreflangBlock = hreflangLinks ? `${hreflangLinks}\n` : '';
    yield `<!DOCTYPE html>
<html lang="${escapeAttr(localeId)}" data-locale="${escapeAttr(localeId)}" dir="${escapeAttr(dir)}"${routingAttr}${htmlTheme}>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>VMZ</title>
${hreflangBlock}${themeBoot}${cssLink}</head>
<body>
  <div id="app" data-vmz-page="${escapeAttr(chunkId)}"${layoutAttr}${localeAttr} data-vmz-props="${escapeAttr(propsJson)}">`;
    let bodyHtml = '';
    for await (const chunk of renderToStream(Page, props, { signal })) {
        if (signal?.aborted) return;
        bodyHtml += chunk;
    }
    if (signal?.aborted) return;
    // Wrap page HTML in layout chain (outer → inner) via default slot injection.
    for (let i = layoutChain.length - 1; i >= 0; i--) {
        const Layout = await loadPageCtor(layoutChain[i]);
        if (!Layout) continue;
        bodyHtml = await renderToString(Layout, {}, { signal, slotHtml: bodyHtml });
        if (signal?.aborted) return;
    }
    // Locale discipline: same-app Links retain current LocaleId (realization authority).
    if (localeArtifact && localeId) {
        bodyHtml = localizeBodyLinksInHost(bodyHtml, localeId, localeArtifact);
    }
    yield bodyHtml;
    if (signal?.aborted) return;
    yield `</div>
  <script type="module" src="/${eventOnlyShell ? 'entry-event.js' : 'entry-client.js'}?t=${reloadToken}"></script>${live}${bootOverlay}
</body>
</html>`;
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${host}:${port}`);

    if (url.pathname === '/__vmz/health' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ status: 'ok', shuttingDown, inFlight }));
        return;
    }
    if (url.pathname === '/__vmz/ready' && req.method === 'GET') {
        if (!ready || shuttingDown) {
            res.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
            res.end(JSON.stringify({ status: 'not-ready', ready, shuttingDown }));
            return;
        }
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ status: 'ready', ready: true, inFlight }));
        return;
    }

    if (shuttingDown) {
        res.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ status: 'shutting-down' }));
        return;
    }

    inFlight += 1;
    let settled = false;
    const done = () => {
        if (settled) return;
        settled = true;
        inFlight = Math.max(0, inFlight - 1);
    };
    res.on('finish', done);
    res.on('close', done);

    if (url.pathname === '/__vmz/reload' && req.method === 'POST') {
        readRequestBody(req)
            .then((raw) => {
                let payload = {};
                try {
                    payload = raw ? JSON.parse(raw) : {};
                } catch {
                    payload = {};
                }
                return softReload({ payload });
            })
            .then((info) => {
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ ok: true, token: reloadToken, ...info }));
            })
            .catch((err) => {
                console.error('vmz serve: soft reload failed', err);
                lastDevError = normalizeDevError(err);
                notifySse(
                    JSON.stringify({
                        type: 'error',
                        message: lastDevError.message,
                        stack: lastDevError.stack,
                        at: lastDevError.at,
                    }),
                );
                res.writeHead(500, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: lastDevError.message }));
            });
        return;
    }
    if (url.pathname === '/__vmz/events' && req.method === 'GET') {
        res.writeHead(200, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
        });
        res.write(': connected\n\n');
        sseClients.add(res);
        req.on('close', () => {
            sseClients.delete(res);
        });
        return;
    }
    handleNodeRequest(req, res, { distDir, renderPage, renderPageStream });
});

server.listen(port, host, () => {
    console.log(`vmz serve http://${host}:${port} (dist=${distDir}${isDev ? ', dev' : ''})`);
});

const SHUTDOWN_TIMEOUT_MS = Number(process.env.VMZ_SHUTDOWN_TIMEOUT_MS || 10000);

async function gracefulShutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    ready = false;
    console.log(`vmz serve: ${signal} — draining in-flight=${inFlight} timeout=${SHUTDOWN_TIMEOUT_MS}ms`);
    server.close();
    const start = Date.now();
    while (inFlight > 0 && Date.now() - start < SHUTDOWN_TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, 25));
    }
    for (const client of sseClients) {
        try {
            client.end();
        } catch {
            /* ignore */
        }
    }
    sseClients.clear();
    process.exit(inFlight > 0 ? 1 : 0);
}

process.on('SIGTERM', () => {
    void gracefulShutdown('SIGTERM');
});
process.on('SIGINT', () => {
    void gracefulShutdown('SIGINT');
});

/**
 * Re-import routes / pages / components with a new cache-bust token.
 * Keeps the HTTP server process alive (no Node restart).
 * Failed reloads keep the previous in-memory modules (Vite-like resilience).
 * @param {{ quiet?: boolean, payload?: { affectedChunks?: string[], seedChunks?: string[], full?: boolean, islandHmr?: boolean } }} [opts]
 */
async function softReload(opts = {}) {
    const prevToken = reloadToken;
    const prevCatalog = pageCatalog;
    const nextToken = Date.now();
    reloadToken = nextToken;
    const affected = opts.payload?.affectedChunks ?? [];
    const seeds = opts.payload?.seedChunks ?? [];
    const full = opts.payload?.full;
    const islandHmr = Boolean(opts.payload?.islandHmr);

    try {
        try {
            const routes = JSON.parse(await readFile(path.join(distDir, 'vmz-routes.json'), 'utf8'));
            setRoutes(routes);
        } catch {
            setRoutes([]);
        }
        try {
            localeArtifact = JSON.parse(await readFile(path.join(distDir, '_vmz', 'locale-route-realization.json'), 'utf8'));
        } catch {
            localeArtifact = null;
        }

        const componentEntries = await listClientComponents(distDir);
        const nextCatalog = await listPageClientFiles(distDir);
        if (!nextCatalog.length) {
            throw new Error(`vmz serve: no pages/**/*.client.js in ${distDir}`);
        }

        /** @type {Record<string, any>} */
        const components = {};
        /** @type {Map<string, any>} */
        const nextCtors = new Map();
        const affectedNames = new Set(
            affected
                .map((c) => String(c))
                .filter((c) => c.startsWith('components/') || !c.includes('/'))
                .map((c) => c.split('/').pop())
                .filter(Boolean),
        );
        for (const entry of componentEntries) {
            if (islandHmr && affectedNames.size > 0 && !affectedNames.has(entry.name)) {
                continue;
            }
            const href = bustUrl(pathToFileURL(path.join(distDir, entry.entry)).href);
            const mod = await import(href);
            components[entry.name] = mod.default;
        }

        if (!islandHmr) {
            for (const p of nextCatalog) {
                const pageRel = `${p.chunkId}.client.js`;
                const href = bustUrl(pathToFileURL(path.join(distDir, pageRel)).href);
                const mod = await import(href);
                nextCtors.set(p.chunkId, mod.default);
            }
        }

        pageCatalog = nextCatalog;
        if (!islandHmr) {
            pageCtors.clear();
            for (const [k, v] of nextCtors) pageCtors.set(k, v);
        }
        if (Object.keys(components).length) {
            registerComponents(components);
        }

        const indexChunk = pageCatalog.find((p) => p.chunkId === 'pages/index')?.chunkId || pageCatalog[0].chunkId;
        const resumeEntries = await loadPageResumeEntries(distDir, indexChunk);
        const styleMeta = await loadDeploymentStyle(distDir);
        cssEntry = styleMeta.cssEntry;
        styleTheme = styleMeta.styleTheme;
        const lazyEventNames = resumeEntries
            .filter((e) => isEventStrategy(e.strategy))
            .map((e) => e.component)
            .filter(Boolean);
        const lazySet = new Set(lazyEventNames);

        await writeFile(
            path.join(distDir, 'entry-client.js'),
            emitEntryClient(
                componentEntries.filter((e) => !lazySet.has(e.name)),
                componentEntries.filter((e) => lazySet.has(e.name)),
                reloadToken,
            ),
            'utf8',
        );

        const strategies = resumeEntries.map((e) => e.strategy);
        const eventOnlyShell = isEventOnlyShell(strategies);
        await writeFile(path.join(distDir, 'entry-event.js'), emitEntryEvent(reloadToken), 'utf8');

        lastDevError = null;
        const mode = islandHmr ? 'island' : eventOnlyShell ? 'event-shell' : 'full';
        notifySse(
            JSON.stringify({
                type: 'hmr',
                mode,
                affectedChunks: affected,
                seedChunks: seeds,
                token: reloadToken,
                full: Boolean(full),
                eventOnlyShell,
            }),
        );
        if (!opts.quiet) {
            const aff = affected.length > 0 ? ` affected=[${affected.join(', ')}]` : full === false ? ' affected=[]' : '';
            console.log(`vmz serve: soft reload ok (mode=${mode}; pages=${pageCatalog.length}; t=${reloadToken}${aff})`);
        }
        return {
            affectedChunks: affected,
            seedChunks: seeds,
            full: Boolean(full),
            islandHmr,
            mode,
            eventOnlyShell,
            pageCount: pageCatalog.length,
        };
    } catch (err) {
        reloadToken = prevToken;
        pageCatalog = prevCatalog;
        lastDevError = normalizeDevError(err);
        throw err;
    }
}

/** @param {string} event */
function notifySse(event) {
    for (const client of [...sseClients]) {
        try {
            client.write(`data: ${event}\n\n`);
        } catch {
            sseClients.delete(client);
        }
    }
}

/** @param {unknown} err */
function normalizeDevError(err) {
    if (err && typeof err === 'object') {
        const e = /** @type {{ message?: string, stack?: string }} */ (err);
        return {
            message: e.message ? String(e.message) : String(err),
            stack: e.stack ? String(e.stack) : undefined,
            at: Date.now(),
        };
    }
    return { message: String(err), at: Date.now() };
}

/** @param {{ message: string, stack?: string }} err */
async function* emitDevErrorHtml(err) {
    const msg = escapeHtml(err.message || 'Unknown error');
    const stack = err.stack ? escapeHtml(err.stack) : '';
    yield `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>VMZ Dev Error</title>
  <style>
    body{margin:0;background:#0f1115;color:#f4f4f5;font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
    main{max-width:56rem;margin:0 auto;padding:2rem 1.25rem}
    h1{margin:0 0 .75rem;color:#f87171;font-size:1.1rem}
    pre{white-space:pre-wrap;margin:0 0 1rem}
    .hint{opacity:.65;font-size:12px}
  </style>
</head>
<body>
  <main>
    <h1>VMZ Dev Error</h1>
    <pre>${msg}</pre>
    ${stack ? `<pre style="opacity:.7;font-size:12px">${stack}</pre>` : ''}
    <p class="hint">Dev host stayed up. Fix the source and save — soft reload will recover.</p>
  </main>
  <script>
  (() => {
    const es = new EventSource("/__vmz/events");
    es.onmessage = (ev) => {
      let msg = null;
      try { msg = JSON.parse(ev.data); } catch {}
      if (msg && msg.type === "hmr") location.reload();
    };
  })();
  </script>
</body>
</html>`;
}

/** @param {string} s */
function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Resolve LocaleId from pathname using `_vmz/locale-route-realization.json`.
 * LocaleId is a realization dimension — matching still uses stable route path.
 * @param {string} pathname
 */
function resolveLocalePath(pathname) {
    const raw = String(pathname || '/');
    const normalized = raw.length > 1 && raw.endsWith('/') ? raw.slice(0, -1) : raw || '/';
    if (!localeArtifact) {
        return { localeId: 'en', dir: 'ltr', restPath: normalized, redirectTo: null };
    }
    const supported = (localeArtifact.locales || []).map((l) => l.id);
    const defaultLocale = localeArtifact.defaultLocale || supported[0] || 'en';
    const directions = Object.fromEntries((localeArtifact.locales || []).map((l) => [l.id, l.direction || 'ltr']));
    const routing = localeArtifact.routing || {};
    const parts = normalized.split('/').filter(Boolean);
    let localeId = null;
    let restPath = normalized;
    if (parts.length && supported.includes(parts[0])) {
        localeId = parts[0];
        const rest = parts.slice(1);
        restPath = rest.length ? `/${rest.join('/')}` : '/';
    }
    // omit defaultPrefix: prefixed defaultLocale URL redirects to unprefixed canonical.
    if (routing.defaultPrefix === 'omit' && localeId === defaultLocale) {
        return {
            localeId: defaultLocale,
            dir: directions[defaultLocale] || 'ltr',
            restPath,
            redirectTo: restPath,
        };
    }
    const contentLocale = localeId || defaultLocale;
    return {
        localeId: contentLocale,
        dir: directions[contentLocale] || 'ltr',
        restPath,
        redirectTo: null,
    };
}

/**
 * Realize href for current LocaleId (prefix strategy). Kept local so serve-host
 * stays free of CLI package imports.
 * @param {string} href
 * @param {string} localeId
 * @param {any} artifact
 */
function localizeSameAppHrefHost(href, localeId, artifact) {
    if (!href || !localeId || !artifact) return href;
    if (href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href)) return href;
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('/')) return href;
    let pathname = String(href);
    let search = '';
    let hash = '';
    const hashIdx = pathname.indexOf('#');
    if (hashIdx >= 0) {
        hash = pathname.slice(hashIdx);
        pathname = pathname.slice(0, hashIdx);
    }
    const qIdx = pathname.indexOf('?');
    if (qIdx >= 0) {
        search = pathname.slice(qIdx);
        pathname = pathname.slice(0, qIdx);
    }
    if (!pathname) pathname = '/';
    const supported = (artifact.locales || []).map((l) => l.id).filter(Boolean);
    const defaultLocale = artifact.defaultLocale || artifact.routing?.defaultLocale;
    const routing = artifact.routing || {};
    const strategy = routing.strategy || 'prefix';
    const defaultPrefix = routing.defaultPrefix || 'include';
    const parts = pathname.split('/').filter(Boolean);
    let rest = pathname;
    if (parts.length && supported.includes(parts[0])) {
        const r = parts.slice(1);
        rest = r.length ? `/${r.join('/')}` : '/';
    }
    if (rest.length > 1 && rest.endsWith('/')) rest = rest.slice(0, -1);
    if (!rest.startsWith('/')) rest = `/${rest}`;
    if (strategy === 'none' || strategy === 'domain') return `${rest}${search}${hash}`;
    const omitDefault = defaultPrefix === 'omit' && localeId === defaultLocale;
    if (omitDefault) return `${rest}${search}${hash}`;
    const pathOut = rest === '/' ? `/${localeId}` : `/${localeId}${rest}`;
    return `${pathOut}${search}${hash}`;
}

/**
 * @param {string} html
 * @param {string} localeId
 * @param {any} artifact
 */
function localizeBodyLinksInHost(html, localeId, artifact) {
    if (!html || !localeId || !artifact) return html;
    return String(html).replace(/<a\b([^>]*)>/gi, (full, attrs) => {
        if (!/\bdata-vmz-route\s*=/.test(attrs)) return full;
        const hm = attrs.match(/\bhref\s*=\s*"([^"]*)"/i);
        if (!hm) return full;
        const next = localizeSameAppHrefHost(hm[1], localeId, artifact);
        if (next === hm[1]) return full;
        const newAttrs = attrs.replace(/\bhref\s*=\s*"[^"]*"/i, `href="${escapeAttr(next)}"`);
        return `<a${newAttrs}>`;
    });
}

/**
 * @param {string} chunkId
 * @param {string} localeId
 */
function pageMetaAlternates(chunkId, localeId) {
    if (!localeArtifact?.pageMetas) return [];
    const meta =
        localeArtifact.pageMetas.find((m) => m.routeId === chunkId && m.locale === localeId) ||
        localeArtifact.pageMetas.find((m) => m.routeId === chunkId && m.locale === localeArtifact.defaultLocale);
    return Array.isArray(meta?.alternates) ? meta.alternates : [];
}

/** @param {string} href */
function bustUrl(href) {
    const u = new URL(href);
    u.searchParams.set('t', String(reloadToken));
    return u.href;
}

/** @param {string} chunkId */
async function loadPageCtor(chunkId) {
    const pageRel = `${chunkId}.client.js`;
    const href = bustUrl(pathToFileURL(path.join(distDir, pageRel)).href);
    const mod = await import(href);
    pageCtors.set(chunkId, mod.default);
    return mod.default;
}

/**
 * @param {string} dir
 * @returns {Promise<Array<{ name: string, entry: string }>>}
 */
async function listClientComponents(dir) {
    /** @type {Map<string, { name: string, entry: string }>} */
    const byName = new Map();
    try {
        const raw = await readFile(path.join(dir, 'vmz-deployment.json'), 'utf8');
        const dep = JSON.parse(raw);
        for (const unit of dep.units || []) {
            if (unit?.kind !== 'component') continue;
            const chunkId = String(unit.chunkId || '');
            const name = chunkId.split('/').pop();
            if (!name) continue;
            const entry = String(unit.clientEntry || `${chunkId}.client.js`).replace(/\\/g, '/');
            byName.set(name, { name, entry });
        }
    } catch {
        /* fall through to directory scan */
    }
    if (byName.size === 0) {
        const folder = path.join(dir, 'components');
        let files = [];
        try {
            files = await readdir(folder);
        } catch {
            return [];
        }
        for (const f of files.filter((name) => name.endsWith('.client.js'))) {
            const name = f.replace(/\.client\.js$/, '');
            byName.set(name, { name, entry: `components/${name}.client.js` });
        }
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Discover compiled page modules under dist/pages.
 * @param {string} dir
 */
async function listPageClientFiles(dir) {
    const root = path.join(dir, 'pages');
    /** @type {Array<{ chunkId: string, pageRel: string, segs: ReturnType<typeof parseChunkSegments> }>} */
    const out = [];
    async function walk(abs, relParts) {
        let ents;
        try {
            ents = await readdir(abs, { withFileTypes: true });
        } catch {
            return;
        }
        for (const e of ents) {
            if (e.isDirectory()) {
                await walk(path.join(abs, e.name), [...relParts, e.name]);
            } else if (e.isFile() && e.name.endsWith('.client.js')) {
                const stem = e.name.replace(/\.client\.js$/, '');
                if (isRouteBoundaryStem(stem)) continue;
                const chunkId = ['pages', ...relParts, stem].join('/');
                out.push({
                    chunkId,
                    pageRel: `${chunkId}.client.js`,
                    segs: parseChunkSegments(chunkId),
                });
            }
        }
    }
    await walk(root, []);
    return out;
}

/**
 * File-route segments from chunk id (`pages/Install` → `/install`).
 * Skips URL-invisible `(group)` dirs; boundary stems never reach here.
 * @param {string} chunkId
 */
function parseChunkSegments(chunkId) {
    const rel = chunkId.replace(/^pages\//, '');
    const parts = rel.split('/').filter(Boolean);
    /** @type {Array<{ kind: 'static' | 'param' | 'catch', value?: string, name?: string }>} */
    const segs = [];
    for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (isRouteGroupDir(p)) continue;
        if (p === 'index' && i === parts.length - 1) continue;
        const catchAll = /^\[\.\.\.([^\]]+)\]$/.exec(p);
        const param = /^\[([^\]]+)\]$/.exec(p);
        if (catchAll) segs.push({ kind: 'catch', name: catchAll[1] });
        else if (param) segs.push({ kind: 'param', name: param[1] });
        else segs.push({ kind: 'static', value: p.toLowerCase() });
    }
    return segs;
}

function isRouteGroupDir(seg) {
    return typeof seg === 'string' && seg.startsWith('(') && seg.endsWith(')') && seg.length > 2;
}

function isRouteBoundaryStem(stem) {
    return stem === 'Layout' || stem === 'Loading' || stem === 'Error' || stem === 'NotFound';
}

/**
 * Nearest `Layout.client.js` walking up from the page chunk (outer→inner).
 * @param {string} pageChunkId
 * @returns {string[]}
 */
function resolveLayoutChain(pageChunkId) {
    const rel = pageChunkId.replace(/^pages\//, '');
    const parts = rel.split('/').filter(Boolean);
    parts.pop(); // page stem
    /** @type {string[]} */
    const chain = [];
    for (let i = parts.length; i >= 0; i--) {
        const dirParts = parts.slice(0, i);
        const layoutChunk = ['pages', ...dirParts, 'Layout'].join('/');
        const abs = path.join(distDir, `${layoutChunk}.client.js`);
        try {
            // sync existence — layouts are compile artifacts next to pages
            if (existsSync(abs)) chain.unshift(layoutChunk);
        } catch {
            /* ignore */
        }
    }
    return chain;
}

/**
 * @param {string} pathname
 * @param {typeof pageCatalog} catalog
 */
function matchFileRoute(pathname, catalog) {
    const pathParts = decodeURIComponent(pathname.split('?')[0] || '/')
        .replace(/\/+$/, '')
        .split('/')
        .filter(Boolean)
        .map((p) => p.toLowerCase());

    let best = null;
    let bestScore = -1;
    for (const page of catalog) {
        const score = scoreRoute(page.segs, pathParts);
        if (score == null) continue;
        if (score > bestScore) {
            bestScore = score;
            best = page;
        }
    }
    return best;
}

/**
 * @param {ReturnType<typeof parseChunkSegments>} segs
 * @param {string} pathname
 * @returns {Record<string, string>}
 */
function extractRouteParams(segs, pathname) {
    const pathParts = decodeURIComponent(pathname.split('?')[0] || '/')
        .replace(/\/+$/, '')
        .split('/')
        .filter(Boolean);
    /** @type {Record<string, string>} */
    const params = {};
    let j = 0;
    for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        if (s.kind === 'catch') {
            if (s.name) params[s.name] = pathParts.slice(j).join('/');
            return params;
        }
        if (j >= pathParts.length) break;
        if (s.kind === 'param' && s.name) {
            params[s.name] = pathParts[j];
        }
        j++;
    }
    return params;
}

/**
 * @param {ReturnType<typeof parseChunkSegments>} segs
 * @param {string[]} pathParts
 * @returns {number | null}
 */
function scoreRoute(segs, pathParts) {
    let i = 0;
    let j = 0;
    let score = 0;
    while (i < segs.length) {
        const s = segs[i];
        if (s.kind === 'catch') {
            // Required catch-all `[...slug]` needs ≥1 remaining segment (not `/`).
            if (j >= pathParts.length) return null;
            score += 1;
            return score;
        }
        if (j >= pathParts.length) return null;
        if (s.kind === 'static') {
            if (s.value !== pathParts[j]) return null;
            score += 1000;
        } else if (s.kind === 'param') {
            score += 100;
        }
        i++;
        j++;
    }
    if (j !== pathParts.length) return null;
    return score + segs.length;
}

function isRootCatchAll(page) {
    return page?.segs?.length === 1 && page.segs[0].kind === 'catch';
}

function findRootCatchAll(catalog) {
    return catalog.find((p) => isRootCatchAll(p)) || null;
}

/**
 * Optional app gate: `dist/vmz-route-gate.mjs` → `{ check(pathname, chunkId) => 'not_found' | null }`.
 * @param {string} pathname
 * @param {string | undefined} chunkId
 */
async function runRouteGate(pathname, chunkId) {
    try {
        const href = bustUrl(pathToFileURL(path.join(distDir, 'vmz-route-gate.mjs')).href);
        const mod = await import(href);
        if (typeof mod.check !== 'function') return null;
        return await mod.check(pathname, chunkId ?? null);
    } catch {
        return null;
    }
}

/**
 * @param {Array<{ name: string, entry: string }>} eager
 * @param {Array<{ name: string, entry: string }>} lazy
 * @param {number} token
 */
function emitEntryClient(eager, lazy, token) {
    const q = `?t=${token}`;
    const imports = eager.map((e) => `import ${e.name} from ${JSON.stringify(`./${e.entry}${q}`)};`).join('\n');
    const map = eager.length ? `registerComponents({ ${eager.map((e) => e.name).join(', ')} });` : '';
    const entryByName = Object.fromEntries([...eager, ...lazy].map((e) => [e.name, e.entry]));
    const loader = lazy.length
        ? `const __vmzComponentEntries = ${JSON.stringify(entryByName)};
globalThis.__vmzLoadComponent = async (name) => {
  const entry = __vmzComponentEntries[name] || ("components/" + name + ".client.js");
  const mod = await import("./" + entry + "${q}");
  return mod.default;
};`
        : '';
    return `/**
 * Generated by vmz serve — hydrate matched file-route page (data-vmz-page) + layout chain + client Link takeover.
 */
import { registerComponents, hydrate, hydrateRoute, hydrateRoutePage, destroy } from ${JSON.stringify(`./vmz-dom.js${q}`)};
import { installClientNavigation } from ${JSON.stringify(`./vmz-client-nav.js${q}`)};
${imports}

${map}
${loader}

const root = document.getElementById("app");
if (!root) throw new Error("vmz: missing #app");
const chunkId = root.getAttribute("data-vmz-page");
if (!chunkId) throw new Error("vmz: missing data-vmz-page");
let props = {};
try {
  const raw = root.getAttribute("data-vmz-props");
  if (raw) props = JSON.parse(raw);
} catch { /* ignore */ }
const layoutChain = (root.getAttribute("data-vmz-layout") || "").split(",").map((s) => s.trim()).filter(Boolean);
const layoutCtors = [];
for (const id of layoutChain) {
  layoutCtors.push((await import("./" + id + ".client.js${q}")).default);
}
const Page = (await import("./" + chunkId + ".client.js${q}")).default;
await hydrateRoute(Page, root, props, layoutCtors);
installClientNavigation({
  hydrate,
  hydrateRoute,
  hydrateRoutePage,
  destroy,
  importPage: async (id) => (await import("./" + id + ".client.js${q}")).default,
});
`;
}

/**
 * EventEntry zero-framework bootstrap: no static import of vmz-dom / page / islands.
 * Framework bytes load only inside the first matching DOM event handler.
 * @param {number} token
 */
function emitEntryEvent(token) {
    const q = `?t=${token}`;
    return `/**
 * Generated by vmz serve — EventEntry zero-framework JS shell.
 */
(async () => {
  const roots = [...document.querySelectorAll(
    '[data-vmz-entry="event"], [data-vmz-client="event"], [data-vmz-client^="event:"]',
  )];
  for (const el of roots) {
    if (el.__vmzEventWired) continue;
    el.__vmzEventWired = true;
    const strat = el.getAttribute("data-vmz-client") || "event";
    let type = "click";
    if (strat.startsWith("event:") && strat.length > 6) type = strat.slice(6) || "click";
    else if (strat === "click") type = "click";
    el.addEventListener(
      type,
      async () => {
        const { registerComponents, resume } = await import(${JSON.stringify(`./vmz-dom.js${q}`)});
        const name = el.getAttribute("data-vmz-island");
        if (!name) throw new Error("vmz: EventEntry missing data-vmz-island");
        const Comp = (await import("./components/" + name + ".client.js${q}")).default;
        registerComponents({ [name]: Comp });
        await resume(Comp, el);
      },
      { once: true },
    );
  }
})();
`;
}

/**
 * Style Theme cookie / localStorage key (host contract, not a second theme API).
 */
const THEME_STORE_KEY = 'vmz-theme';

/**
 * @param {string} dir
 * @returns {Promise<{ cssEntry: string|null, styleTheme: typeof styleTheme, styleBundleHash: string|null }>}
 */
async function loadDeploymentStyle(dir) {
    try {
        const raw = await readFile(path.join(dir, 'vmz-deployment.json'), 'utf8');
        const dep = JSON.parse(raw);
        const entry = dep.cssEntry;
        const css = typeof entry === 'string' && entry.trim() ? entry.trim().replace(/^\/+/, '') : null;
        const st = dep.styleTheme;
        let theme = null;
        if (st && typeof st === 'object') {
            theme = {
                defaultThemeId: String(st.defaultThemeId || 'default'),
                themeIds: Array.isArray(st.themeIds) ? st.themeIds.map(String) : [],
                activationAttr: String(st.activationAttr || 'data-theme'),
                prefersColorScheme:
                    st.prefersColorScheme && typeof st.prefersColorScheme === 'object'
                        ? Object.fromEntries(Object.entries(st.prefersColorScheme).map(([k, v]) => [String(k), String(v)]))
                        : {},
                contentHash: st.contentHash ? String(st.contentHash) : null,
            };
        }
        const bundleHash = typeof dep.styleBundleHash === 'string' && dep.styleBundleHash.trim() ? dep.styleBundleHash.trim() : null;
        return { cssEntry: css, styleTheme: theme, styleBundleHash: bundleHash };
    } catch {
        return { cssEntry: null, styleTheme: null, styleBundleHash: null };
    }
}

/**
 * Priority: `?theme=` → cookie → none (CSS `:root` + prefers-color-scheme media).
 * Explicit ids (including default) always win over OS preference via activation attr.
 * @param {URLSearchParams | undefined} searchParams
 * @param {string | undefined} cookieHeader
 * @returns {string|null}
 */
function resolveThemeId(searchParams, cookieHeader) {
    if (!styleTheme) return null;
    const ids = styleTheme.themeIds || [];
    const q = searchParams && typeof searchParams.get === 'function' ? searchParams.get('theme') : null;
    if (q && ids.includes(q)) return q;
    const fromCookie = readCookie(cookieHeader, THEME_STORE_KEY);
    if (fromCookie && ids.includes(fromCookie)) return fromCookie;
    return null;
}

/**
 * Always emit activation attr for an explicit theme id (incl. default) so it overrides OS media.
 * @param {string|null} themeId
 */
function htmlThemeAttributeForId(themeId) {
    if (!styleTheme || !themeId) return '';
    const attr = styleTheme.activationAttr || 'data-theme';
    if (!(styleTheme.themeIds || []).includes(themeId)) return '';
    return ` ${attr}="${escapeAttr(themeId)}"`;
}

/**
 * Inline boot when SSR had no query/cookie: apply explicit `localStorage` only.
 * No stored choice → leave bare `<html>` so CSS `@media (prefers-color-scheme)` follows OS live.
 * Explicit ids (incl. default) always set the activation attr so they override OS media.
 */
function themeBootstrapScript() {
    if (!styleTheme) return '';
    const attr = JSON.stringify(styleTheme.activationAttr || 'data-theme');
    const ids = JSON.stringify(styleTheme.themeIds || []);
    const key = JSON.stringify(THEME_STORE_KEY);
    return `  <script>(function(){try{var k=${key},attr=${attr},ids=${ids};var id=localStorage.getItem(k);if(!id||ids.indexOf(id)<0)return;document.documentElement.setAttribute(attr,id);}catch(e){}})();</script>\n`;
}

/**
 * @param {string|undefined} header
 * @param {string} name
 */
function readCookie(header, name) {
    if (!header) return null;
    const parts = String(header).split(';');
    for (const part of parts) {
        const idx = part.indexOf('=');
        if (idx < 0) continue;
        const k = part.slice(0, idx).trim();
        if (k !== name) continue;
        try {
            return decodeURIComponent(part.slice(idx + 1).trim());
        } catch {
            return part.slice(idx + 1).trim();
        }
    }
    return null;
}

/**
 * @param {string} dir
 * @returns {Promise<string|null>}
 */
async function loadCssEntry(dir) {
    const meta = await loadDeploymentStyle(dir);
    return meta.cssEntry;
}

/**
 * @param {string} dir
 * @param {string} chunkId
 * @returns {Promise<Array<{ component: string, strategy: string }>>}
 */
async function loadPageResumeEntries(dir, chunkId) {
    try {
        const raw = await readFile(path.join(dir, 'vmz-deployment.json'), 'utf8');
        const dep = JSON.parse(raw);
        const units = Array.isArray(dep.units) ? dep.units : [];
        const page =
            units.find((u) => u.chunkId === chunkId) || units.find((u) => u.chunkId === 'pages/index') || units.find((u) => u.kind === 'page');
        const entries = Array.isArray(page?.resumeEntries) ? page.resumeEntries : [];
        return entries.map((e) => ({
            component: String(e.component || ''),
            strategy: String(e.strategy || ''),
        }));
    } catch {
        return [];
    }
}

/** @param {string} strategy */
function isEventStrategy(strategy) {
    return strategy === 'event' || strategy === 'click' || strategy.startsWith('event:');
}

/** @param {string[]} strategies */
function isEventOnlyShell(strategies) {
    if (!strategies.length) return false;
    return strategies.every((s) => isEventStrategy(s));
}

/** @param {string} s */
function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
