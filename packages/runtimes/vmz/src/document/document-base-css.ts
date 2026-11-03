/**
 * Framework-owned document base stylesheet (`assets/vmz-document.css`).
 *
 * The single canonical document surface for every site: sidebar + article +
 * toc grid, article type scale, code/table/quote blocks, island shells and the
 * responsive breakpoints. Structural colors come from `--vmz-*` semantic tokens
 * only (site brand flows in through the compiled `vmz-designs.css`); syntax
 * colors inside code blocks come from the Shiki theme and stay identical on
 * every site. Sites do not ship document stylesheets.
 *
 * House rules (规划设计/vmz 05): pure-white base with near-black blocks for
 * rhythm, body text ≥ 16px, small text ≥ 12px at weight ≥ 400, no uppercase
 * letter-spaced micro labels, no 3D / volumetric surfaces.
 */
export const DOCUMENT_BASE_CSS = `/* vmz document layer — canonical document surface (token-driven). */

.site--docs {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--vmz-surface-paper, #ffffff);
}

.site--docs > .doc-body {
    flex: 1 0 auto;
    display: grid;
    grid-template-columns: 17rem minmax(0, 1fr);
    align-items: start;
    width: 100%;
    max-width: 94rem;
    margin: 0 auto;
}

/* Sidebar -------------------------------------------------------------- */

.doc-sidebar {
    position: sticky;
    top: var(--vmz-layout-header-height-compact, 3.5rem);
    align-self: start;
    max-height: calc(100vh - var(--vmz-layout-header-height-compact, 3.5rem));
    overflow-y: auto;
    padding: 2rem 1.25rem 3rem 1.5rem;
    border-right: 1px solid var(--vmz-line-default, #e5e6eb);
}

/* Density activation lives in this framework layer: sites only ship tokens. */

:where([data-density="compact"]) .doc-sidebar {
    padding-top: var(--vmz-density-compact-padding-y, 1.5rem);
    padding-bottom: 2rem;
}

:where([data-density="dense"]) .doc-sidebar {
    padding-top: var(--vmz-density-dense-padding-y, 1rem);
    padding-bottom: 1.5rem;
}

.doc-sidebar__label {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--vmz-text-muted, #6b7178);
    margin: 0 0 var(--vmz-density-control-padding-y, 0.75rem);
}

.doc-subnav ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 2px;
}

.doc-subnav a {
    display: block;
    padding: 0.4375rem 0.625rem;
    font-size: 0.875rem;
    line-height: 1.45;
    color: var(--vmz-text-steel, #51565d);
    text-decoration: none;
    border-left: 2px solid transparent;
    border-radius: 0 4px 4px 0;
    transition: color 120ms ease, background 120ms ease, border-color 120ms ease;
}

.doc-subnav a:hover {
    color: var(--vmz-text-ink, #1f2329);
    background: var(--vmz-surface-mist, #f7f8fa);
    text-decoration: none;
}

.doc-subnav a[aria-current="page"] {
    color: var(--vmz-brand-primary, #1677ff);
    border-left-color: var(--vmz-brand-primary, #1677ff);
    background: var(--vmz-surface-paper, #ffffff);
    font-weight: 500;
}

.doc-search {
    margin-top: 1rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--vmz-line-default, #e5e6eb);
    position: relative;
}

.doc-search__input {
    width: 100%;
    box-sizing: border-box;
    padding: 0.4375rem 0.625rem;
    font-size: 0.875rem;
    line-height: 1.4;
    color: var(--vmz-text-ink, #1f2329);
    background: var(--vmz-surface-paper, #ffffff);
    border: 1px solid var(--vmz-line-default, #e5e6eb);
    border-radius: 6px;
}

.doc-search__input:focus-visible {
    outline: 2px solid var(--vmz-brand-primary, #1677ff);
    outline-offset: 1px;
}

.doc-search__results {
    list-style: none;
    margin: 0.375rem 0 0;
    padding: 0.25rem;
    display: grid;
    gap: 1px;
    background: var(--vmz-surface-paper, #ffffff);
    border: 1px solid var(--vmz-line-default, #e5e6eb);
    border-radius: 6px;
    max-height: 16rem;
    overflow-y: auto;
}

.doc-search__results[hidden] {
    display: none;
}

.doc-search__results a {
    display: block;
    padding: 0.375rem 0.5rem;
    font-size: 0.8125rem;
    line-height: 1.4;
    color: var(--vmz-text-steel, #51565d);
    text-decoration: none;
    border-radius: 4px;
    overflow-wrap: break-word;
}

.doc-search__ctx {
    color: var(--vmz-text-muted, #6b7178);
}

.doc-search__results li[aria-selected="true"] a,
.doc-search__results a:hover {
    background: var(--vmz-surface-mist, #f7f8fa);
    color: var(--vmz-text-ink, #1f2329);
}

.doc-search__empty {
    padding: 0.375rem 0.5rem;
    font-size: 0.8125rem;
    color: var(--vmz-text-muted, #6b7178);
}

.doc-search__hint {
    margin: 0.375rem 0 0;
    font-size: 0.75rem;
    line-height: 1.5;
    color: var(--vmz-text-muted, #6b7178);
}

/* Content grid --------------------------------------------------------- */

.doc-content {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 13rem;
    gap: 3rem;
    padding: 3rem 3rem 4rem;
    min-width: 0;
}

.doc-content > main {
    min-width: 0;
    max-width: 46rem;
}

/* Breadcrumb ----------------------------------------------------------- */

.doc-breadcrumb {
    font-size: 0.875rem;
    line-height: 1.5;
    color: var(--vmz-text-muted, #6b7178);
    margin: 0 0 2rem;
    display: flex;
    gap: 0.375rem;
    align-items: baseline;
}

.doc-breadcrumb a {
    color: var(--vmz-text-steel, #51565d);
    text-decoration: none;
}

.doc-breadcrumb a:hover {
    color: var(--vmz-brand-primary, #1677ff);
    text-decoration: underline;
    text-underline-offset: 2px;
}

.doc-breadcrumb [aria-current] {
    color: var(--vmz-text-ink, #1f2329);
    font-weight: 500;
}

/* On this page --------------------------------------------------------- */

.toc {
    position: sticky;
    top: calc(var(--vmz-layout-header-height-compact, 3.5rem) + 1.25rem);
    align-self: start;
    order: 2;
    border-left: 1px solid var(--vmz-line-subtle, #f0f1f3);
    padding-left: 1rem;
}

.toc__label {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--vmz-text-muted, #6b7178);
    margin: 0 0 0.5rem;
}

.toc ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.25rem;
}

.toc a {
    color: var(--vmz-text-steel, #51565d);
    text-decoration: none;
    display: block;
    line-height: 1.4;
    font-size: 0.75rem;
}

.toc a:hover {
    color: var(--vmz-brand-primary, #1677ff);
}

.toc .h3 {
    padding-left: 0.75rem;
    color: var(--vmz-text-muted, #6b7178);
}

/* Article typography --------------------------------------------------- */

.doc-content main h1 {
    font-family: var(--vmz-font-display, var(--vmz-font-sans, sans-serif));
    font-size: clamp(2rem, 2.8vw, 2.5rem);
    font-weight: 650;
    letter-spacing: -0.03em;
    line-height: 1.12;
    margin: 0 0 1.25rem;
    color: var(--vmz-text-ink, #1f2329);
}

.doc-content main h2 {
    font-size: 1.4375rem;
    letter-spacing: -0.02em;
    margin: 3rem 0 0.875rem;
    color: var(--vmz-text-ink, #1f2329);
}

.doc-content main h3 {
    font-size: 1.125rem;
    margin: 2rem 0 0.5rem;
    color: var(--vmz-text-ink, #1f2329);
}

.doc-content main h4 {
    font-size: 1rem;
    margin: 1.75rem 0 0.375rem;
    color: var(--vmz-text-ink, #1f2329);
}

.doc-content main p,
.doc-content main li {
    font-size: 1rem;
    line-height: 1.75;
    color: var(--vmz-text-steel, #51565d);
}

.doc-content main p {
    margin: 0 0 1.125rem;
}

.doc-content main ul,
.doc-content main ol {
    margin: 0 0 1.25rem;
    padding-left: 1.375rem;
}

.doc-content main li + li {
    margin-top: 0.375rem;
}

.doc-content main li::marker {
    color: var(--vmz-line-strong, #c9cdd4);
}

.doc-content main a {
    color: var(--vmz-brand-primary, #1677ff);
    text-decoration: underline;
    text-underline-offset: 2px;
    text-decoration-color: var(--vmz-line-strong, #c9cdd4);
    overflow-wrap: break-word;
}

.doc-content main a:hover {
    text-decoration-color: var(--vmz-brand-primary, #1677ff);
}

.doc-content main strong {
    color: var(--vmz-text-ink, #1f2329);
    font-weight: 600;
}

.doc-content main hr {
    border: 0;
    border-top: 1px solid var(--vmz-line-default, #e5e6eb);
    margin: 1.75rem 0;
}

/* Inline code */
.doc-content main :not(pre) > code {
    font-family: var(--vmz-font-mono, ui-monospace, monospace);
    font-size: 0.875rem;
    color: var(--vmz-text-ink, #1f2329);
    background: var(--vmz-surface-mist, #f7f8fa);
    border: 1px solid var(--vmz-line-subtle, #f0f1f3);
    border-radius: 4px;
    padding: 0.0625rem 0.3125rem;
    word-break: break-word;
}

/* Code blocks: near-black surface, token chrome, theme-owned syntax colors */
.doc-content main pre {
    position: relative;
    margin: 0 0 1.375rem;
    padding: 1.125rem 1.25rem;
    overflow-x: auto;
    border: 1px solid var(--vmz-line-default, #e5e6eb);
    border-radius: 8px;
    background: var(--vmz-surface-code, #0f1115);
    color: var(--vmz-text-on-ink, #f7f8fa);
    font-size: 0.84375rem;
    line-height: 1.7;
    tab-size: 4;
}

/* Copy button (injected by assets/vmz-document.js; hidden without JS) */
.doc-copy {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    padding: 0.1875rem 0.5rem;
    font-size: 0.75rem;
    font-weight: 400;
    line-height: 1.4;
    color: var(--vmz-text-muted, #6b7178);
    background: var(--vmz-surface-mist, #f7f8fa);
    border: 1px solid var(--vmz-line-default, #e5e6eb);
    border-radius: 4px;
    cursor: pointer;
    opacity: 0;
    transition: opacity 120ms ease;
}

pre:hover .doc-copy,
pre:focus-within .doc-copy,
.doc-copy:focus-visible {
    opacity: 1;
}

.doc-copy--done {
    color: var(--vmz-status-success-accent, #237804);
}

/* Heading self anchors (build-time, no-JS usable) */
.h-anchor {
    margin-left: 0.4em;
    font-size: 0.8em;
    font-weight: 400;
    text-decoration: none;
    color: var(--vmz-text-muted, #6b7178);
    opacity: 0;
    transition: opacity 120ms ease;
}

.doc-content main h2:hover .h-anchor,
.doc-content main h3:hover .h-anchor,
.doc-content main h4:hover .h-anchor,
.h-anchor:focus-visible {
    opacity: 1;
}

.doc-content main pre code {
    font-family: var(--vmz-font-mono, ui-monospace, monospace);
    font-size: inherit;
    background: transparent;
    border: 0;
    padding: 0;
    color: inherit;
}

/* Tables */
.doc-content main table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    margin: 0.75rem 0 1.5rem;
    font-size: 0.9375rem;
    border: 1px solid var(--vmz-line-default, #e5e6eb);
    border-radius: 10px;
    display: block;
    overflow-x: auto;
}

.doc-content main thead th {
    background: var(--vmz-surface-mist, #f7f8fa);
    border-bottom: 1px solid var(--vmz-line-default, #e5e6eb);
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--vmz-text-muted, #6b7178);
    text-align: left;
    padding: 0.6875rem 1rem;
    white-space: nowrap;
}

.doc-content main td,
.doc-content main tbody th {
    border-bottom: 1px solid var(--vmz-line-subtle, #f0f1f3);
    padding: 0.6875rem 1rem;
    vertical-align: top;
    line-height: 1.6;
    color: var(--vmz-text-steel, #51565d);
}

.doc-content main tbody tr:last-child td {
    border-bottom: 0;
}

.doc-content main tbody tr:hover td {
    background: var(--vmz-surface-fill, #fafbfc);
}

.doc-content main td code {
    font-size: 0.8125rem;
}

/* Blockquote / callouts */
.doc-content main blockquote {
    margin: 0 0 1.25rem;
    padding: 0.875rem 1.125rem;
    border: 1px solid var(--vmz-line-default, #e5e6eb);
    border-left: 3px solid var(--vmz-brand-primary, #1677ff);
    border-radius: 0 8px 8px 0;
    background: var(--vmz-surface-mist, #f7f8fa);
    font-size: 1rem;
    color: var(--vmz-text-steel, #51565d);
}

.doc-content main blockquote p {
    margin: 0;
    font-size: 1rem;
}

.doc-content main .warn {
    background: var(--vmz-status-warning-background, #fff7e6);
    border: 1px solid var(--vmz-status-warning-border, #ffe7ba);
    border-left: 3px solid var(--vmz-status-warning-accent, #d48806);
    color: var(--vmz-status-warning-foreground, #ad6800);
    padding: 0.875rem 1.125rem;
    border-radius: 0 8px 8px 0;
    margin: 0 0 1.25rem;
    font-size: 0.9375rem;
    line-height: 1.65;
}

.doc-content main .warn p {
    color: inherit;
    font-size: inherit;
    margin: 0;
}

/* Playground / island shells */
.doc-content main [data-vmz-island],
.doc-content main .doc-playground {
    border: 1px solid var(--vmz-line-default, #e5e6eb);
    border-radius: var(--vmz-radius-xs, 4px);
    background: var(--vmz-surface-fill, #fafbfc);
    padding: 0.75rem;
    margin: 0 0 1rem;
}

.doc-content main .doc-playground-source,
.doc-content main .doc-playground-fallback {
    font-size: 0.8125rem;
    color: var(--vmz-text-muted, #6b7178);
}

/* Standalone mount emits the same .site.site--docs > .doc-body skeleton as
   the integrated shell — no second DOM shape. */

.skip-link {
    position: absolute;
    left: -999px;
    top: 0.75rem;
    z-index: 50;
    padding: 0.45rem 0.75rem;
    background: var(--vmz-brand-primary, #1677ff);
    color: var(--vmz-text-on-brand, #ffffff);
    text-decoration: none;
}

.skip-link:focus {
    left: 0.75rem;
}

/* Responsive ------------------------------------------------------------ */

@media (max-width: 1100px) {
    .doc-content {
        grid-template-columns: minmax(0, 1fr);
        padding: 1.75rem 1.5rem 2.5rem;
    }

    .toc {
        position: static;
        order: -1;
        border-left: 0;
        border-bottom: 1px solid var(--vmz-line-subtle, #f0f1f3);
        padding: 0 0 0.75rem;
        margin-bottom: 1.5rem;
    }
}

@media (max-width: 860px) {
    .site--docs > .doc-body,
    body > .doc-body {
        grid-template-columns: 1fr;
    }

    .doc-sidebar {
        position: static;
        max-height: none;
        border-right: 0;
        border-bottom: 1px solid var(--vmz-line-default, #e5e6eb);
        padding: 1rem;
    }

    .doc-content {
        padding: 1.25rem 1rem 2rem;
    }

    .doc-content main h1 {
        font-size: 1.375rem;
    }

    .doc-content main pre {
        font-size: 0.75rem;
    }
}
`;
