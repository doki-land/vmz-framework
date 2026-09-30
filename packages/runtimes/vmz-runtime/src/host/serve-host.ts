/** Partial reshape ? mutable host runtime stays in this file. */

import { existsSync, readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { listClientComponents } from './list-client-components.js';
import type { ClosedAccessResult, HostRequestOpts, LocaleHostCtx, SseClient } from '../shared/host.types.js';
import { LOCALE_LINK_PLAN_SCHEMA, linkRouteAliasesFromUnits, localeHrefTableFromPlan, localizeBodyLinks } from './localize-body-links.js';
import { loadNativeAddon } from './native-addon.js';
import { createRenderHost } from './render/render-host.js';
import { resolveRouteLayoutChain } from './render/route-layout-chain.js';
import { handleNodeRequest, setRoutes, setServerModuleResolver } from '../faces/vmz-runtime.js';

import { LOCALE_LINK_PLAN_REL, LOCALE_STORE_KEY, ROUTE_CATALOG_REL, ROUTE_CATALOG_SCHEMA, SHUTDOWN_TIMEOUT_MS, THEME_STORE_KEY } from './serve/constants.js';
import { extractRouteParams, findRootCatchAll, isRootCatchAll, isRouteBoundaryStem, matchFileRoute, parsePathPattern } from './serve/route-catalog.js';

import { installAppModuleResolveHooks } from './serve/paths.js';
import { serveState } from './serve/state.js';

installAppModuleResolveHooks();

globalThis.__VMZ_RPC_ORIGIN = `http://${serveState.host}:${serveState.port}`;

if (serveState.isDev) {
    const distUrlPrefix = pathToFileURL(
        serveState.distDir.endsWith(path.sep) ? serveState.distDir : `${serveState.distDir}${path.sep}`,
    ).href;
    registerHooks({
        resolve(specifier, context, nextResolve) {
            const result = nextResolve(specifier, context);
            if (!specifier.startsWith('.') || !context.parentURL || !result?.url) return result;
            let token = '';
            try {
                token = new URL(context.parentURL).searchParams.get('t') || '';
            } catch {
                return result;
            }
            if (!token) return result;
            if (!result.url.startsWith('file:')) return result;
            if (!result.url.startsWith(distUrlPrefix)) {
                try {
                    if (!fileURLToPath(result.url).startsWith(serveState.distDir)) return result;
                } catch {
                    return result;
                }
            }
            const u = new URL(result.url);
            if (u.searchParams.get('t') === token) return result;
            u.searchParams.set('t', token);
            return { ...result, url: u.href, shortCircuit: true };
        },
    });
}

setServerModuleResolver((moduleId) => {
    const rel = moduleId.replace(/^#server\//, '') + '.js';
    return bustUrl(pathToFileURL(path.join(serveState.distDir, '#server', rel)).href);
});

try {
    await softReload({ quiet: true });
    serveState.ready = true;
} catch (err) {
    serveState.lastDevError = normalizeDevError(err);
    serveState.ready = true;
    console.error('vmz serve: initial load failed (dev host stays up)', serveState.lastDevError.message);
}



function readRequestBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

async function renderPage(pathname, opts: HostRequestOpts = {}) {
    const rendered = await renderPageStream(pathname, opts);
    if (!rendered) return null;
    const raw = rendered.stream ?? rendered;
    if (!raw || typeof raw !== 'object' || typeof (raw as AsyncIterable<string>)[Symbol.asyncIterator] !== 'function') {
        return null;
    }
    let html = '';
    for await (const chunk of raw as AsyncIterable<string>) {
        html += chunk;
    }
    return html;
}

async function renderPageStream(pathname, opts: any = {}) {
    try {
        return await renderPageStreamInner(pathname, opts);
    } catch (err) {
        const normalized = normalizeDevError(err);
        serveState.lastDevError = normalized;
        console.error('vmz serve: renderPageStream failed', normalized.message);
        return { status: 500, stream: emitDevErrorHtml(normalized) };
    }
}

async function renderPageStreamInner(pathname, opts: any = {}) {
    if (serveState.isDev && serveState.lastDevError && serveState.pageCtors.size === 0) {
        return { status: 500, stream: emitDevErrorHtml(serveState.lastDevError) };
    }

    const localePlan = resolveLocalePath(pathname, opts.cookieHeader);
    if (localePlan.redirectTo) {
        return { status: 302, redirect: localePlan.redirectTo, headers: { Location: localePlan.redirectTo } };
    }
    const routePath = localePlan.restPath || pathname;

    let match = matchFileRoute(routePath, serveState.pageCatalog);
    let status = 200;

    const gated = await runRouteGate(routePath, match?.chunkId);
    if (gated === 'not_found') {
        match = findRootCatchAll(serveState.pageCatalog);
        status = 404;
    } else if (!match) {
        match = findRootCatchAll(serveState.pageCatalog);
        status = 404;
    } else if (isRootCatchAll(match)) {
        status = 404;
    }

    if (!match) {
        if (serveState.isDev && serveState.lastDevError) {
            return { status: 500, stream: emitDevErrorHtml(serveState.lastDevError) };
        }
        return null;
    }
    const Page = await loadPageCtor(match.chunkId);
    if (!Page) {
        if (serveState.isDev && serveState.lastDevError) {
            return { status: 500, stream: emitDevErrorHtml(serveState.lastDevError) };
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
            const catchAll = findRootCatchAll(serveState.pageCatalog);
            if (catchAll) {
                const NotFound = await loadPageCtor(catchAll.chunkId);
                if (NotFound) {
                    const resumeEntries = await loadPageResumeEntries(serveState.distDir, catchAll.chunkId);
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
    const resumeEntries = await loadPageResumeEntries(serveState.distDir, match.chunkId);
    const strategies = resumeEntries.map((e) => e.strategy);
    const eventOnlyShell = isEventOnlyShell(strategies);
    const layoutChain = resolveRouteLayoutChain(serveState.distDir, match.chunkId);
    return {
        status,
        stream: emitPageHtml(Page, match.chunkId, eventOnlyShell, props, opts, layoutChain, localeCtx),
    };
}

function normalizeAccessResult(access: unknown): ClosedAccessResult {
    if (access == null || access === true) return { kind: 'allow' };
    if (typeof access === 'string') {
        const k = access.toLowerCase();
        if (k === 'allow') return { kind: 'allow' };
        if (k === 'deny') return { kind: 'deny' };
        if (k === 'not-found' || k === 'notfound') return { kind: 'not-found' };
    }
    if (typeof access === 'object' && access) {
        const row = access as Record<string, unknown>;
        const kind = String(row.kind || row.type || 'allow').toLowerCase();
        if (kind === 'redirect') {
            const location = String(row.location || row.to || row.href || '');
            if (!location) return { kind: 'deny' };
            return { kind: 'redirect', location };
        }
        if (kind === 'deny') return { kind: 'deny' };
        if (kind === 'not-found' || kind === 'notfound') return { kind: 'not-found' };
        return { kind: 'allow' };
    }
    return { kind: 'allow' };
}

function normalizeActionResult(acted: unknown): ClosedAccessResult {
    const base = normalizeAccessResult(acted);
    if (base.kind !== 'allow') return base;
    if (acted && typeof acted === 'object' && !Array.isArray(acted)) {
        const row = acted as Record<string, unknown>;
        if (row.props && typeof row.props === 'object') {
            return { kind: 'allow', props: row.props as Record<string, unknown> };
        }
        if (!('kind' in row) && !('type' in row)) {
            return { kind: 'allow', props: row };
        }
    }
    return { kind: 'allow' };
}

async function* emitAccessShell(marker) {
    const native = loadNativeAddon();
    if (typeof native.generateHtmlShell !== 'function') {
        throw new Error('vmz native addon missing generateHtmlShell �?rebuild with `pnpm napi:build`');
    }
    yield native.generateHtmlShell({
        title: 'App',
        lang: 'en',
        cssHrefs: [],
        bodyHtml: `<p>${marker}</p>`,
        bodyAttrs: [],
    });
}

function resolvePageDocumentMeta(Page: { meta?: (() => Record<string, unknown>) | Record<string, unknown> }) {
    try {
        let raw: Record<string, unknown> = {};
        if (typeof Page?.meta === 'function') raw = Page.meta() || {};
        else if (Page?.meta && typeof Page.meta === 'object') raw = Page.meta;
        const title = String(raw.title || '').trim();
        const description = String(raw.description || '').trim();
        return { title: title || 'App', description };
    } catch {
        return { title: 'App', description: '' };
    }
}

async function* emitPageHtml(
    Page,
    chunkId,
    eventOnlyShell,
    props: Record<string, unknown> = {},
    opts: HostRequestOpts = {},
    layoutChain: string[] = [],
    localeCtx: LocaleHostCtx = {},
) {
    const signal = opts.signal;
    const live = serveState.isDev
        ? `\n  <script>
  (() => {
    const es = new EventSource("/__vmz/events");
    let sawDisconnect = false;
    es.onerror = () => { sawDisconnect = true; };
    es.onopen = () => {
      // Host respawn drops SSE �?reload once the new process is up (no manual restart).
      if (sawDisconnect) location.reload();
    };
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
        + "<p style=\\"margin:0 0 .5rem;color:#f87171;font-weight:700\\">Dev Error</p>"
        + "<pre style=\\"white-space:pre-wrap;margin:0 0 1rem;font-size:13px;line-height:1.45\\">" + esc(msg) + "</pre>"
        + (stack ? "<pre style=\\"white-space:pre-wrap;opacity:.7;font-size:12px\\">" + esc(stack) + "</pre>" : "")
        + "<p style=\\"opacity:.65;font-size:12px\\">Fix the file and save �?soft reload will clear this overlay.</p>"
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
          const { hydrate } = await import("/dom.browser.js?t=" + msg.token);
          const root = document.getElementById("app");
          const pageChunk = root && root.getAttribute("data-vmz-page");
          if (root && pageChunk) {
            // Child Ctors come from page static imports after reload with cache token.
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
        serveState.isDev && serveState.lastDevError
            ? `\n  <script>window.__VMZ_DEV_ERROR__=${JSON.stringify(serveState.lastDevError)};` +
              `(function(){var e=window.__VMZ_DEV_ERROR__;if(!e)return;` +
              `var ev=new Event("message");ev.data=JSON.stringify({type:"error",message:e.message,stack:e.stack});` +
              `/* paint immediately */` +
              `var d=document.createElement("div");d.id="vmz-dev-overlay";d.setAttribute("role","alert");` +
              `Object.assign(d.style,{position:"fixed",inset:"0",zIndex:"2147483646",background:"rgba(15,17,21,0.92)",color:"#f4f4f5",fontFamily:"ui-monospace,monospace",padding:"2rem",overflow:"auto"});` +
              `d.innerHTML="<div style='max-width:56rem;margin:0 auto'><p style='color:#f87171;font-weight:700'>Dev Error</p><pre style='white-space:pre-wrap'>"+String(e.message||e).replace(/[<>&]/g,function(c){return {"<":"&lt;",">":"&gt;","&":"&amp;"}[c]})+"</pre></div>";` +
              `document.documentElement.appendChild(d);})();</script>`
            : '';
    const buildIdBoot = serveState.isDev && serveState.lastDevBuildId ? `\n  <script>window.__VMZ_DEV_BUILD_ID__=${JSON.stringify(serveState.lastDevBuildId)};</script>` : '';
    if (signal?.aborted) return;
    const themeId = resolveThemeId(opts.searchParams, opts.cookieHeader);
    const themeBoot = themeBootstrapScript();
    const localeBoot = localeBootstrapScript();
    const faviconHead = siteFaviconHeadHtml();
    const propsJson = JSON.stringify(props ?? {});
    const localeId = localeCtx.localeId || serveState.localeArtifact?.defaultLocale || 'en';
    const dir = localeCtx.dir || 'ltr';

    const htmlExtraAttrs = [...htmlThemeAttrPair(themeId)];
    if (serveState.localeArtifact?.routing) {
        htmlExtraAttrs.push(
            'data-vmz-locale-routing',
            JSON.stringify({
                strategy: serveState.localeArtifact.routing.strategy || 'prefix',
                defaultPrefix: serveState.localeArtifact.routing.defaultPrefix || 'include',
                defaultLocale: serveState.localeArtifact.defaultLocale,
                locales: (serveState.localeArtifact.locales || []).map((l) => l.id),
            }),
        );
        const hrefTable = localeHrefTableFromPlan(serveState.localeLinkPlan);
        if (hrefTable && Object.keys(hrefTable).length) {
            htmlExtraAttrs.push('data-vmz-locale-hrefs', JSON.stringify(hrefTable));
        }
    }
    const pageDocMeta = resolvePageDocumentMeta(Page);
    const prevLocaleHint = globalThis.__vmzLocaleIdHint;
    globalThis.__vmzLocaleIdHint = localeId;
    if (!serveState.ssrRenderHost) {
        serveState.ssrRenderHost = await createRenderHost(serveState.distDir, {
            strictDeployment: !serveState.isDev,
            preload: 'none',
            cacheBust: serveState.reloadToken,
        });
    }
    await serveState.ssrRenderHost.ensureComponents([chunkId, ...layoutChain]);
    let bodyHtml = '';
    try {
        for await (const chunk of serveState.ssrRenderHost.renderToStream(Page, props, { signal })) {
            if (signal?.aborted) return;
            bodyHtml += chunk;
        }
        if (signal?.aborted) return;
        // Wrap page HTML in layout chain (outer �?inner) via default slot injection.
        for (let i = layoutChain.length - 1; i >= 0; i--) {
            const Layout = await loadPageCtor(layoutChain[i]);
            if (!Layout) continue;
            bodyHtml = await serveState.ssrRenderHost.renderToString(Layout, {}, { signal, slotHtml: bodyHtml });
            if (signal?.aborted) return;
        }
        // Locale discipline: apply frozen link plan rows (0.1.30) �?no path algebra.
        if (serveState.localeArtifact && localeId) {
            bodyHtml = localizeBodyLinks(bodyHtml, localeId, serveState.localeArtifact, undefined, serveState.localeLinkPlan);
        }
    } finally {
        if (prevLocaleHint === undefined) delete globalThis.__vmzLocaleIdHint;
        else globalThis.__vmzLocaleIdHint = prevLocaleHint;
    }
    if (signal?.aborted) return;

    const native = loadNativeAddon();
    if (typeof native.generatePageShell !== 'function') {
        throw new Error('vmz native addon missing generatePageShell �?rebuild with `pnpm napi:build`');
    }
    const entrySrc = `/${eventOnlyShell ? 'entry-event.js' : 'entry-client.js'}?t=${serveState.reloadToken}`;
    const cssHref = cssEntryWithBust(serveState.cssEntry);
    yield native.generatePageShell({
        bodyHtml,
        chunkId,
        layoutChain,
        propsJson,
        meta: {
            title: pageDocMeta.title,
            description: pageDocMeta.description,
            canonical: '',
            robots: '',
            lang: localeId,
            dir,
            alternates: localeCtx.alternates || [],
        },
        // napi Option<String>: omit/undefined = None; null is rejected as String
        ...(cssHref ? { cssEntry: cssHref } : {}),
        isErrorDocument: false,
        htmlExtraAttrs,
        headExtraHtml: `${themeBoot}${localeBoot}${faviconHead}`,
        moduleScriptSrc: entrySrc,
        bodyTailHtml: `${live}${bootOverlay}${buildIdBoot}`,
    });
}

serveState.server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${serveState.host}:${serveState.port}`);

    if (url.pathname === '/__vmz/health' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ status: "ok", shuttingDown: serveState.shuttingDown, inFlight: serveState.inFlight }));
        return;
    }
    if (url.pathname === '/__vmz/ready' && req.method === 'GET') {
        if (!serveState.ready || serveState.shuttingDown) {
            res.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
            res.end(JSON.stringify({ status: "not-ready", ready: serveState.ready, shuttingDown: serveState.shuttingDown }));
            return;
        }
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ status: "ready", ready: true, inFlight: serveState.inFlight }));
        return;
    }

    if (serveState.shuttingDown) {
        res.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ status: 'shutting-down' }));
        return;
    }

    serveState.inFlight += 1;
    let settled = false;
    const done = () => {
        if (settled) return;
        settled = true;
        serveState.inFlight = Math.max(0, serveState.inFlight - 1);
    };
    res.on('finish', done);
    res.on('close', done);

    if (url.pathname === '/__vmz/reload' && req.method === 'POST') {
        readRequestBody(req)
            .then((raw) => {
                let payload: Record<string, unknown> = {};
                try {
                    payload = raw ? (JSON.parse(String(raw)) as Record<string, unknown>) : {};
                } catch {
                    payload = {};
                }
                return softReload({ payload });
            })
            .then((info) => {
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ ok: true, token: serveState.reloadToken, ...info }));
            })
            .catch((err) => {
                console.error('vmz serve: soft reload failed', err);
                serveState.lastDevError = normalizeDevError(err);
                notifySse(
                    JSON.stringify({
                        type: 'error',
                        message: serveState.lastDevError.message,
                        stack: serveState.lastDevError.stack,
                        at: serveState.lastDevError.at,
                    }),
                );
                res.writeHead(500, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: serveState.lastDevError.message }));
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
        serveState.sseClients.add(res);
        req.on('close', () => {
            serveState.sseClients.delete(res);
        });
        return;
    }
    handleNodeRequest(req, res, { distDir: serveState.distDir, renderPage, renderPageStream });
});

serveState.server.listen(serveState.port, serveState.host, () => {
    console.log(`vmz serve http://${serveState.host}:${serveState.port} (dist=${serveState.distDir}${serveState.isDev ? ', dev' : ''})`);
});

process.on('SIGTERM', () => {
    void gracefulShutdown('SIGTERM');
});
process.on('SIGINT', () => {
    void gracefulShutdown('SIGINT');
});

async function gracefulShutdown(signal) {
    if (serveState.shuttingDown) return;
    serveState.shuttingDown = true;
    serveState.ready = false;
    console.log(`vmz serve: ${signal} �?draining in-flight=${serveState.inFlight} timeout=${SHUTDOWN_TIMEOUT_MS}ms`);
    serveState.server?.close();
    const start = Date.now();
    while (serveState.inFlight > 0 && Date.now() - start < SHUTDOWN_TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, 25));
    }
    for (const client of serveState.sseClients) {
        try {
            client.end();
        } catch {
            /* ignore */
        }
    }
    serveState.sseClients.clear();
    process.exit(serveState.inFlight > 0 ? 1 : 0);
}

function attachLinkRouteAliases(artifact, dir) {
    if (!artifact || typeof artifact !== 'object') return artifact;
    try {
        const dep = JSON.parse(readFileSync(path.join(dir, 'vmz-deployment.json'), 'utf8'));
        const aliases = linkRouteAliasesFromUnits(Array.isArray(dep.units) ? dep.units : []);
        if (!aliases.length) return artifact;
        return { ...artifact, linkRouteAliases: aliases };
    } catch {
        return artifact;
    }
}

async function softReload(opts: any = {}) {
    const prevToken = serveState.reloadToken;
    const prevCatalog = serveState.pageCatalog;
    const prevCtors = new Map(serveState.pageCtors);
    const nextToken = Date.now();
    serveState.reloadToken = nextToken;
    const affected = opts.payload?.affectedChunks ?? [];
    const seeds = opts.payload?.seedChunks ?? [];
    const full = opts.payload?.full;
    const islandHmr = Boolean(opts.payload?.islandHmr);
    const rerunLoaders = opts.payload?.rerunLoaders ?? [];
    const skipEntryRewrite = Boolean(opts.payload?.skipEntryRewrite);
    const buildId = opts.payload?.buildId != null ? String(opts.payload.buildId) : null;
    const sourceRevision = opts.payload?.sourceRevision != null ? String(opts.payload.sourceRevision) : null;
    const bundleRevision = opts.payload?.bundleRevision != null ? String(opts.payload.bundleRevision) : null;
    if (buildId) serveState.lastDevBuildId = buildId;
    // 0.1.31: payload-only scope. `serveState.reloadToken` is opaque cache-bust �?never invent full/affected here.
    const reloadAllPages = Boolean(full) || (!islandHmr && rerunLoaders.length === 0 && affected.length === 0);

    try {
        try {
            const routes = JSON.parse(await readFile(path.join(serveState.distDir, 'vmz-routes.json'), 'utf8'));
            setRoutes(routes);
        } catch {
            setRoutes([]);
        }
        try {
            serveState.localeArtifact = JSON.parse(await readFile(path.join(serveState.distDir, '_vmz', 'locale-route-realization.json'), 'utf8'));
            serveState.localeArtifact = attachLinkRouteAliases(serveState.localeArtifact, serveState.distDir);
        } catch {
            serveState.localeArtifact = null;
        }
        try {
            const rawPlan = JSON.parse(await readFile(path.join(serveState.distDir, ...LOCALE_LINK_PLAN_REL.split('/')), 'utf8'));
            serveState.localeLinkPlan = rawPlan?.schema === LOCALE_LINK_PLAN_SCHEMA && Array.isArray(rawPlan.rows) ? rawPlan : null;
        } catch {
            serveState.localeLinkPlan = null;
        }

        const componentEntries = await listClientComponents(serveState.distDir, { strict: !serveState.isDev });
        serveState.ssrRenderHost = await createRenderHost(serveState.distDir, {
            strictDeployment: !serveState.isDev,
            preload: 'none',
            cacheBust: nextToken,
        });
        const nextCatalog = await listPageClientFiles(serveState.distDir);
        // empty catalog throws inside listPageClientFiles

        const nextCtors = new Map();

        if (!islandHmr) {
            const reloadSet =
                rerunLoaders.length > 0
                    ? rerunLoaders
                    : reloadAllPages
                      ? nextCatalog.map((p) => p.chunkId)
                      : nextCatalog.filter((p) => pageNeedsReload(p.chunkId, affected)).map((p) => p.chunkId);
            const pagesToLoad = nextCatalog.filter((p) => reloadSet.includes(p.chunkId));
            for (const p of pagesToLoad) {
                const pageRel = `${p.chunkId}.client.js`;
                const href = bustUrl(pathToFileURL(path.join(serveState.distDir, pageRel)).href);
                const mod = await import(href);
                nextCtors.set(p.chunkId, mod.default);
            }
        }

        serveState.pageCatalog = nextCatalog;
        if (!islandHmr) {
            if (reloadAllPages) {
                serveState.pageCtors.clear();
                for (const [k, v] of nextCtors) serveState.pageCtors.set(k, v);
            } else {
                // Keep unaffected page constructors; only swap what we re-imported.
                for (const [k, v] of nextCtors) serveState.pageCtors.set(k, v);
                // Drop ctors for pages that disappeared from catalog.
                for (const id of [...serveState.pageCtors.keys()]) {
                    if (!nextCatalog.some((p) => p.chunkId === id)) serveState.pageCtors.delete(id);
                }
            }
        }

        const indexChunk = serveState.pageCatalog.find((p) => p.chunkId === 'pages/index')?.chunkId || serveState.pageCatalog[0].chunkId;
        const resumeEntries = await loadPageResumeEntries(serveState.distDir, indexChunk);
        const styleMeta = await loadDeploymentStyle(serveState.distDir);
        serveState.cssEntry = styleMeta.cssEntry;
        serveState.styleBundleHash = styleMeta.styleBundleHash;
        serveState.styleTheme = styleMeta.styleTheme;
        const lazyEventNames = resumeEntries
            .filter((e) => isEventStrategy(e.strategy))
            .map((e) => e.component)
            .filter(Boolean);
        const lazySet = new Set(lazyEventNames);

        await writeFile(
            path.join(serveState.distDir, 'entry-client.js'),
            emitEntryClient(
                componentEntries.filter((e) => !lazySet.has(e.name)),
                componentEntries.filter((e) => lazySet.has(e.name)),
                skipEntryRewrite ? serveState.reloadToken : nextToken,
            ),
            'utf8',
        );

        const strategies = resumeEntries.map((e) => e.strategy);
        const eventOnlyShell = isEventOnlyShell(strategies);
        await writeFile(path.join(serveState.distDir, 'entry-event.js'), emitEntryEvent(skipEntryRewrite ? serveState.reloadToken : nextToken), 'utf8');

        serveState.lastDevError = null;
        const mode = islandHmr ? 'island' : eventOnlyShell ? 'event-shell' : 'full';
        notifySse(
            JSON.stringify({
                type: 'hmr',
                mode,
                affectedChunks: affected,
                seedChunks: seeds,
                token: serveState.reloadToken,
                buildId: buildId || serveState.lastDevBuildId,
                sourceRevision,
                bundleRevision,
                serveRevision: String(serveState.reloadToken),
                full: Boolean(full),
                eventOnlyShell,
            }),
        );
        if (!opts.quiet) {
            const aff = affected.length > 0 ? ` affected=[${affected.join(', ')}]` : full === false ? ' affected=[]' : '';
            const scope = islandHmr ? 'island' : reloadAllPages ? 'all-pages' : `pages=${nextCtors.size}`;
            const bid = buildId || serveState.lastDevBuildId;
            const rev =
                bid || sourceRevision || bundleRevision
                    ? ` buildId=${bid || '-'} source=${sourceRevision || '-'} bundle=${bundleRevision || '-'} serve=${serveState.reloadToken}`
                    : ` t=${serveState.reloadToken}`;
            console.log(`vmz serve: soft reload ok (mode=${mode}; ${scope}; catalog=${serveState.pageCatalog.length};${rev}${aff})`);
        }
        return {
            affectedChunks: affected,
            seedChunks: seeds,
            full: Boolean(full),
            islandHmr,
            mode,
            eventOnlyShell,
            pageCount: serveState.pageCatalog.length,
            reloadedPages: islandHmr ? 0 : nextCtors.size,
            reloadAllPages,
            buildId: buildId || serveState.lastDevBuildId,
            sourceRevision,
            bundleRevision,
            serveRevision: String(serveState.reloadToken),
            token: serveState.reloadToken,
        };
    } catch (err) {
        serveState.reloadToken = prevToken;
        serveState.pageCatalog = prevCatalog;
        serveState.pageCtors.clear();
        for (const [k, v] of prevCtors) serveState.pageCtors.set(k, v);
        serveState.lastDevError = normalizeDevError(err);
        throw err;
    }
}

function pageNeedsReload(chunkId, affected) {
    if (chunkId === 'pages/Layout' || chunkId.endsWith('/Layout')) return true;
    return affected.some((a) => {
        const id = String(a);
        return id === chunkId || chunkId.startsWith(`${id}/`) || id.startsWith(`${chunkId}/`);
    });
}

function notifySse(event) {
    for (const client of [...serveState.sseClients]) {
        try {
            client.write(`data: ${event}\n\n`);
        } catch {
            serveState.sseClients.delete(client);
        }
    }
}

function normalizeDevError(err) {
    if (err && typeof err === 'object') {
        const e = err;
        return {
            message: e.message ? String(e.message) : String(err),
            stack: e.stack ? String(e.stack) : undefined,
            at: Date.now(),
        };
    }
    return { message: String(err), at: Date.now() };
}

async function* emitDevErrorHtml(err) {
    const msg = escapeHtml(err.message || 'Unknown error');
    const stack = err.stack ? escapeHtml(err.stack) : '';
    const style = `<style>
    body{margin:0;background:#0f1115;color:#f4f4f5;font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
    main{max-width:56rem;margin:0 auto;padding:2rem 1.25rem}
    h1{margin:0 0 .75rem;color:#f87171;font-size:1.1rem}
    pre{white-space:pre-wrap;margin:0 0 1rem}
    .hint{opacity:.65;font-size:12px}
  </style>`;
    const body = `${style}
  <main data-vmz-error="500">
    <h1>Dev Error</h1>
    <pre>${msg}</pre>
    ${stack ? `<pre style="opacity:.7;font-size:12px">${stack}</pre>` : ''}
    <p class="hint">Dev host stayed up. Fix the source and save �?soft reload will recover.</p>
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
  </script>`;
    try {
        const native = loadNativeAddon();
        if (typeof native.generateHtmlShell === 'function') {
            yield native.generateHtmlShell({
                title: 'Dev Error',
                lang: 'en',
                cssHrefs: [],
                bodyHtml: body,
                bodyAttrs: [],
            });
            return;
        }
    } catch {
        /* fall through to plain HTML �?never throw from the error page itself */
    }
    yield `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" /><title>Dev Error</title></head><body>${body}</body></html>`;
}

function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function resolveLocalePath(pathname, cookieHeader) {
    const raw = String(pathname || '/');
    const normalized = raw.length > 1 && raw.endsWith('/') ? raw.slice(0, -1) : raw || '/';
    if (!serveState.localeArtifact) {
        return { localeId: 'en', dir: 'ltr', restPath: normalized, redirectTo: null };
    }
    const supported = (serveState.localeArtifact.locales || []).map((l) => l.id);
    const defaultLocale = serveState.localeArtifact.defaultLocale || supported[0] || 'en';
    const directions = Object.fromEntries((serveState.localeArtifact.locales || []).map((l) => [l.id, l.direction || 'ltr']));
    const routing = serveState.localeArtifact.routing || {};
    const strategy = routing.strategy || 'prefix';

    if (strategy === 'none') {
        const preferred = readCookie(cookieHeader, LOCALE_STORE_KEY);
        const localeId = preferred && supported.includes(preferred) ? preferred : defaultLocale;
        return {
            localeId,
            dir: directions[localeId] || 'ltr',
            restPath: normalized,
            redirectTo: null,
        };
    }

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

function pageMetaAlternates(chunkId, localeId) {
    if (!serveState.localeArtifact?.pageMetas) return [];
    const meta =
        serveState.localeArtifact.pageMetas.find((m) => m.routeId === chunkId && m.locale === localeId) ||
        serveState.localeArtifact.pageMetas.find((m) => m.routeId === chunkId && m.locale === serveState.localeArtifact.defaultLocale);
    return Array.isArray(meta?.alternates) ? meta.alternates : [];
}

function bustUrl(href) {
    const u = new URL(href);
    u.searchParams.set('t', String(serveState.reloadToken));
    return u.href;
}

async function loadPageCtor(chunkId) {
    const pageRel = `${chunkId}.client.js`;
    const href = bustUrl(pathToFileURL(path.join(serveState.distDir, pageRel)).href);
    const mod = await import(href);
    serveState.pageCtors.set(chunkId, mod.default);
    return mod.default;
}

async function listPageClientFiles(dir) {
    const fromCatalog = await listPagesFromRouteCatalog(dir);
    if (!fromCatalog.length) {
        if (serveState.isDev) {
            console.warn(`vmz dev: missing compiled ${ROUTE_CATALOG_SCHEMA} at ${path.join(dir, ...ROUTE_CATALOG_REL.split('/'))}`);
            return [];
        }
        throw new Error(`vmz serve: missing compiled ${ROUTE_CATALOG_SCHEMA} at ${path.join(dir, ...ROUTE_CATALOG_REL.split('/'))}`);
    }
    return fromCatalog;
}

async function listPagesFromRouteCatalog(dir) {
    const out = [];
    try {
        const raw = await readFile(path.join(dir, ...ROUTE_CATALOG_REL.split('/')), 'utf8');
        const catalog = JSON.parse(raw);
        if (catalog?.schema !== ROUTE_CATALOG_SCHEMA || !Array.isArray(catalog.pages)) return [];
        for (const page of catalog.pages) {
            const chunkId = String(page?.chunkId || '').replace(/\\/g, '/');
            if (!chunkId.startsWith('pages/')) continue;
            const stem = chunkId.split('/').pop() || '';
            if (isRouteBoundaryStem(stem)) continue;
            const segs = Array.isArray(page?.segs) && page.segs.length ? page.segs : parsePathPattern(String(page?.pathPattern || ''));
            const pageRel = String(page?.pageRel || `${chunkId}.client.js`).replace(/\\/g, '/');
            out.push({
                chunkId,
                pageRel,
                routeId: typeof page?.routeId === 'string' ? page.routeId : chunkId,
                pathPattern: typeof page?.pathPattern === 'string' ? page.pathPattern : undefined,
                segs,
            });
        }
    } catch {
        return [];
    }
    return out;
}

async function runRouteGate(pathname, chunkId) {
    try {
        const href = bustUrl(pathToFileURL(path.join(serveState.distDir, 'vmz-route-gate.mjs')).href);
        const mod = await import(href);
        if (typeof mod.check !== 'function') return null;
        return await mod.check(pathname, chunkId ?? null);
    } catch {
        return null;
    }
}

function emitEntryClient(eager, lazy, token) {
    const q = `?t=${token}`;
    const native = loadNativeAddon();
    if (typeof native.generateServeEntryClient !== 'function') {
        throw new Error('vmz native addon missing generateServeEntryClient �?rebuild with `pnpm napi:build`');
    }
    return native.generateServeEntryClient(eager, lazy, q);
}

function emitEntryEvent(token) {
    const q = `?t=${token}`;
    const native = loadNativeAddon();
    if (typeof native.generateServeEntryEvent !== 'function') {
        throw new Error('vmz native addon missing generateServeEntryEvent �?rebuild with `pnpm napi:build`');
    }
    return native.generateServeEntryEvent(q);
}

function cssEntryWithBust(entry) {
    if (!entry) return undefined;
    const base = String(entry).replace(/^\/+/, '');
    const params = new URLSearchParams();
    params.set('t', String(serveState.reloadToken));
    if (serveState.styleBundleHash) params.set('h', serveState.styleBundleHash);
    return `${base}?${params.toString()}`;
}

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

function resolveThemeId(searchParams, cookieHeader) {
    if (!serveState.styleTheme) return null;
    const ids = serveState.styleTheme.themeIds || [];
    const q = searchParams && typeof searchParams.get === 'function' ? searchParams.get('theme') : null;
    if (q && ids.includes(q)) return q;
    const fromCookie = readCookie(cookieHeader, THEME_STORE_KEY);
    if (fromCookie && ids.includes(fromCookie)) return fromCookie;
    return null;
}

function htmlThemeAttrPair(themeId) {
    if (!serveState.styleTheme || !themeId) return [];
    const attr = serveState.styleTheme.activationAttr || 'data-theme';
    if (!(serveState.styleTheme.themeIds || []).includes(themeId)) return [];
    return [attr, themeId];
}

function themeBootstrapScript() {
    if (!serveState.styleTheme) return '';
    const attr = JSON.stringify(serveState.styleTheme.activationAttr || 'data-theme');
    const ids = JSON.stringify(serveState.styleTheme.themeIds || []);
    const key = JSON.stringify(THEME_STORE_KEY);
    return `  <script>(function(){try{var k=${key},attr=${attr},ids=${ids};var id=localStorage.getItem(k);if(!id||ids.indexOf(id)<0)return;document.documentElement.setAttribute(attr,id);}catch(e){}})();</script>\n`;
}

function localeBootstrapScript() {
    if (!serveState.localeArtifact) return '';
    const routing = serveState.localeArtifact.routing || {};
    if ((routing.strategy || 'prefix') !== 'none') return '';
    const ids = (serveState.localeArtifact.locales || []).map((l) => l.id).filter(Boolean);
    if (!ids.length) return '';
    const key = JSON.stringify(LOCALE_STORE_KEY);
    const idList = JSON.stringify(ids);
    return `  <script>(function(){try{var k=${key},ids=${idList};var id=localStorage.getItem(k);if(!id||ids.indexOf(id)<0)return;document.documentElement.setAttribute("data-locale",id);document.documentElement.setAttribute("lang",id);window.__vmzLocaleIdHint=id;document.cookie=k+"="+encodeURIComponent(id)+"; path=/; max-age=31536000; SameSite=Lax";}catch(e){}})();</script>\n`;
}

function siteFaviconHeadHtml() {
    try {
        const p = path.join(serveState.distDir, '_vmz', 'site-favicon.json');
        if (!existsSync(p)) return '';
        // Sync read: head is per-request; file is tiny and rebuilt with dist.
        const raw = readFileSync(p, 'utf8');
        const j = JSON.parse(raw);
        if (j?.status !== 'ready' || typeof j.headHtml !== 'string') return '';
        return j.headHtml;
    } catch {
        return '';
    }
}

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

async function loadCssEntry(dir) {
    const meta = await loadDeploymentStyle(dir);
    return meta.cssEntry;
}

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

function isEventStrategy(strategy) {
    return strategy === 'event' || strategy === 'click' || strategy.startsWith('event:');
}

function isEventOnlyShell(strategies) {
    if (!strategies.length) return false;
    return strategies.every((s) => isEventStrategy(s));
}

function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
