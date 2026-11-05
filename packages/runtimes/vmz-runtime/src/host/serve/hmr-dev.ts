import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { listClientComponents } from '../list-client-components.js';
import { LOCALE_LINK_PLAN_SCHEMA, linkRouteAliasesFromUnits } from '../localize-body-links.js';
import { loadNativeAddon } from '../native-addon.js';
import { createRenderHost } from '../render/render-host.js';
import { resolveRouteLayoutChain } from '../render/route-layout-chain.js';
import { setRoutes } from '../../faces/vmz-runtime.js';
import { LOCALE_LINK_PLAN_REL } from './constants.js';
import { loadDeploymentStyle } from './locale-theme.js';
import { bustUrl, isEventOnlyShell, isEventStrategy, listPageClientFiles, loadPageResumeEntries, pageNeedsReload } from './page-catalog.js';
import { packIslandHrefs, type PackIslandHrefs } from './pack-entry.js';
import { serveState } from './state.js';

export function installDevImportTokenHooks() {
    if (!serveState.isDev) return;
    const distUrlPrefix = pathToFileURL(serveState.distDir.endsWith(path.sep) ? serveState.distDir : `${serveState.distDir}${path.sep}`).href;
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

function attachLinkRouteAliases(artifact: unknown, dir: string) {
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

export function notifySse(event: string) {
    for (const client of [...serveState.sseClients]) {
        try {
            client.write(`data: ${event}\n\n`);
        } catch {
            serveState.sseClients.delete(client);
        }
    }
}

export function normalizeDevError(err: unknown) {
    if (err && typeof err === 'object') {
        const e = err as { message?: string; stack?: string };
        return {
            message: e.message ? String(e.message) : String(err),
            stack: e.stack ? String(e.stack) : undefined,
            at: Date.now(),
        };
    }
    return { message: String(err), at: Date.now() };
}

export async function* emitDevErrorHtml(err: { message?: string; stack?: string }) {
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
        /* fall through */
    }
    yield `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" /><title>Dev Error</title></head><body>${body}</body></html>`;
}

function escapeHtml(s: string) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * 客户端入口模块由 pack 消费，必须保持内容稳定：每次重建都把 `?t=` 注入
 * 动态 import 会让打包产物每轮都变，也会让浏览器拿到两个不同 URL 的同一模块。
 * 缓存破坏由打包文件名（内容哈希）与 SSE 侧的 reload 负责。
 */
function emitEntryClient(eager: unknown[], lazy: unknown[]) {
    const native = loadNativeAddon();
    if (typeof native.generateServeEntryClient !== 'function') {
        throw new Error('vmz native addon missing generateServeEntryClient — rebuild with `pnpm napi:build`');
    }
    return native.generateServeEntryClient(eager, lazy, '');
}

function emitEntryEvent(eager: unknown[], lazy: unknown[]) {
    const native = loadNativeAddon();
    if (typeof native.generateServeEntryEvent !== 'function') {
        throw new Error('vmz native addon missing generateServeEntryEvent — rebuild with `pnpm napi:build`');
    }
    return native.generateServeEntryEvent(eager, lazy, '');
}

interface PreparedReload {
    info: Record<string, unknown>;
    sse: Record<string, unknown>;
    logLine: string | null;
}

let pendingReload: PreparedReload | null = null;
let pendingRollback: (() => void) | null = null;

/**
 * 第一阶段：加载构建产物、写客户端入口模块，但**不**发布 SSE、不置 ready。
 *
 * dev 的浏览器交付必须经 `vmz-pack`，而 pack 由 CLI 侧执行（runtime 不反向
 * 依赖 `@vmz/vmz`）。因此先把入口写到 outDir，让调用方 pack，再 `commitReload`。
 */
export async function prepareReload(
    opts: { quiet?: boolean; payload?: Record<string, unknown> } = {},
): Promise<Record<string, unknown>> {
    const prevToken = serveState.reloadToken;
    const prevCatalog = serveState.pageCatalog;
    const prevCtors = new Map(serveState.pageCtors);
    const nextToken = Date.now();
    serveState.reloadToken = nextToken;
    pendingReload = null;
    pendingRollback = () => {
        serveState.reloadToken = prevToken;
        serveState.pageCatalog = prevCatalog;
        serveState.pageCtors.clear();
        for (const [k, v] of prevCtors) serveState.pageCtors.set(k, v);
    };
    const affected = (opts.payload?.affectedChunks as string[]) ?? [];
    const seeds = (opts.payload?.seedChunks as string[]) ?? [];
    const full = opts.payload?.full;
    const islandHmr = Boolean(opts.payload?.islandHmr);
    const rerunLoaders = (opts.payload?.rerunLoaders as string[]) ?? [];
    const buildId = opts.payload?.buildId != null ? String(opts.payload.buildId) : null;
    const sourceRevision = opts.payload?.sourceRevision != null ? String(opts.payload.sourceRevision) : null;
    const bundleRevision = opts.payload?.bundleRevision != null ? String(opts.payload.bundleRevision) : null;
    if (buildId) serveState.lastDevBuildId = buildId;
    const reloadAllPages = Boolean(full) || (!islandHmr && rerunLoaders.length === 0 && affected.length === 0);

    try {
        try {
            const routes = JSON.parse(await readFile(path.join(serveState.distDir, 'vmz-routes.json'), 'utf8'));
            setRoutes(routes);
        } catch {
            setRoutes([]);
        }
        try {
            serveState.localeArtifact = JSON.parse(
                await readFile(path.join(serveState.distDir, '_vmz', 'locale-route-realization.json'), 'utf8'),
            );
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
        const nextCtors = new Map<string, unknown>();

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
                for (const [k, v] of nextCtors) serveState.pageCtors.set(k, v);
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
        const eagerComponents = componentEntries.filter((e) => !lazySet.has(e.name));
        const lazyComponents = componentEntries.filter((e) => lazySet.has(e.name));

        // Bootstrap tables are literal maps keyed by chunkId / island name:
        // page/layout units must be enumerated (name = chunkId, entry =
        // `<chunkId>.client.js`), unknown names throw at runtime by design.
        const pageEntries = serveState.pageCatalog.map((p) => ({ name: p.chunkId, entry: `${p.chunkId}.client.js` }));
        const layoutNames = new Set<string>();
        for (const p of serveState.pageCatalog) {
            try {
                for (const id of resolveRouteLayoutChain(serveState.distDir, p.chunkId)) layoutNames.add(String(id));
            } catch {
                /* page unit without layoutChain in a partial dev build */
            }
        }
        const layoutEntries = [...layoutNames].sort().map((id) => ({ name: id, entry: `${id}.client.js` }));

        await writeFile(
            path.join(serveState.distDir, 'entry-client.js'),
            emitEntryClient([...eagerComponents, ...pageEntries, ...layoutEntries], lazyComponents),
            'utf8',
        );

        const strategies = resumeEntries.map((e) => e.strategy);
        const eventOnlyShell = isEventOnlyShell(strategies);
        await writeFile(
            path.join(serveState.distDir, 'entry-event.js'),
            emitEntryEvent([], lazyComponents),
            'utf8',
        );

        const mode = islandHmr ? 'island' : eventOnlyShell ? 'event-shell' : 'full';
        const info = {
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
        const sse = {
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
        };
        let logLine: string | null = null;
        if (!opts.quiet) {
            const aff = affected.length > 0 ? ` affected=[${affected.join(', ')}]` : full === false ? ' affected=[]' : '';
            const scope = islandHmr ? 'island' : reloadAllPages ? 'all-pages' : `pages=${nextCtors.size}`;
            const bid = buildId || serveState.lastDevBuildId;
            const rev =
                bid || sourceRevision || bundleRevision
                    ? ` buildId=${bid || '-'} source=${sourceRevision || '-'} bundle=${bundleRevision || '-'} serve=${serveState.reloadToken}`
                    : ` t=${serveState.reloadToken}`;
            logLine = `vmz serve: soft reload ok (mode=${mode}; ${scope}; catalog=${serveState.pageCatalog.length};${rev}${aff})`;
        }
        pendingReload = { info, sse, logLine };
        return info;
    } catch (err) {
        pendingRollback?.();
        pendingRollback = null;
        pendingReload = null;
        serveState.lastDevError = normalizeDevError(err);
        throw err;
    }
}

/**
 * 第二阶段：发布 SSE 并置 ready。island 热更新的地址表从 pack manifest 精确
 * 查得（逻辑 `chunkId` → chunk 文件、含 `dom.browser` 的共享 chunk），不做后缀
 * 猜测；查不到即整页 reload。
 */
export function commitReload(): Record<string, unknown> {
    const prepared = pendingReload;
    if (!prepared) throw new Error('commitReload: no prepared reload');
    let island: PackIslandHrefs | null = null;
    if (serveState.isDev) {
        try {
            island = packIslandHrefs(serveState.distDir);
        } catch (err) {
            abortReload(err);
            throw err;
        }
    }
    pendingReload = null;
    pendingRollback = null;
    serveState.lastDevError = null;
    serveState.ready = true;
    notifySse(JSON.stringify({ ...prepared.sse, island }));
    if (prepared.logLine) console.log(prepared.logLine);
    return { ...prepared.info, island };
}

/** pack 失败：回滚到上一轮已发布状态，并以 SSE error 显式告知浏览器。 */
export function abortReload(err: unknown) {
    pendingReload = null;
    pendingRollback?.();
    pendingRollback = null;
    serveState.ready = false;
    serveState.lastDevError = normalizeDevError(err);
    notifySse(
        JSON.stringify({
            type: 'error',
            message: serveState.lastDevError.message,
            stack: serveState.lastDevError.stack,
            at: serveState.lastDevError.at,
        }),
    );
}
