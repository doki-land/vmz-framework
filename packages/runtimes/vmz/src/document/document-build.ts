/**
 * Document Static + Interactive artifacts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { checkDocuments, manifestHasErrors } from './document-check.js';
import { DOCUMENT_BASE_CSS } from './document-base-css.js';
import { resolveDocumentDesignsCss } from './document-designs.js';
import { enrichDocumentContent, pageHtmlRel, pageRoute, routeHrefForDocLink, type AnalyzedMarkdown, type DocumentHeading, type DocumentNavItem } from './document-enrich.js';
import { enrichDocumentEvidence } from './document-evidence.js';
import { resolveDocumentCodeHighlighter, type DocumentCodeHighlighter } from './document-highlight.js';
import {
    artifactHrefFromHtml,
    buildDocumentIslands,
    buildDocumentSearch,
    collectFenceBodies,
    renderIslandShellsHtml,
} from './document-interactive.js';
import { assertIntegratedDistReady, renderCompiledDocumentLayout } from './document-layout-render.js';
import { resolveMarkdownEngine } from './document-markdown.js';
import { loadLocalesRouting, type LocalesRouting } from './document-routing-config.js';
import { DOCUMENT_VIEW_SCHEMA, type DocumentManifest, type PageRecord } from './document-schema.js';
import { createWorkspace } from '../workspace/public-api.js';
import { requireNativeAddon } from '../workspace/native-addon.js';
import { writePrettyJsonFile } from '../workspace/pretty-json.js';

export interface BuildDocumentsOpts {
    projectRoot: string;
    outDir?: string;
    appDistDir?: string;
    strict?: boolean;
    engines?: { markdown?: string; code?: string };
}

export interface BuildDocumentsPageResult {
    route: string;
    htmlPath: string;
    viewPath: string;
}

export interface BuildDocumentsResult {
    ok: boolean;
    manifest: DocumentManifest;
    outDir: string;
    pages: BuildDocumentsPageResult[];
    search?: ReturnType<typeof buildDocumentSearch>;
    islands?: ReturnType<typeof buildDocumentIslands>;
}

export async function buildDocuments(opts: BuildDocumentsOpts): Promise<BuildDocumentsResult> {
    const projectRoot = path.resolve(opts.projectRoot);
    const outDir = path.resolve(opts.outDir || path.join(projectRoot, 'dist', 'documents'));
    const strict = Boolean(opts.strict);
    const manifest = checkDocuments({ projectRoot, strict });
    const routing: LocalesRouting = loadLocalesRouting(projectRoot) || { strategy: 'prefix' };
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

    const analyzedByPageId = new Map<string, AnalyzedMarkdown>();
    const highlighter = await resolveDocumentCodeHighlighter({ code: opts.engines?.code }, manifest.diagnostics);
    const pageKeySet = new Map<string, Set<string>>();
    for (const p of manifest.pages) {
        const set = pageKeySet.get(p.identity.locale) || new Set<string>();
        set.add(p.identity.pageKey);
        pageKeySet.set(p.identity.locale, set);
    }
    for (const page of manifest.pages) {
        const abs = path.isAbsolute(page.sourcePath) ? page.sourcePath : path.join(manifest.root, page.sourcePath);
        const source = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
        const id = `${page.identity.locale}:${page.identity.pageKey}`;
        const hooks = documentRenderHooks(page, enriched.routeBase, pageKeySet, routing, highlighter);
        analyzedByPageId.set(id, engine.analyzeMarkdown(source, hooks) as AnalyzedMarkdown);
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
    const designs = resolveDocumentDesignsCss(projectRoot, appDistDir);
    // Framework document base always emits; site token bundle emits when the
    // project has compiled tokens (integrated) or a `designs/styles/index.css`
    // entry (standalone).
    const baseCssPath = path.join(outDir, designs.baseHref);
    fs.mkdirSync(path.dirname(baseCssPath), { recursive: true });
    fs.writeFileSync(baseCssPath, DOCUMENT_BASE_CSS, 'utf8');
    if (designs.tokensCss && designs.tokensHref) {
        const cssPath = path.join(outDir, designs.tokensHref);
        fs.mkdirSync(path.dirname(cssPath), { recursive: true });
        fs.writeFileSync(cssPath, designs.tokensCss, 'utf8');
    }
    const viewsDir = path.join(outDir, 'views');
    fs.mkdirSync(viewsDir, { recursive: true });
    const written: BuildDocumentsPageResult[] = [];
    for (const page of manifest.pages) {
        const id = `${page.identity.locale}:${page.identity.pageKey}`;
        const info = enriched.byId.get(id);
        if (!info) continue;
        // Render-pass HTML: fences highlighted and author links rewritten to
        // route form (validation already ran on the author form in enrich).
        const rendered = analyzedByPageId.get(id);
        const bodyHtml = rendered?.html ?? info.html;
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
            bodyHtml,
            headings: info.headings,
            title: info.title,
            route: info.route,
            locale: page.identity.locale,
            routing,
            searchShellHtml: shells.searchHtml,
            playgroundShellHtml: shells.playgroundHtml,
        });
        let compiledLayoutHtml: string | null = null;
        if (useCompiledShell && appDistDir) {
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
            html: bodyHtml,
            designsCss: designs.tokensHref,
            documentCss: designs.baseHref,
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
            slotHtml,
            tokensHref: designs.tokensHref,
            baseHref: designs.baseHref,
            compiledLayoutHtml,
            useCompiledShell,
        });
        fs.writeFileSync(htmlAbs, html, 'utf8');
        written.push({ route: info.route, htmlPath: htmlRel, viewPath: viewRel });
    }
    const manifestOut: DocumentManifest = {
        ...manifest,
        schema: manifest.schema,
        evidence: evidence.evidence,
        search,
        islands,
        build: {
            engine: engine.engine,
            outDir: path.relative(projectRoot, outDir).replace(/\\/g, '/') || '.',
            designs: designs.source,
            designsCss: designs.tokensHref,
            documentCss: designs.baseHref,
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

function resolveAppDistDir(opts: Pick<BuildDocumentsOpts, 'appDistDir'>, outDir: string): string | null {
    if (opts.appDistDir) {
        const p = path.resolve(opts.appDistDir);
        return fs.existsSync(path.join(p, 'vmz-dom.js')) ? p : null;
    }
    return fs.existsSync(path.join(outDir, 'vmz-dom.js')) ? outDir : null;
}

interface DocumentSlotHtmlOpts {
    nav: DocumentNavItem[];
    bodyHtml: string;
    headings: DocumentHeading[];
    title: string;
    route: string;
    locale: string;
    routing: LocalesRouting;
    searchShellHtml?: string;
    playgroundShellHtml?: string;
}

/** Document-layer chrome copy, localized by page locale (normal case, no decorative micro labels). */
function docUiCopy(locale: string): { home: string; docs: string; toc: string } {
    return locale.startsWith('zh')
        ? { home: '首页', docs: '文档', toc: '本页内容' }
        : { home: 'Home', docs: 'Documentation', toc: 'On this page' };
}

/**
 * Document main column + sidebar (injected into the DocumentLayout slot;
 * standalone mounts wrap the same markup — one DOM shape, one stylesheet).
 * In-site links are route-form (`/d/<locale>/<pageKey>`), identical to
 * application routes — no `.html` file paths leak into the page.
 */
function buildDocumentSlotHtml({
    nav,
    bodyHtml,
    headings,
    title,
    route,
    locale,
    routing,
    searchShellHtml = '',
    playgroundShellHtml = '',
}: DocumentSlotHtmlOpts): string {
    const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const copy = docUiCopy(locale);
    const navItems = nav
        .map((n) => {
            const current = n.href === route ? ' aria-current="page"' : '';
            return `      <li><a href="${esc(n.href)}"${current}>${esc(n.title)}</a></li>`;
        })
        .join('\n');
    const toc =
        headings.length > 1
            ? `<nav aria-label="${esc(copy.toc)}" class="toc">\n    <p class="toc__label">${esc(copy.toc)}</p>\n    <ol>\n${headings
                  .map((h) => `      <li class="h${h.level}"><a href="#${esc(h.id)}">${esc(h.text)}</a></li>`)
                  .join('\n')}\n    </ol>\n  </nav>\n`
            : '';
    const docsRoot = pageRoute(routeBaseOf(route), locale, 'index', routing);
    const breadcrumb = `<nav class="doc-breadcrumb" aria-label="Breadcrumb"><a href="/">${esc(copy.home)}</a><span aria-hidden="true"> / </span><a href="${esc(docsRoot)}">${esc(copy.docs)}</a><span aria-hidden="true"> / </span><span aria-current="page">${esc(title)}</span></nav>`;
    const docsNav = `  <p class="doc-sidebar__label">${esc(copy.docs)}</p>
  <nav aria-label="Documents" class="doc-subnav">
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
${breadcrumb}
${bodyHtml}
${playgroundShellHtml}
  </main>
    </div>`;
}

interface RenderStaticHtmlOpts {
    title: string;
    locale: string;
    route: string;
    slotHtml: string;
    tokensHref: string | null;
    baseHref: string;
    compiledLayoutHtml?: string | null;
    useCompiledShell?: boolean;
}

/**
 * No-JS readable static HTML: nav + main landmarks, Island shells without scripts.
 * Integrated mounts wrap content in compiled DocumentLayout (SiteHeader/SiteFooter SSR);
 * standalone mounts emit the same `.site.site--docs > .doc-body` skeleton themselves.
 */
function renderStaticHtml({
    title,
    locale,
    slotHtml,
    tokensHref,
    baseHref,
    compiledLayoutHtml,
    useCompiledShell = false,
}: RenderStaticHtmlOpts): string {
    const cssHrefs: string[] = [];
    if (useCompiledShell) {
        cssHrefs.push('/vmz.css');
    }
    // Absolute hrefs: document pages are served under the mount root by the
    // same host as the app (integrated) or as the site root (standalone).
    if (tokensHref) cssHrefs.push(`/${tokensHref}`);
    cssHrefs.push(`/${baseHref}`);

    const bodyInner = useCompiledShell
        ? compiledLayoutHtml || ''
        : `  <a class="skip-link" href="#main">Skip to content</a>
  <div class="site site--docs">
    <div class="doc-body">
${slotHtml}
    </div>
  </div>
`;

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

/** Render-pass hooks: fence highlight + author link → route-form rewrite. */
function documentRenderHooks(
    page: PageRecord,
    routeBase: string,
    pageKeySet: Map<string, Set<string>>,
    routing: LocalesRouting,
    highlighter: DocumentCodeHighlighter | null,
): { highlight?: (code: string, lang: string) => string; resolveHref?: (href: string) => string | null } {
    return {
        resolveHref: (href) => routeHrefForDocLink(href, page.identity.pageKey, page.identity.locale, routeBase, pageKeySet, routing),
        ...(highlighter ? { highlight: (code: string, lang: string) => highlighter.highlightFenceInline(code, lang) } : {}),
    };
}

/** Route base recovered from a page route (`/d/zh-hans/guide/x` → `/d`). */
function routeBaseOf(route: string): string {
    const parts = String(route || '').replace(/^\//, '').split('/').filter(Boolean);
    return parts.length ? `/${parts[0]}` : '/';
}
