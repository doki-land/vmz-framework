import type { ClosedAccessResult, HostRequestOpts, LocaleHostCtx } from '../../shared/host.types.js';
import { localeHrefTableFromPlan, localizeBodyLinks } from '../localize-body-links.js';
import { loadNativeAddon } from '../native-addon.js';
import { createRenderHost } from '../render/render-host.js';
import { resolveRouteLayoutChain } from '../render/route-layout-chain.js';
import { extractRouteParams, findRootCatchAll, isRootCatchAll, matchFileRoute } from './route-catalog.js';
import { emitDevErrorHtml, normalizeDevError } from './hmr-dev.js';
import {
    cssEntryWithBust,
    htmlThemeAttrPair,
    localeBootstrapScript,
    pageMetaAlternates,
    resolveLocalePath,
    resolveThemeId,
    siteFaviconHeadHtml,
    themeBootstrapScript,
} from './locale-theme.js';
import {
    isEventOnlyShell,
    loadPageCtor,
    loadPageResumeEntries,
    runRouteGate,
} from './page-catalog.js';
import { serveState } from './state.js';

export async function renderPage(pathname: string, opts: HostRequestOpts = {}) {
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

export async function renderPageStream(pathname: string, opts: HostRequestOpts & { body?: unknown } = {}) {
    try {
        return await renderPageStreamInner(pathname, opts);
    } catch (err) {
        const normalized = normalizeDevError(err);
        serveState.lastDevError = normalized;
        console.error('vmz serve: renderPageStream failed', normalized.message);
        return { status: 500, stream: emitDevErrorHtml(normalized) };
    }
}

async function renderPageStreamInner(pathname: string, opts: HostRequestOpts & { body?: unknown } = {}) {
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
    } satisfies LocaleHostCtx & { pathname: string; routePath: string };

    const pageCtor = Page as {
        access?: (ctx: Record<string, unknown>) => Promise<unknown>;
        action?: (ctx: Record<string, unknown>) => Promise<unknown>;
        load?: (ctx: Record<string, unknown>) => Promise<unknown>;
        meta?: (() => Record<string, unknown>) | Record<string, unknown>;
    };

    if (typeof pageCtor.access === 'function') {
        const access = await pageCtor.access({
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

    let props: Record<string, unknown> = { ...params };
    if (method === 'POST' && typeof pageCtor.action === 'function') {
        const acted = await pageCtor.action({
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

    if (typeof pageCtor.load === 'function') {
        const loaded = await pageCtor.load({
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
            props = { ...props, ...(loaded as Record<string, unknown>) };
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

async function* emitAccessShell(marker: string) {
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
    Page: unknown,
    chunkId: string,
    eventOnlyShell: boolean,
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
          const { hydrate } = await import("/dom.browser.js?t=" + msg.token);
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
        serveState.isDev && serveState.lastDevError
            ? `\n  <script>window.__VMZ_DEV_ERROR__=${JSON.stringify(serveState.lastDevError)};` +
              `(function(){var e=window.__VMZ_DEV_ERROR__;if(!e)return;` +
              `var ev=new Event("message");ev.data=JSON.stringify({type:"error",message:e.message,stack:e.stack});` +
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
                locales: (serveState.localeArtifact.locales || []).map((l: { id: string }) => l.id),
            }),
        );
        const hrefTable = localeHrefTableFromPlan(serveState.localeLinkPlan);
        if (hrefTable && Object.keys(hrefTable).length) {
            htmlExtraAttrs.push('data-vmz-locale-hrefs', JSON.stringify(hrefTable));
        }
    }
    const pageDocMeta = resolvePageDocumentMeta(Page as { meta?: (() => Record<string, unknown>) | Record<string, unknown> });
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
        for (let i = layoutChain.length - 1; i >= 0; i--) {
            const Layout = await loadPageCtor(layoutChain[i]);
            if (!Layout) continue;
            bodyHtml = await serveState.ssrRenderHost.renderToString(Layout, {}, { signal, slotHtml: bodyHtml });
            if (signal?.aborted) return;
        }
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
        throw new Error('vmz native addon missing generatePageShell — rebuild with `pnpm napi:build`');
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
        ...(cssHref ? { cssEntry: cssHref } : {}),
        isErrorDocument: false,
        htmlExtraAttrs,
        headExtraHtml: `${themeBoot}${localeBoot}${faviconHead}`,
        moduleScriptSrc: entrySrc,
        bodyTailHtml: `${live}${bootOverlay}${buildIdBoot}`,
    });
}
