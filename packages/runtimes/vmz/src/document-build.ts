// @ts-nocheck
/**
 * Document Static + Interactive artifacts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { checkDocuments, manifestHasErrors } from './document-check.js';
import { resolveDocumentDesignsCss } from './document-designs.js';
import { enrichDocumentContent, pageHtmlRel } from './document-enrich.js';
import { enrichDocumentEvidence } from './document-evidence.js';
import {
    artifactHrefFromHtml,
    buildDocumentIslands,
    buildDocumentSearch,
    collectFenceBodies,
    renderIslandShellsHtml,
} from './document-interactive.js';
import { assertIntegratedDistReady, renderCompiledDocumentLayout } from './document-layout-render.js';
import { resolveMarkdownEngine } from './document-markdown.js';
import { loadLocalesRouting } from './document-routing-config.js';
import { DOCUMENT_VIEW_SCHEMA } from './document-schema.js';
import { createWorkspace } from './index.js';
import { requireNativeAddon } from './native-addon.js';
import { writePrettyJsonFile } from './pretty-json.js';

/**
 * @param {{ projectRoot: string, outDir?: string, appDistDir?: string, strict?: boolean, engines?: { markdown?: string } }} opts
 */
export async function buildDocuments(opts) {
    const projectRoot = path.resolve(opts.projectRoot);
    const outDir = path.resolve(opts.outDir || path.join(projectRoot, 'dist', 'documents'));
    const strict = Boolean(opts.strict);
    const manifest = checkDocuments({ projectRoot, strict });
    const routing = loadLocalesRouting(projectRoot) || { strategy: 'prefix' };
    const engine = await resolveMarkdownEngine({ engines: opts.engines, projectRoot });
    const enriched = enrichDocumentContent(manifest, {
        analyzeMarkdown: engine.analyzeMarkdown,
        projectRoot,
        routing,
    });
    manifest.diagnostics = enriched.diagnostics;
    const evidence = await enrichDocumentEvidence(manifest, {
        analyzeMarkdown: engine.analyzeMarkdown,
        projectRoot,
        createWorkspace,
    });
    manifest.diagnostics = evidence.diagnostics;
    manifest.evidence = evidence.evidence;
    if (manifestHasErrors(manifest)) {
        return { ok: false, manifest, outDir, pages: [] };
    }

    /** @type {Map<string, any>} */
    const analyzedByPageId = new Map();
    for (const page of manifest.pages) {
        const abs = path.isAbsolute(page.sourcePath) ? page.sourcePath : path.join(manifest.root, page.sourcePath);
        const source = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
        const id = `${page.identity.locale}:${page.identity.pageKey}`;
        analyzedByPageId.set(id, engine.analyzeMarkdown(source));
    }
    const fenceBodies = collectFenceBodies(analyzedByPageId, manifest.pages);
    const search = buildDocumentSearch({
        manifest,
        enriched,
        evidence: evidence.evidence,
        version: null,
    });
    const islands = buildDocumentIslands({
        evidence: evidence.evidence,
        searchHref: 'document.search.json',
        fenceBodies,
    });
    manifest.search = search;
    manifest.islands = islands;

    const integratedMount = (manifest.mounts || []).some((m) => m.mode === 'integrated');
    const appDistDir = resolveAppDistDir(opts, outDir);
    const useCompiledShell = Boolean(integratedMount && appDistDir);
    if (integratedMount && appDistDir) {
        assertIntegratedDistReady(appDistDir);
    }

    fs.mkdirSync(outDir, { recursive: true });
    const designs = resolveDocumentDesignsCss(projectRoot);
    /** @type {string | null} */
    let designsHref = null;
    if (designs.css && designs.href) {
        const cssPath = path.join(outDir, designs.href);
        fs.mkdirSync(path.dirname(cssPath), { recursive: true });
        fs.writeFileSync(cssPath, designs.css, 'utf8');
        designsHref = designs.href;
    }
    const viewsDir = path.join(outDir, 'views');
    fs.mkdirSync(viewsDir, { recursive: true });
    /** @type {Array<{ route: string, htmlPath: string, viewPath: string }>} */
    const written = [];
    for (const page of manifest.pages) {
        const id = `${page.identity.locale}:${page.identity.pageKey}`;
        const info = enriched.byId.get(id);
        if (!info) continue;
        const nav = enriched.navByLocale[page.identity.locale] || [];
        const htmlRel = pageHtmlRel(enriched.routeBase, page.identity.locale, page.identity.pageKey);
        const htmlAbs = path.join(outDir, htmlRel);
        fs.mkdirSync(path.dirname(htmlAbs), { recursive: true });
        const searchIndexHref = artifactHrefFromHtml(htmlRel, 'document.search.json');
        const shells = renderIslandShellsHtml({
            islands,
            searchIndexHref,
            pageKey: page.identity.pageKey,
            locale: page.identity.locale,
        });
        const slotHtml = buildDocumentSlotHtml({
            nav,
            bodyHtml: info.html,
            headings: info.headings,
            htmlRel,
            route: info.route,
            routing,
            searchShellHtml: shells.searchHtml,
            playgroundShellHtml: shells.playgroundHtml,
        });
        let compiledLayoutHtml = null;
        if (useCompiledShell) {
            compiledLayoutHtml = await renderCompiledDocumentLayout(appDistDir, page.identity.locale, slotHtml);
        }
        const view = {
            schema: DOCUMENT_VIEW_SCHEMA,
            pageKey: page.identity.pageKey,
            locale: page.identity.locale,
            route: info.route,
            title: info.title,
            headings: info.headings,
            nav,
            bodyKind: 'html',
            html: info.html,
            designsCss: designsHref,
            noJsReadable: true,
            hydrate: 'island-only',
            hostShell: useCompiledShell ? 'compiled-layout' : false,
            islands: ['DocumentSearch'].concat(
                (islands.islands || [])
                    .filter(
                        (isl) =>
                            isl.kind === 'playground' &&
                            isl.fence?.locale === page.identity.locale &&
                            isl.fence?.pageKey === page.identity.pageKey,
                    )
                    .map((isl) => isl.name),
            ),
        };
        const viewRel = path.posix.join(
            'views',
            page.identity.locale,
            `${page.identity.pageKey === 'index' ? 'index' : page.identity.pageKey}.view.json`,
        );
        const viewAbs = path.join(outDir, viewRel);
        fs.mkdirSync(path.dirname(viewAbs), { recursive: true });
        writePrettyJsonFile(viewAbs, view);
        const html = renderStaticHtml({
            title: info.title,
            locale: page.identity.locale,
            route: info.route,
            nav,
            bodyHtml: info.html,
            headings: info.headings,
            designsHref,
            htmlRel,
            searchShellHtml: shells.searchHtml,
            playgroundShellHtml: shells.playgroundHtml,
            routing,
            compiledLayoutHtml,
            useCompiledShell,
        });
        fs.writeFileSync(htmlAbs, html, 'utf8');
        written.push({ route: info.route, htmlPath: htmlRel, viewPath: viewRel });
    }
    const manifestOut = {
        ...manifest,
        schema: manifest.schema,
        evidence: evidence.evidence,
        search,
        islands,
        build: {
            engine: engine.engine,
            outDir: path.relative(projectRoot, outDir).replace(/\\/g, '/') || '.',
            designs: designs.source,
            designsCss: designsHref,
            hostShell: useCompiledShell ? 'compiled-layout' : 'standalone',
            pages: written,
            evidence: 'document.evidence.json',
            search: 'document.search.json',
            islands: 'document.islands.json',
        },
    };
    writePrettyJsonFile(path.join(outDir, 'document.manifest.json'), manifestOut);
    writePrettyJsonFile(path.join(outDir, 'document.evidence.json'), evidence.evidence);
    writePrettyJsonFile(path.join(outDir, 'document.search.json'), search);
    writePrettyJsonFile(path.join(outDir, 'document.islands.json'), islands);
    return { ok: true, manifest: manifestOut, outDir, pages: written, search, islands };
}

/**
 * @param {{ appDistDir?: string }} opts
 * @param {string} outDir
 */
function resolveAppDistDir(opts, outDir) {
    if (opts.appDistDir) {
        const p = path.resolve(opts.appDistDir);
        return fs.existsSync(path.join(p, 'vmz-dom.js')) ? p : null;
    }
    return fs.existsSync(path.join(outDir, 'vmz-dom.js')) ? outDir : null;
}

/**
 * Document main column + sidebar (injected into DocumentLayout slot).
 */
function buildDocumentSlotHtml({ nav, bodyHtml, headings, htmlRel, route, routing, searchShellHtml = '', playgroundShellHtml = '' }) {
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const navItems = nav
        .map((n) => {
            const href = routing.strategy === 'none' || routing.strategy === 'domain' ? n.href : relativeHref(htmlRel, n.href, route);
            const current = n.href === route ? ' aria-current="page"' : '';
            return `      <li><a href="${esc(href)}"${current}>${esc(n.title)}</a></li>`;
        })
        .join('\n');
    const toc =
        headings.length > 1
            ? `<nav aria-label="On this page" class="toc">\n    <ol>\n${headings
                  .map((h) => `      <li class="h${h.level}"><a href="#${esc(h.id)}">${esc(h.text)}</a></li>`)
                  .join('\n')}\n    </ol>\n  </nav>\n`
            : '';
    const docsNav = `  <nav aria-label="Documents" class="doc-subnav">
    <ul>
${navItems}
    </ul>
  </nav>`;
    return `    <aside class="doc-sidebar">
${docsNav}
${searchShellHtml}
    </aside>
    <div class="doc-content">
  ${toc}<main id="main">
${bodyHtml}
${playgroundShellHtml}
  </main>
    </div>`;
}

/**
 * No-JS readable static HTML: nav + main landmarks, Island shells without scripts.
 * Integrated mounts wrap content in compiled DocumentLayout (SiteHeader/SiteFooter SSR).
 */
function renderStaticHtml({
    title,
    locale,
    route,
    nav,
    bodyHtml,
    headings,
    designsHref,
    htmlRel,
    searchShellHtml = '',
    playgroundShellHtml = '',
    routing = { strategy: 'prefix' },
    compiledLayoutHtml,
    useCompiledShell = false,
}) {
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const depth = htmlRel.split('/').length - 1;
    const prefix = depth > 0 ? '../'.repeat(depth) : './';
    /** @type {string[]} */
    const cssHrefs = [];
    if (useCompiledShell) {
        cssHrefs.push('/vmz.css');
    }
    if (designsHref) cssHrefs.push(useCompiledShell ? `/${designsHref}` : prefix + designsHref);

    /** @type {string} */
    let bodyInner;
    if (useCompiledShell) {
        bodyInner = compiledLayoutHtml;
    } else {
        const navItems = nav
            .map((n) => {
                const href = routing.strategy === 'none' || routing.strategy === 'domain' ? n.href : relativeHref(htmlRel, n.href, route);
                const current = n.href === route ? ' aria-current="page"' : '';
                return `      <li><a href="${esc(href)}"${current}>${esc(n.title)}</a></li>`;
            })
            .join('\n');
        const toc =
            headings.length > 1
                ? `<nav aria-label="On this page" class="toc">\n    <ol>\n${headings
                      .map((h) => `      <li class="h${h.level}"><a href="#${esc(h.id)}">${esc(h.text)}</a></li>`)
                      .join('\n')}\n    </ol>\n  </nav>\n`
                : '';
        bodyInner = `  <a class="skip-link" href="#main">Skip to content</a>
  <nav aria-label="Documents" class="doc-subnav">
    <ul>
${navItems}
    </ul>
  </nav>
${searchShellHtml}
  ${toc}<main id="main">
${bodyHtml}
${playgroundShellHtml}
  </main>
`;
    }

    const native = requireNativeAddon();
    if (typeof native.generateHtmlShell !== 'function') {
        throw new Error('vmz native addon missing generateHtmlShell — rebuild with `pnpm napi:build`');
    }
    return native.generateHtmlShell({
        title,
        lang: locale,
        cssHrefs,
        bodyHtml: bodyInner,
        bodyAttrs: ['data-vmz-hydrate', 'island-only'],
    });
}

function relativeHref(fromHtmlRel, toRoute, _fromRoute) {
    const toParts = String(toRoute).replace(/^\//, '').split('/').filter(Boolean);
    let toRel;
    if (toParts.length <= 2) {
        toRel = [...toParts, 'index.html'].join('/');
    } else {
        const file = toParts.slice(2).join('/') + '.html';
        toRel = [...toParts.slice(0, 2), file].join('/');
    }
    const fromDir = path.posix.dirname(fromHtmlRel.replace(/\\/g, '/'));
    let rel = path.posix.relative(fromDir, toRel);
    if (!rel.startsWith('.') && !rel.startsWith('/')) rel = './' + rel;
    return rel || './index.html';
}
