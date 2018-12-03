// @ts-nocheck
/**
 * Generic VMZ Node host — SSR Route Graph pages + dist static + RPC/REST.
 *
 * Invoked by `vmz serve` / `vmz dev` (or: node dist/vmz-serve-host.mjs).
 *
 * Pathname matches `vmz-deployment.json` `pathPattern` (explicit `<router>.path`
 * or file-route default). Mini page stems are a different host projection.
 * Not an SPA shell.
 *
 * `VMZ_DEV=1`: POST `/__vmz/reload` soft-reloads modules (cache-bust import);
 * GET `/__vmz/events` SSE notifies the browser:
 * - island HMR → re-import `entry-client.js` (no full document reload)
 * - otherwise → `location.reload`
 *
 * Dev resolve hook propagates `?t=` onto nested relative `file:` imports under
 * dist so soft reload does not keep a stale `lib/*.js` ESM cache entry.
 */

import { existsSync, readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { createRequire, registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { localizeBodyLinks } from './localize-body-links.js';
import { createRenderHost } from './render-host.js';
import { listClientComponents } from './list-client-components.js';
import { loadNativeAddon } from './native-addon.js';
import { resolveRouteLayoutChain } from './route-layout-chain.js';
import { handleNodeRequest, setRoutes, setServerModuleResolver } from './vmz-runtime.js';

const require = createRequire(import.meta.url);

const distDir = process.env.VMZ_DIST ? path.resolve(process.env.VMZ_DIST) : path.dirname(fileURLToPath(import.meta.url));

/** App project root for bare import / JSON resolve (dev SSR ≡ build node_modules). */
function projectRootForResolve() {
    const fromEnv = typeof process.env.VMZ_PROJECT_ROOT === 'string' ? process.env.VMZ_PROJECT_ROOT.trim() : '';
    if (fromEnv) return path.resolve(fromEnv);
    return process.cwd();
}

/** @type {ReturnType<typeof createRequire> | null} */
let appPackageRequire = null;

function appPackageRequireResolve() {
    if (!appPackageRequire) {
        const root = projectRootForResolve();
        const pkg = path.join(root, 'package.json');
        appPackageRequire = existsSync(pkg) ? createRequire(pkg) : require;
    }
    return appPackageRequire;
}

/**
 * Dev/prod serve-host: resolve workspace peers + JSON imports from the app package root.
 * Dist-relative ESM cannot see app `node_modules` without this hook.
 */
function installAppModuleResolveHooks() {
    registerHooks({
        resolve(specifier, context, nextResolve) {
            if (
                !specifier ||
                specifier.startsWith('.') ||
                specifier.startsWith('node:') ||
                specifier.startsWith('file:') ||
                specifier.startsWith('#')
            ) {
                return nextResolve(specifier, context);
            }
            try {
                const resolved = appPackageRequireResolve().resolve(specifier);
                return { url: pathToFileURL(resolved).href, shortCircuit: true };
            } catch {
                return nextResolve(specifier, context);
            }
        },
        load(url, context, nextLoad) {
            const pathOnly = url.split('?')[0].split('#')[0];
            if (!pathOnly.endsWith('.json')) return nextLoad(url, context);
            try {
                const filePath = fileURLToPath(pathOnly);
                const raw = readFileSync(filePath, 'utf8');
                return {
                    format: 'module',
                    shortCircuit: true,
                    source: `export default ${raw}`,
                };
            } catch {
                return nextLoad(url, context);
            }
        },
    });
}

installAppModuleResolveHooks();

const host = process.env.VMZ_HOST || '127.0.0.1';
const port = Number(process.env.VMZ_PORT || process.env.PORT || 5173);
const isDev = process.env.VMZ_DEV === '1' || process.env.VMZ_DEV === 'true';

// Absolute origin for in-process client graphs that fall back to HTTP RPC
// (separate `dist/vmz-runtime.js` instance without setServerModuleResolver).
globalThis.__VMZ_RPC_ORIGIN = `http://${host}:${port}`;

/**
 * Soft reload only busts the top-level `import(page?t=token)`. Nested relative
 * imports (`../../lib/units.js`) keep the first-loaded ESM cache entry — so a
 * page can demand exports that the stale dep never had (or vice versa).
 * Propagate `t` from parentURL onto file: children under this dist.
 */
if (isDev) {
    const distUrlPrefix = pathToFileURL(distDir.endsWith(path.sep) ? distDir : `${distDir}${path.sep}`).href;
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
                    if (!fileURLToPath(result.url).startsWith(distDir)) return result;
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

/** @type {number} */
let reloadToken = Date.now();
/** @type {Awaited<ReturnType<typeof createRenderHost>> | null} */
let ssrRenderHost = null;
/** @type {string | null} Correlatable build id from vmz dev (Living §12.8). */
let lastDevBuildId = null;
/** @type {Array<{ chunkId: string, pageRel: string, segs: ReturnType<typeof parsePathPattern> }>} */
let pageCatalog = [];
/** @type {Map<string, any>} */
const pageCtors = new Map();
/** Stylesheet from deployment `cssEntry` (e.g. vmz.css). */
let cssEntry = null;
/** Fingerprint of style inputs — busts `@import` siblings when tokens change (VMZ-8). */
let styleBundleHash = null;
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
    try {
        return await renderPageStreamInner(pathname, opts);
    } catch (err) {
        const normalized = normalizeDevError(err);
        lastDevError = normalized;
        console.error('vmz serve: renderPageStream failed', normalized.message);
        return { status: 500, stream: emitDevErrorHtml(normalized) };
    }
}

/**
 * @param {string} pathname
 * @param {{ signal?: AbortSignal, searchParams?: URLSearchParams, cookieHeader?: string, method?: string, body?: unknown }} [opts]
 * @returns {Promise<{ status: number, stream?: AsyncGenerator<string, void, void>, redirect?: string, headers?: Record<string, string> } | null>}
 */
async function renderPageStreamInner(pathname, opts = {}) {
    if (isDev && lastDevError && pageCtors.size === 0) {
        return { status: 500, stream: emitDevErrorHtml(lastDevError) };
    }

    const localePlan = resolveLocalePath(pathname, opts.cookieHeader);
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
    const layoutChain = resolveRouteLayoutChain(distDir, match.chunkId);
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
    const native = loadNativeAddon();
    if (typeof native.generateHtmlShell !== 'function') {
        throw new Error('vmz native addon missing generateHtmlShell — rebuild with `pnpm napi:build`');
    }
    yield native.generateHtmlShell({
        title: 'App',
        lang: 'en',
        cssHrefs: [],
        bodyHtml: `<p>${marker}</p>`,
        bodyAttrs: [],
    });
}

/**
 * Prefer page `static meta()` for document title/description — never brand the framework in business HTML.
 * @param {any} Page
 */
function resolvePageDocumentMeta(Page) {
    try {
        let raw = {};
        if (typeof Page?.meta === 'function') raw = Page.meta() || {};
        else if (Page?.meta && typeof Page.meta === 'object') raw = Page.meta;
        const title = String(raw.title || '').trim();
        const description = String(raw.description || '').trim();
        return { title: title || 'App', description };
    } catch {
        return { title: 'App', description: '' };
    }
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
    let sawDisconnect = false;
    es.onerror = () => { sawDisconnect = true; };
    es.onopen = () => {
      // Host respawn drops SSE — reload once the new process is up (no manual restart).
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
              `d.innerHTML="<div style='max-width:56rem;margin:0 auto'><p style='color:#f87171;font-weight:700'>Dev Error</p><pre style='white-space:pre-wrap'>"+String(e.message||e).replace(/[<>&]/g,function(c){return {"<":"&lt;",">":"&gt;","&":"&amp;"}[c]})+"</pre></div>";` +
              `document.documentElement.appendChild(d);})();</script>`
            : '';
    const buildIdBoot = isDev && lastDevBuildId ? `\n  <script>window.__VMZ_DEV_BUILD_ID__=${JSON.stringify(lastDevBuildId)};</script>` : '';
    if (signal?.aborted) return;
    const themeId = resolveThemeId(opts.searchParams, opts.cookieHeader);
    const themeBoot = themeBootstrapScript();
    const localeBoot = localeBootstrapScript();
    const faviconHead = siteFaviconHeadHtml();
    const propsJson = JSON.stringify(props ?? {});
    const localeId = localeCtx.localeId || localeArtifact?.defaultLocale || 'en';
    const dir = localeCtx.dir || 'ltr';
    /** @type {string[]} */
    const htmlExtraAttrs = [...htmlThemeAttrPair(themeId)];
    if (localeArtifact?.routing) {
        htmlExtraAttrs.push(
            'data-vmz-locale-routing',
            JSON.stringify({
                strategy: localeArtifact.routing.strategy || 'prefix',
                defaultPrefix: localeArtifact.routing.defaultPrefix || 'include',
                defaultLocale: localeArtifact.defaultLocale,
                locales: (localeArtifact.locales || []).map((l) => l.id),
            }),
        );
    }
    const pageDocMeta = resolvePageDocumentMeta(Page);
    const prevLocaleHint = globalThis.__vmzLocaleIdHint;
    globalThis.__vmzLocaleIdHint = localeId;
    if (!ssrRenderHost) {
        ssrRenderHost = await createRenderHost(distDir, {
            strictDeployment: !isDev,
            preload: 'none',
            cacheBust: reloadToken,
        });
    }
    await ssrRenderHost.ensureComponents([chunkId, ...layoutChain]);
    let bodyHtml = '';
    try {
        for await (const chunk of ssrRenderHost.renderToStream(Page, props, { signal })) {
            if (signal?.aborted) return;
            bodyHtml += chunk;
        }
        if (signal?.aborted) return;
        // Wrap page HTML in layout chain (outer → inner) via default slot injection.
        for (let i = layoutChain.length - 1; i >= 0; i--) {
            const Layout = await loadPageCtor(layoutChain[i]);
            if (!Layout) continue;
            bodyHtml = await ssrRenderHost.renderToString(Layout, {}, { signal, slotHtml: bodyHtml });
            if (signal?.aborted) return;
        }
        // Locale discipline: same-app Links retain current LocaleId (realization authority).
        if (localeArtifact && localeId) {
            bodyHtml = localizeBodyLinks(bodyHtml, localeId, localeArtifact);
        }
    } finally {
        if (prevLocaleHint === undefined) delete globalThis.__vmzLocaleIdHint;
        else globalThis.__vmzLocaleIdHint = prevLocaleHint;
    }
    if (signal?.aborted) return;

    const native = loadNativeAddon();
    if (typeof native.generatePageShell !== 'function') {
        throw new Error('vmz native addon missing generatePageShell — rebuild with `pnpm napi:build`');
    }
    const entrySrc = `/${eventOnlyShell ? 'entry-event.js' : 'entry-client.js'}?t=${reloadToken}`;
    const cssHref = cssEntryWithBust(cssEntry);
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
 * @param {{ quiet?: boolean, payload?: { affectedChunks?: string[], seedChunks?: string[], emitted?: string[], full?: boolean, islandHmr?: boolean, buildId?: string, sourceRevision?: string, bundleRevision?: string, changed?: string[] } }} [opts]
 */
async function softReload(opts = {}) {
    const prevToken = reloadToken;
    const prevCatalog = pageCatalog;
    const prevCtors = new Map(pageCtors);
    const nextToken = Date.now();
    reloadToken = nextToken;
    const affected = opts.payload?.affectedChunks ?? [];
    const seeds = opts.payload?.seedChunks ?? [];
    const emitted = opts.payload?.emitted ?? [];
    const full = opts.payload?.full;
    const islandHmr = Boolean(opts.payload?.islandHmr);
    const buildId = opts.payload?.buildId != null ? String(opts.payload.buildId) : null;
    const sourceRevision = opts.payload?.sourceRevision != null ? String(opts.payload.sourceRevision) : null;
    const bundleRevision = opts.payload?.bundleRevision != null ? String(opts.payload.bundleRevision) : null;
    if (buildId) lastDevBuildId = buildId;
    const reloadAllPages = shouldReloadAllPages({ full, affected, emitted, islandHmr });

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

        const componentEntries = await listClientComponents(distDir, { strict: !isDev });
        ssrRenderHost = await createRenderHost(distDir, {
            strictDeployment: !isDev,
            preload: 'none',
            cacheBust: nextToken,
        });
        const nextCatalog = await listPageClientFiles(distDir);
        // empty catalog throws inside listPageClientFiles

        /** @type {Map<string, any>} */
        const nextCtors = new Map();

        if (!islandHmr) {
            const pagesToLoad = reloadAllPages ? nextCatalog : nextCatalog.filter((p) => pageNeedsReload(p.chunkId, affected));
            for (const p of pagesToLoad) {
                const pageRel = `${p.chunkId}.client.js`;
                const href = bustUrl(pathToFileURL(path.join(distDir, pageRel)).href);
                const mod = await import(href);
                nextCtors.set(p.chunkId, mod.default);
            }
        }

        pageCatalog = nextCatalog;
        if (!islandHmr) {
            if (reloadAllPages) {
                pageCtors.clear();
                for (const [k, v] of nextCtors) pageCtors.set(k, v);
            } else {
                // Keep unaffected page constructors; only swap what we re-imported.
                for (const [k, v] of nextCtors) pageCtors.set(k, v);
                // Drop ctors for pages that disappeared from catalog.
                for (const id of [...pageCtors.keys()]) {
                    if (!nextCatalog.some((p) => p.chunkId === id)) pageCtors.delete(id);
                }
            }
        }

        const indexChunk = pageCatalog.find((p) => p.chunkId === 'pages/index')?.chunkId || pageCatalog[0].chunkId;
        const resumeEntries = await loadPageResumeEntries(distDir, indexChunk);
        const styleMeta = await loadDeploymentStyle(distDir);
        cssEntry = styleMeta.cssEntry;
        styleBundleHash = styleMeta.styleBundleHash;
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
                buildId: buildId || lastDevBuildId,
                sourceRevision,
                bundleRevision,
                serveRevision: String(reloadToken),
                full: Boolean(full),
                eventOnlyShell,
            }),
        );
        if (!opts.quiet) {
            const aff = affected.length > 0 ? ` affected=[${affected.join(', ')}]` : full === false ? ' affected=[]' : '';
            const scope = islandHmr ? 'island' : reloadAllPages ? 'all-pages' : `pages=${nextCtors.size}`;
            const bid = buildId || lastDevBuildId;
            const rev =
                bid || sourceRevision || bundleRevision
                    ? ` buildId=${bid || '-'} source=${sourceRevision || '-'} bundle=${bundleRevision || '-'} serve=${reloadToken}`
                    : ` t=${reloadToken}`;
            console.log(`vmz serve: soft reload ok (mode=${mode}; ${scope}; catalog=${pageCatalog.length};${rev}${aff})`);
        }
        return {
            affectedChunks: affected,
            seedChunks: seeds,
            full: Boolean(full),
            islandHmr,
            mode,
            eventOnlyShell,
            pageCount: pageCatalog.length,
            reloadedPages: islandHmr ? 0 : nextCtors.size,
            reloadAllPages,
            buildId: buildId || lastDevBuildId,
            sourceRevision,
            bundleRevision,
            serveRevision: String(reloadToken),
            token: reloadToken,
        };
    } catch (err) {
        reloadToken = prevToken;
        pageCatalog = prevCatalog;
        pageCtors.clear();
        for (const [k, v] of prevCtors) pageCtors.set(k, v);
        lastDevError = normalizeDevError(err);
        throw err;
    }
}

/**
 * Shared lib / full rebuild / missing affected list → refresh every page ctor.
 * Otherwise only re-import the dirty page chunks (Vite-like module graph).
 * @param {{ full?: boolean, affected: string[], emitted: string[], islandHmr: boolean }} opts
 */
function shouldReloadAllPages(opts) {
    if (opts.islandHmr) return false;
    if (opts.full) return true;
    if (!opts.affected.length) return true;
    for (const f of opts.emitted) {
        const n = String(f).replace(/\\/g, '/');
        if (n.includes('/lib/') || /\/Application\.client\.js$/.test(n) || /\/vmz-(dom|runtime|http|client-nav)\.js$/.test(n)) {
            return true;
        }
    }
    return false;
}

/** @param {string} chunkId @param {string[]} affected */
function pageNeedsReload(chunkId, affected) {
    if (chunkId === 'pages/Layout' || chunkId.endsWith('/Layout')) return true;
    return affected.some((a) => {
        const id = String(a);
        return id === chunkId || chunkId.startsWith(`${id}/`) || id.startsWith(`${chunkId}/`);
    });
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
        /* fall through to plain HTML — never throw from the error page itself */
    }
    yield `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" /><title>Dev Error</title></head><body>${body}</body></html>`;
}

/** @param {string} s */
function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Resolve LocaleId for this request.
 * - `prefix`: LocaleId from URL path (existing).
 * - `none`: Host preference from cookie `vmz.locale` (validated), else defaultLocale.
 *   URL never carries LocaleId.
 * @param {string} pathname
 * @param {string | undefined} cookieHeader
 */
function resolveLocalePath(pathname, cookieHeader) {
    const raw = String(pathname || '/');
    const normalized = raw.length > 1 && raw.endsWith('/') ? raw.slice(0, -1) : raw || '/';
    if (!localeArtifact) {
        return { localeId: 'en', dir: 'ltr', restPath: normalized, redirectTo: null };
    }
    const supported = (localeArtifact.locales || []).map((l) => l.id);
    const defaultLocale = localeArtifact.defaultLocale || supported[0] || 'en';
    const directions = Object.fromEntries((localeArtifact.locales || []).map((l) => [l.id, l.direction || 'ltr']));
    const routing = localeArtifact.routing || {};
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
 * Discover compiled page modules from Route Graph `pathPattern` in
 * `vmz-deployment.json` only (plan-only host — no `pages/**` walk).
 * @param {string} dir
 */
async function listPageClientFiles(dir) {
    const fromDep = await listPagesFromDeployment(dir);
    if (!fromDep.length) {
        throw new Error(
            `vmz serve: no page units with pathPattern in ${path.join(dir, 'vmz-deployment.json')} (plan-only host)`,
        );
    }
    return fromDep;
}

/**
 * @param {string} dir
 */
async function listPagesFromDeployment(dir) {
    /** @type {Array<{ chunkId: string, pageRel: string, segs: ReturnType<typeof parsePathPattern> }>} */
    const out = [];
    try {
        const raw = await readFile(path.join(dir, 'vmz-deployment.json'), 'utf8');
        const dep = JSON.parse(raw);
        for (const unit of dep.units || []) {
            if (unit?.kind !== 'page') continue;
            const chunkId = String(unit.chunkId || '').replace(/\\/g, '/');
            if (!chunkId.startsWith('pages/')) continue;
            const stem = chunkId.split('/').pop() || '';
            if (isRouteBoundaryStem(stem)) continue;
            const pattern = String(unit.pathPattern || '').trim();
            if (!pattern) {
                throw new Error(
                    `vmz serve: page unit ${chunkId} missing pathPattern in vmz-deployment.json (plan-only host)`,
                );
            }
            const pageRel = String(unit.clientEntry || `${chunkId}.client.js`).replace(/\\/g, '/');
            out.push({
                chunkId,
                pageRel,
                segs: parsePathPattern(pattern),
            });
        }
    } catch (err) {
        if (err && typeof err.message === 'string' && err.message.includes('plan-only host')) throw err;
        return [];
    }
    return out;
}

/**
 * Browser HTTP pattern (`/` / `/home` / `/users/:id` / `/blog/[...slug]`).
 * @param {string} pattern
 */
function parsePathPattern(pattern) {
    const raw = String(pattern || '').trim();
    if (!raw || raw === '/') return [];
    const parts = raw.replace(/^\/+/, '').split('/').filter(Boolean);
    /** @type {Array<{ kind: 'static' | 'param' | 'catch', value?: string, name?: string }>} */
    const segs = [];
    for (const p of parts) {
        if (isRouteGroupDir(p)) continue;
        segs.push(parsePathSegment(p));
    }
    return segs;
}

/**
 * @param {string} p
 */
function parsePathSegment(p) {
    const catchAll = /^\[\.\.\.([^\]]+)\]$/.exec(p);
    const param = /^\[([^\]]+)\]$/.exec(p);
    const colon = /^:([A-Za-z_][\w]*)$/.exec(p);
    if (catchAll) return { kind: 'catch', name: catchAll[1] };
    if (param) return { kind: 'param', name: param[1] };
    if (colon) return { kind: 'param', name: colon[1] };
    return { kind: 'static', value: p.toLowerCase() };
}

function isRouteGroupDir(seg) {
    return typeof seg === 'string' && seg.startsWith('(') && seg.endsWith(')') && seg.length > 2;
}

function isRouteBoundaryStem(stem) {
    return stem === 'Layout' || stem === 'Loading' || stem === 'Error' || stem === 'NotFound';
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
 * @param {ReturnType<typeof parsePathPattern>} segs
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
 * @param {ReturnType<typeof parsePathPattern>} segs
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
    const native = loadNativeAddon();
    if (typeof native.generateServeEntryClient !== 'function') {
        throw new Error('vmz native addon missing generateServeEntryClient — rebuild with `pnpm napi:build`');
    }
    return native.generateServeEntryClient(eager, lazy, q);
}

/**
 * EventEntry zero-framework bootstrap: no static import of vmz-dom / page / islands.
 * Framework bytes load only inside the first matching DOM event handler.
 * @param {number} token
 */
function emitEntryEvent(token) {
    const q = `?t=${token}`;
    const native = loadNativeAddon();
    if (typeof native.generateServeEntryEvent !== 'function') {
        throw new Error('vmz native addon missing generateServeEntryEvent — rebuild with `pnpm napi:build`');
    }
    return native.generateServeEntryEvent(q);
}

/**
 * Style Theme cookie / localStorage key (host contract, not a second theme API).
 */
const THEME_STORE_KEY = 'vmz-theme';
/** Host preference key for `routing.strategy: 'none'` (cookie + localStorage). */
const LOCALE_STORE_KEY = 'vmz.locale';

/**
 * Cache-bust stylesheet entry for dev reload (token + serve revision).
 * @param {string | null | undefined} entry
 */
function cssEntryWithBust(entry) {
    if (!entry) return undefined;
    const base = String(entry).replace(/^\/+/, '');
    const params = new URLSearchParams();
    params.set('t', String(reloadToken));
    if (styleBundleHash) params.set('h', styleBundleHash);
    return `${base}?${params.toString()}`;
}

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
 * @returns {[string, string] | []} flattened attr pair for generatePageShell
 */
function htmlThemeAttrPair(themeId) {
    if (!styleTheme || !themeId) return [];
    const attr = styleTheme.activationAttr || 'data-theme';
    if (!(styleTheme.themeIds || []).includes(themeId)) return [];
    return [attr, themeId];
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
 * LocaleId as client state (routing.strategy = none): apply localStorage before any
 * page/client module runs so `#locales/*` pick the right variant. Prefix strategy
 * keeps LocaleId in the URL — no boot rewrite.
 * Also mirrors into cookie so the next SSR negotiate sees Host preference.
 */
function localeBootstrapScript() {
    if (!localeArtifact) return '';
    const routing = localeArtifact.routing || {};
    if ((routing.strategy || 'prefix') !== 'none') return '';
    const ids = (localeArtifact.locales || []).map((l) => l.id).filter(Boolean);
    if (!ids.length) return '';
    const key = JSON.stringify(LOCALE_STORE_KEY);
    const idList = JSON.stringify(ids);
    return `  <script>(function(){try{var k=${key},ids=${idList};var id=localStorage.getItem(k);if(!id||ids.indexOf(id)<0)return;document.documentElement.setAttribute("data-locale",id);document.documentElement.setAttribute("lang",id);window.__vmzLocaleIdHint=id;document.cookie=k+"="+encodeURIComponent(id)+"; path=/; max-age=31536000; SameSite=Lax";}catch(e){}})();</script>\n`;
}

/**
 * Site favicon links from build artifact `_vmz/site-favicon.json` (author SVG → PNG/ICO).
 * Empty when skipped / missing — do not invent broken <link>s.
 */
function siteFaviconHeadHtml() {
    try {
        const p = path.join(distDir, '_vmz', 'site-favicon.json');
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
