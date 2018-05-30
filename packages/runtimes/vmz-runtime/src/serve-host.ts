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
import http from 'node:http';
import path from 'node:path';
import { readdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setServerModuleResolver, setRoutes, handleNodeRequest } from './vmz-runtime.js';
import { registerComponents, renderToStream } from './vmz-dom.js';

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
/** @type {Set<import('node:http').ServerResponse>} */
const sseClients = new Set();

setServerModuleResolver((moduleId) => {
    const rel = moduleId.replace(/^#server\//, '') + '.js';
    return bustUrl(pathToFileURL(path.join(distDir, '#server', rel)).href);
});

await softReload({ quiet: true });

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
 * @param {string} pathname
 * @param {{ signal?: AbortSignal, searchParams?: URLSearchParams, cookieHeader?: string }} [opts]
 * @returns {Promise<{ status: number, stream: AsyncGenerator<string, void, void> } | null>}
 */
async function renderPageStream(pathname, opts = {}) {
    let match = matchFileRoute(pathname, pageCatalog);
    let status = 200;

    const gated = await runRouteGate(pathname, match?.chunkId);
    if (gated === 'not_found') {
        match = findRootCatchAll(pageCatalog);
        status = 404;
    } else if (!match) {
        match = findRootCatchAll(pageCatalog);
        status = 404;
    } else if (isRootCatchAll(match)) {
        status = 404;
    }

    if (!match) return null;
    const Page = await loadPageCtor(match.chunkId);
    if (!Page) return null;
    const resumeEntries = await loadPageResumeEntries(distDir, match.chunkId);
    const strategies = resumeEntries.map((e) => e.strategy);
    const eventOnlyShell = isEventOnlyShell(strategies);
    return {
        status,
        stream: emitPageHtml(Page, match.chunkId, eventOnlyShell, opts),
    };
}

/**
 * @param {any} Page
 * @param {string} chunkId
 * @param {boolean} eventOnlyShell
 * @param {{ signal?: AbortSignal, searchParams?: URLSearchParams, cookieHeader?: string }} [opts]
 */
async function* emitPageHtml(Page, chunkId, eventOnlyShell, opts = {}) {
    const signal = opts.signal;
    const live = isDev
        ? `\n  <script>
  (() => {
    const es = new EventSource("/__vmz/events");
    es.onmessage = async (ev) => {
      let msg = null;
      try { msg = JSON.parse(ev.data); } catch { /* plain string */ }
      if (!msg || msg.type !== "hmr") {
        if (ev.data === "reload") location.reload();
        return;
      }
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
            await hydrate(pageMod.default, root, {}, { preserveState: true, skipOnMount: true });
          } else {
            location.reload();
          }
        } catch (err) {
          console.error("vmz island HMR failed", err);
          location.reload();
        }
        return;
      }
      location.reload();
    };
  })();
  </script>`
        : '';
    if (signal?.aborted) return;
    const themeId = resolveThemeId(opts.searchParams, opts.cookieHeader);
    const htmlTheme = htmlThemeAttributeForId(themeId);
    const themeBoot = themeBootstrapScript();
    const cssLink = cssEntry ? `  <link rel="stylesheet" href="/${String(cssEntry).replace(/^\/+/, '')}?t=${reloadToken}" />\n` : '';
    yield `<!DOCTYPE html>
<html lang="en"${htmlTheme}>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>VMZ</title>
${themeBoot}${cssLink}</head>
<body>
  <div id="app" data-vmz-page="${escapeAttr(chunkId)}">`;
    for await (const chunk of renderToStream(Page, {}, { signal })) {
        if (signal?.aborted) return;
        yield chunk;
    }
    if (signal?.aborted) return;
    yield `</div>
  <script type="module" src="/${eventOnlyShell ? 'entry-event.js' : 'entry-client.js'}?t=${reloadToken}"></script>${live}
</body>
</html>`;
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${host}:${port}`);
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
                res.writeHead(500, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: String(err) }));
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

/**
 * Re-import routes / pages / components with a new cache-bust token.
 * Keeps the HTTP server process alive (no Node restart).
 * @param {{ quiet?: boolean, payload?: { affectedChunks?: string[], seedChunks?: string[], full?: boolean, islandHmr?: boolean } }} [opts]
 */
async function softReload(opts = {}) {
    reloadToken = Date.now();
    const affected = opts.payload?.affectedChunks ?? [];
    const seeds = opts.payload?.seedChunks ?? [];
    const full = opts.payload?.full;
    const islandHmr = Boolean(opts.payload?.islandHmr);

    try {
        const routes = JSON.parse(await readFile(path.join(distDir, 'vmz-routes.json'), 'utf8'));
        setRoutes(routes);
    } catch {
        setRoutes([]);
    }

    const componentEntries = await listClientComponents(distDir);
    const componentNames = componentEntries.map((e) => e.name);
    pageCatalog = await listPageClientFiles(distDir);
    if (!pageCatalog.length) {
        throw new Error(`vmz serve: no pages/**/*.client.js in ${distDir}`);
    }
    pageCtors.clear();

    /** @type {Record<string, any>} */
    const components = {};
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
    if (Object.keys(components).length) {
        registerComponents(components);
    }

    if (!islandHmr) {
        for (const p of pageCatalog) {
            await loadPageCtor(p.chunkId);
        }
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
 * @param {string} chunkId
 */
function parseChunkSegments(chunkId) {
    const rel = chunkId.replace(/^pages\//, '');
    const parts = rel.split('/').filter(Boolean);
    /** @type {Array<{ kind: 'static' | 'param' | 'catch', value?: string, name?: string }>} */
    const segs = [];
    for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (p === 'index' && i === parts.length - 1) continue;
        const catchAll = /^\[\.\.\.([^\]]+)\]$/.exec(p);
        const param = /^\[([^\]]+)\]$/.exec(p);
        if (catchAll) segs.push({ kind: 'catch', name: catchAll[1] });
        else if (param) segs.push({ kind: 'param', name: param[1] });
        else segs.push({ kind: 'static', value: p.toLowerCase() });
    }
    return segs;
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
 * Generated by vmz serve — hydrate matched file-route page (data-vmz-page).
 */
import { registerComponents, hydrate } from ${JSON.stringify(`./vmz-dom.js${q}`)};
${imports}

${map}
${loader}

const root = document.getElementById("app");
if (!root) throw new Error("vmz: missing #app");
const chunkId = root.getAttribute("data-vmz-page");
if (!chunkId) throw new Error("vmz: missing data-vmz-page");
const Page = (await import("./" + chunkId + ".client.js${q}")).default;
await hydrate(Page, root);
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
