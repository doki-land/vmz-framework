// @ts-nocheck
/**
 * Document D0 Contract — schema constants & diagnostic codes.
 * Design: 规划设计/vmz/19 §2.3 · D0
 *
 * Not a Doc IR: this is a filesystem/manifest projection only.
 */

/** @typedef {{ pageKey: string, locale: string }} PageIdentity */

/** @typedef {{
 *   identity: PageIdentity,
 *   sourcePath: string,
 *   route?: string | null,
 *   anchors?: string[],
 * }} PageRecord */

/** @typedef {{
 *   id: string,
 *   sourceRoot: string,
 *   pageKeys: string[],
 * }} DocumentCollection */

/** @typedef {{
 *   collectionId: string,
 *   routeBase: string,
 *   mode: 'integrated' | 'standalone',
 * }} DocumentMount */

/** @typedef {{
 *   code: string,
 *   severity: 'error' | 'warning',
 *   message: string,
 *   path?: string,
 * }} DocumentDiagnostic */

/** @typedef {{
 *   schema: typeof DOCUMENT_MANIFEST_SCHEMA,
 *   root: string,
 *   defaultLocale: string | null,
 *   locales: string[],
 *   localeLabels: Record<string, string>,
 *   collections: DocumentCollection[],
 *   mounts: DocumentMount[],
 *   pages: PageRecord[],
 *   diagnostics: DocumentDiagnostic[],
 * }} DocumentManifest */

export const DOCUMENT_MANIFEST_SCHEMA = 'vmz.document.manifest.v0';

/** Static page view fragment (D1) — not a Doc IR. */
export const DOCUMENT_VIEW_SCHEMA = 'vmz.document.view.v0';

/** D2 evidence projection (fences + API refs) — not a Doc IR. */
export const DOCUMENT_EVIDENCE_SCHEMA = 'vmz.document.evidence.v0';

/** D3 search index (SearchRecord[]) — not a Doc IR. */
export const DOCUMENT_SEARCH_SCHEMA = 'vmz.document.search.v0';

/** D3 island-only resume plan for search/playground — not a Doc IR. */
export const DOCUMENT_ISLANDS_SCHEMA = 'vmz.document.islands.v0';

/** Top-level non-locale reserved names under /documents */
export const DOCUMENT_RESERVED_TOP = new Set(['package.json', 'documents.config.ts', 'documents.config.json', 'documents.config.js', 'public']);

/** Known locale aliases → canonical key (lowercase, hyphen). */
export const LOCALE_ALIASES = {
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
