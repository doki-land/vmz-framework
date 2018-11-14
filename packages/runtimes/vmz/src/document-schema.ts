/**
 * Document contract — schema constants & diagnostic codes.
 *
 * Not a Doc IR: this is a filesystem/manifest projection only.
 */

export const DOCUMENT_MANIFEST_SCHEMA = 'vmz.document.manifest.v0';

/** Static page view fragment — not a Doc IR. */
export const DOCUMENT_VIEW_SCHEMA = 'vmz.document.view.v0';

/** Evidence projection (fences + API refs) — not a Doc IR. */
export const DOCUMENT_EVIDENCE_SCHEMA = 'vmz.document.evidence.v0';

/** Search index (SearchRecord[]) — not a Doc IR. */
export const DOCUMENT_SEARCH_SCHEMA = 'vmz.document.search.v0';

/** Island-only resume plan for search/playground — not a Doc IR. */
export const DOCUMENT_ISLANDS_SCHEMA = 'vmz.document.islands.v0';

export interface PageIdentity {
    pageKey: string;
    locale: string;
}

export interface PageRecord {
    identity: PageIdentity;
    sourcePath: string;
    route?: string | null;
    anchors?: string[];
    title?: string;
}

export interface DocumentCollection {
    id: string;
    sourceRoot: string;
    pageKeys: string[];
}

export interface DocumentMount {
    collectionId: string;
    routeBase: string;
    mode: 'integrated' | 'standalone';
}

export interface DocumentDiagnostic {
    code: string;
    severity: 'error' | 'warning';
    message: string;
    path?: string;
}

export interface DocumentFenceRecord {
    lang: string;
    info?: string;
    lineStart?: number;
    lineEnd?: number;
    pageKey: string;
    locale: string;
    path?: string;
    run?: string | null;
    source?: string | null;
    playground?: boolean;
    status?: string;
    detail?: string;
}

export interface DocumentApiMatch {
    chunkId?: string;
    name?: string;
    source?: string;
    capabilities?: string[];
    stableId?: { kind: string; id?: string };
}

export interface DocumentApiRef {
    query: string;
    pageKey: string;
    locale: string;
    path?: string;
    status: string;
    matches: DocumentApiMatch[];
}

export interface DocumentEvidence {
    schema: typeof DOCUMENT_EVIDENCE_SCHEMA;
    fences: DocumentFenceRecord[];
    apiRefs: DocumentApiRef[];
    testSelections: unknown[];
    status: string;
}

export interface DocumentSearchHeading {
    id: string;
    level: number;
    text: string;
}

export interface DocumentSearchRecord {
    kind: string;
    id: string;
    locale: string;
    pageKey: string;
    route?: string | null;
    title?: string;
    text?: string;
    headings?: DocumentSearchHeading[];
    headingId?: string;
    headingLevel?: number;
    apiSymbolIds?: string[];
    apiSymbolId?: string;
    stableId?: { kind: string; id?: string };
    version?: string | null;
}

export interface DocumentSearchIndex {
    schema: typeof DOCUMENT_SEARCH_SCHEMA;
    status: string;
    version: string | null;
    records: DocumentSearchRecord[];
}

export interface DocumentIslandFence {
    lang?: string;
    run?: string | null;
    playground?: boolean;
    source?: string | null;
    pageKey: string;
    locale: string;
    path?: string;
    lineStart?: number;
    lineEnd?: number;
    status?: string;
}

export interface DocumentIsland {
    name: string;
    kind: string;
    resume: string;
    index?: string | null;
    fence?: DocumentIslandFence;
    preview?: string | null;
}

export interface DocumentIslandsPlan {
    schema: typeof DOCUMENT_ISLANDS_SCHEMA;
    hydrate: string;
    fullPageHydrate: boolean;
    islands: DocumentIsland[];
    status: string;
}

export interface DocumentBuildMeta {
    engine?: string;
    outDir?: string;
    designs?: string | null;
    designsCss?: string | null;
    hostShell?: string;
    pages?: Array<{ route: string; htmlPath: string; viewPath: string }>;
    evidence?: string;
    search?: string;
    islands?: string;
}

export interface DocumentManifest {
    schema: typeof DOCUMENT_MANIFEST_SCHEMA;
    root: string;
    defaultLocale: string | null;
    locales: string[];
    localeLabels: Record<string, string>;
    collections: DocumentCollection[];
    mounts: DocumentMount[];
    pages: PageRecord[];
    diagnostics: DocumentDiagnostic[];
    evidence?: DocumentEvidence;
    search?: DocumentSearchIndex;
    islands?: DocumentIslandsPlan;
    build?: DocumentBuildMeta;
}

/** Top-level non-locale reserved names under /documents */
export const DOCUMENT_RESERVED_TOP = new Set([
    'package.json',
    'documents.config.ts',
    'documents.config.json',
    'documents.config.json5',
    'documents.config.js',
    'public',
]);

/** Known locale aliases → canonical key (lowercase, hyphen). */
export const LOCALE_ALIASES: Record<string, string> = {
    'zh-cn': 'zh-hans',
    'zh-sg': 'zh-hans',
    'zh-tw': 'zh-hant',
    'zh-hk': 'zh-hant',
    'zh-mo': 'zh-hant',
};

export const DIAG = {
    LOCALE_INVALID: 'document::locale::invalid',
    LOCALE_CASE: 'document::locale::case',
    LOCALE_SEPARATOR: 'document::locale::separator',
    LOCALE_CONFLICT: 'document::locale::conflict',
    LOCALE_MISSING_DEFAULT: 'document::locale::missing_default',
    LOCALE_MISSING_PAGE: 'document::locale::missing_page',
    LOCALE_ORPHAN_PAGE: 'document::locale::orphan_page',
    LAYOUT_ILLEGAL_TOP: 'document::layout::illegal_top',
    LAYOUT_MISSING_DOCUMENTS: 'document::layout::missing_documents',
    CONFIG_MISSING: 'document::config::missing',
    CONFIG_INVALID: 'document::config::invalid',
    CONFIG_DEFAULT_LOCALE: 'document::config::default_locale',
    FALLBACK_SILENT: 'document::fallback::silent_forbidden',
    PAGE_DUPLICATE: 'document::page::duplicate',
    LINK_BROKEN: 'document::link::broken',
    LINK_AMBIGUOUS: 'document::link::ambiguous',
    ANCHOR_MISSING: 'document::anchor::missing',
    ANCHOR_DUPLICATE: 'document::anchor::duplicate',
    ROUTE_DUPLICATE: 'document::route::duplicate',
    NAV_EMPTY: 'document::nav::empty',
    FENCE_CHECK: 'document::fence::check_failed',
    FENCE_UNSUPPORTED: 'document::fence::unsupported',
    FENCE_SOURCE_MISSING: 'document::fence::source_missing',
    FENCE_RUN_FAILED: 'document::fence::run_failed',
    API_MISSING: 'document::api::missing',
    API_AMBIGUOUS: 'document::api::ambiguous',
};
