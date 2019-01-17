/**
 * Document Interactive — search index + Island-only resume plan.
 *
 * Not a Doc IR: build artifacts + ResumeEntry-shaped island hosts.
 * Static HTML stays no-JS readable; islands resume later, never full-page hydrate.
 */
import { parseFenceInfo } from './document-evidence.js';
import type { EnrichDocumentContentResult } from './document-enrich.js';
import {
    DOCUMENT_ISLANDS_SCHEMA,
    DOCUMENT_SEARCH_SCHEMA,
    type DocumentEvidence,
    type DocumentIsland,
    type DocumentIslandsPlan,
    type DocumentManifest,
    type DocumentSearchIndex,
    type DocumentSearchRecord,
    type PageRecord,
} from './document-schema.js';

/** Strip tags / collapse whitespace for search body text. */
export function htmlToSearchText(html: string): string {
    return String(html || '')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ')
        .trim();
}

export interface BuildDocumentSearchOpts {
    manifest: DocumentManifest;
    enriched: Pick<EnrichDocumentContentResult, 'byId'>;
    evidence: DocumentEvidence;
    version?: string | null;
}

export function buildDocumentSearch(opts: BuildDocumentSearchOpts): DocumentSearchIndex {
    const { manifest, enriched, evidence } = opts;
    const version = opts.version ?? null;
    const records: DocumentSearchRecord[] = [];

    for (const page of manifest.pages || []) {
        const id = `${page.identity.locale}:${page.identity.pageKey}`;
        const info = enriched.byId.get(id);
        if (!info) continue;
        const locale = page.identity.locale;
        const pageKey = page.identity.pageKey;
        const route = info.route || page.route;
        const title = info.title || pageKey;
        const text = htmlToSearchText(info.html);
        const headings = (info.headings || []).map((h) => ({
            id: h.id,
            level: h.level,
            text: h.text,
        }));
        const apiSymbolIds = (evidence?.apiRefs || [])
            .filter((r) => r.locale === locale && r.pageKey === pageKey && r.status === 'ok')
            .flatMap((r) => (r.matches || []).map((m) => m.chunkId || m.name))
            .filter((x): x is string => Boolean(x));

        records.push({
            kind: 'page',
            id: `page:${locale}:${pageKey}`,
            locale,
            pageKey,
            route,
            title,
            text,
            headings,
            apiSymbolIds,
            version,
        });

        for (const h of headings) {
            records.push({
                kind: 'heading',
                id: `heading:${locale}:${pageKey}#${h.id}`,
                locale,
                pageKey,
                route: `${route}#${h.id}`,
                title: h.text,
                text: h.text,
                headingId: h.id,
                headingLevel: h.level,
                version,
            });
        }
    }

    for (const ref of evidence?.apiRefs || []) {
        if (ref.status !== 'ok') continue;
        for (const m of ref.matches || []) {
            const page = (manifest.pages || []).find((p) => p.identity.locale === ref.locale && p.identity.pageKey === ref.pageKey);
            const info = page ? enriched.byId.get(`${ref.locale}:${ref.pageKey}`) : null;
            records.push({
                kind: 'api',
                id: `api:${m.chunkId || m.name}`,
                locale: ref.locale,
                pageKey: ref.pageKey,
                route: info?.route || null,
                title: m.name || m.chunkId,
                text: `${m.name || ''} ${m.chunkId || ''} ${(m.capabilities || []).join(' ')}`.trim(),
                apiSymbolId: m.chunkId || m.name,
                stableId: m.stableId || { kind: 'chunk', id: m.chunkId },
                version,
            });
        }
    }

    return {
        schema: DOCUMENT_SEARCH_SCHEMA,
        status: records.length ? 'ready' : 'empty',
        version,
        records,
    };
}

export interface BuildDocumentIslandsOpts {
    evidence: DocumentEvidence;
    searchHref?: string;
    fenceBodies?: Map<string, string>;
}

/** Island-only resume plan for document surfaces. */
export function buildDocumentIslands(opts: BuildDocumentIslandsOpts): DocumentIslandsPlan {
    const searchHref = opts.searchHref || 'document.search.json';
    const islands: DocumentIsland[] = [
        {
            name: 'DocumentSearch',
            kind: 'search',
            resume: 'island',
            index: searchHref,
        },
    ];

    const fences = opts.evidence?.fences || [];
    for (let i = 0; i < fences.length; i++) {
        const f = fences[i];
        const meta = parseFenceInfo(f.info);
        const interactive = Boolean(meta.playground || meta.run);
        if (!interactive) continue;
        if (f.status && f.status !== 'ok' && f.status !== 'highlight') continue;
        if (meta.lang !== 'vmz' && !meta.playground) continue;
        const name = `DocumentPlayground:${f.locale}:${f.pageKey}:${f.lineStart || i}`;
        const bodyKey = `${f.locale}:${f.pageKey}:${f.lineStart}`;
        islands.push({
            name,
            kind: 'playground',
            resume: 'island',
            fence: {
                lang: meta.lang,
                run: meta.run,
                playground: Boolean(meta.playground),
                source: meta.source,
                pageKey: f.pageKey,
                locale: f.locale,
                path: f.path,
                lineStart: f.lineStart,
                lineEnd: f.lineEnd,
                status: f.status,
            },
            preview: opts.fenceBodies?.get(bodyKey) ?? null,
        });
    }

    return {
        schema: DOCUMENT_ISLANDS_SCHEMA,
        hydrate: 'island-only',
        fullPageHydrate: false,
        islands,
        status: 'ready',
    };
}

/** Relative href from an HTML page to a root artifact (posix). */
export function artifactHrefFromHtml(htmlRel: string, artifactName: string): string {
    const depth = String(htmlRel).replace(/\\/g, '/').split('/').length - 1;
    const prefix = depth > 0 ? '../'.repeat(depth) : './';
    return prefix + artifactName;
}

/** Stable map key for fence body lookup. */
export function fenceBodyKey(f: { locale: string; pageKey: string; lineStart: number }): string {
    return `${f.locale}:${f.pageKey}:${f.lineStart}`;
}

export interface AnalyzedFence {
    info?: string;
    content?: string;
    lineStart?: number;
    lineEnd?: number;
}

/** Collect fence bodies from analyzeMarkdown results for playground islands. */
export function collectFenceBodies(analyzedByPageId: Map<string, { fences?: AnalyzedFence[] }>, pages: PageRecord[]): Map<string, string> {
    const out = new Map<string, string>();
    for (const page of pages || []) {
        const id = `${page.identity.locale}:${page.identity.pageKey}`;
        const analyzed = analyzedByPageId.get(id);
        if (!analyzed?.fences) continue;
        for (const fence of analyzed.fences) {
            const meta = parseFenceInfo(fence.info);
            if (!(meta.playground || meta.run) || meta.lang !== 'vmz') continue;
            out.set(
                fenceBodyKey({
                    locale: page.identity.locale,
                    pageKey: page.identity.pageKey,
                    lineStart: fence.lineStart ?? 0,
                }),
                String(fence.content || '').trim(),
            );
        }
    }
    return out;
}

export interface RenderIslandShellsOpts {
    islands: DocumentIslandsPlan;
    searchIndexHref: string;
    pageKey: string;
    locale: string;
}

/** Render SSR island shells (no script — resume later). */
export function renderIslandShellsHtml(opts: RenderIslandShellsOpts): { searchHtml: string; playgroundHtml: string } {
    const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const search = `
  <div
    data-vmz-island="DocumentSearch"
    data-vmz-resume="island"
    data-vmz-search-index="${esc(opts.searchIndexHref)}"
    role="search"
    aria-label="Document search"
  >
    <p class="doc-search-fallback">Search requires Island resume; use navigation without JavaScript.</p>
  </div>`;

    const playgrounds = (opts.islands?.islands || [])
        .filter((isl) => isl.kind === 'playground' && isl.fence?.locale === opts.locale && isl.fence?.pageKey === opts.pageKey)
        .map((isl) => {
            const preview = isl.preview ? `<pre class="doc-playground-source"><code>${esc(isl.preview)}</code></pre>` : '';
            return `
  <div
    data-vmz-island="${esc(isl.name)}"
    data-vmz-resume="island"
    data-vmz-playground="1"
    data-vmz-fence-lang="${esc(isl.fence?.lang || 'vmz')}"
    aria-label="Interactive example"
  >
    <p class="doc-playground-fallback">Interactive example resumes as an Island; source remains readable above.</p>
    ${preview}
  </div>`;
        })
        .join('');

    return { searchHtml: search, playgroundHtml: playgrounds };
}
