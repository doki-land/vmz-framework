/**
 * Shiki highlight helper — async with optional sync cache after prewarm.
 * TextMate grammar via configurable peer (default `vmz-textmate/shiki`).
 */

import type { Highlighter, ShikiTransformer } from 'shiki';

export type ShikiRuntimeConfig = {
    /**
     * TextMate Shiki adapter module id (e.g. `vmz-textmate/shiki`). Explicit
     * opt-in: the adapter package is host-visible (not an npm dependency of
     * this plugin), so the host must guarantee resolvability — serve-host
     * resolve hooks on Node, an import map or vendor copy in the browser.
     */
    textmate?: string;
    /** Default themes passed to the highlighter factory. */
    themes?: string[];
};

const DEFAULT_THEME = 'vitesse-dark';
const DEFAULT_LANG = 'text';

/**
 * Component props are nullable (`theme: string | null = null`) and a bound
 * `null` overrides the prop default in the compiled component, so runtime
 * entry points normalize before touching Shiki: `createHighlighter` rejects
 * falsy theme/lang getters deep inside `@shikijs/core` (`normalizeGetter`
 * dereferences the resolved module), which used to surface as a page-level
 * SSR failure.
 */
function normalizeTheme(theme: string | null | undefined): string {
    return typeof theme === 'string' && theme.trim() ? theme : DEFAULT_THEME;
}

function normalizeLang(lang: string | null | undefined): string {
    return typeof lang === 'string' && lang.trim() ? lang : DEFAULT_LANG;
}

/**
 * Shiki writes `background-color` and `color` inline on `<pre>`, which makes
 * the site stylesheet need `!important` to own code surfaces. Strip that
 * inline style so the theme tokens stay the single source of colour.
 */
const stripPreInlineStyle: ShikiTransformer = {
    pre(node) {
        delete node.properties.style;
    },
};

let config: ShikiRuntimeConfig = {};
let configResolved = false;
type CodeHighlighter = Pick<Highlighter, 'codeToHtml'>;
let cached: CodeHighlighter | null = null;
let pending: Promise<CodeHighlighter> | null = null;

/** @internal test hook */
export function getShikiRuntimeConfig(): Readonly<ShikiRuntimeConfig> {
    return config;
}

/** Reset module state (tests). */
export function resetShikiRuntimeForTests(): void {
    config = {};
    configResolved = false;
    cached = null;
    pending = null;
}

/**
 * Configure runtime before highlight (also called by `shiki()` plugin factory).
 */
export function configureShiki(opts: ShikiRuntimeConfig): void {
    if (opts.textmate) config.textmate = opts.textmate;
    if (opts.themes?.length) config.themes = [...opts.themes];
    configResolved = Boolean(opts.textmate);
    cached = null;
    pending = null;
}

async function resolveRuntimeConfig(): Promise<void> {
    if (configResolved) return;

    const globalCfg = (globalThis as { __vmzPluginShiki?: ShikiRuntimeConfig }).__vmzPluginShiki;
    if (globalCfg?.textmate) {
        config.textmate = globalCfg.textmate;
        if (globalCfg.themes?.length) config.themes = [...globalCfg.themes];
        configResolved = true;
        return;
    }

    try {
        if (typeof fetch === 'function') {
            const res = await fetch('/_vmz/plugin-shiki.config.json', { cache: 'no-store' });
            if (res.ok) {
                const parsed = (await res.json()) as ShikiRuntimeConfig;
                if (parsed.textmate) config.textmate = parsed.textmate;
                if (parsed.themes?.length) config.themes = [...parsed.themes];
            }
        }
    } catch {
        /* optional sidecar */
    }

    try {
        const dist = typeof process !== 'undefined' ? process.env.VMZ_DIST : undefined;
        if (dist) {
            const { readFile } = await import('node:fs/promises');
            const { join } = await import('node:path');
            const raw = await readFile(join(dist, '_vmz', 'plugin-shiki.config.json'), 'utf8');
            const parsed = JSON.parse(raw) as ShikiRuntimeConfig;
            if (parsed.textmate) config.textmate = parsed.textmate;
            if (parsed.themes?.length) config.themes = [...parsed.themes];
        }
    } catch {
        /* optional sidecar */
    }

    configResolved = true;
}

function textmateSpec(): string | null {
    return config.textmate || null;
}

async function loadTextmateHighlighter(themes: string[]): Promise<CodeHighlighter | null> {
    const spec = textmateSpec();
    if (!spec) return null;
    try {
        // The textmate adapter is an explicit opt-in module id resolved by the
        // host (serve-host resolve hooks, import map), never vendored by pack —
        // the generic path below is the pack-visible default.
        const mod = (await import(/* webpackIgnore: true */ spec)) as {
            createVmzHighlighter?: (opts: { themes?: string[]; langs?: unknown[] }) => Promise<CodeHighlighter>;
            createHighlighter?: (opts: { themes?: string[]; langs?: unknown[] }) => Promise<CodeHighlighter>;
            default?: { createVmzHighlighter?: (opts: { themes?: string[] }) => Promise<CodeHighlighter> };
        };
        const factory = mod.createVmzHighlighter ?? mod.createHighlighter ?? mod.default?.createVmzHighlighter;
        if (typeof factory === 'function') {
            // `return await` (not `return`): a rejected factory promise must be
            // caught here so the generic Shiki path below still runs.
            return await factory({ themes, langs: [] });
        }
    } catch {
        /* try generic shiki below */
    }
    return null;
}

async function loadGenericHighlighter(themes: string[]): Promise<Highlighter> {
    // Literal specifier only: a computed dynamic import (variable argument) is
    // invisible to the packer, so the browser chunk would keep a bare specifier
    // and fail with "Failed to resolve module specifier 'shiki'". Literal
    // imports let vmz-pack vendor the highlighter into an async client chunk.
    const { createHighlighter } = await import('shiki');
    return createHighlighter({
        themes,
        langs: ['javascript', 'typescript', 'tsx', 'jsx', 'json', 'html', 'css', 'markdown', 'bash', 'text'],
    });
}

export async function prewarmShiki(opts: { themes?: string[] } = {}): Promise<CodeHighlighter> {
    if (cached) return cached;
    if (pending) return pending;
    pending = (async () => {
        await resolveRuntimeConfig();
        const requested = opts.themes?.length ? opts.themes : config.themes?.length ? config.themes : [DEFAULT_THEME];
        const themes = requested.map((theme) => normalizeTheme(theme));
        const fromTextmate = await loadTextmateHighlighter(themes);
        cached = fromTextmate ?? (await loadGenericHighlighter(themes));
        return cached!;
    })();
    return pending;
}

export async function highlight(code: string, lang = 'text', theme: string | null = DEFAULT_THEME): Promise<string> {
    const safeTheme = normalizeTheme(theme);
    const safeLang = normalizeLang(lang);
    let highlighter: CodeHighlighter;
    try {
        highlighter = await prewarmShiki({ themes: [safeTheme] });
    } catch {
        // Highlighter bootstrap failure must not take the page down.
        return fallbackPre(code);
    }
    try {
        return highlighter.codeToHtml(code ?? '', {
            lang: safeLang,
            theme: safeTheme,
            transformers: [stripPreInlineStyle],
        });
    } catch {
        return fallbackPre(code);
    }
}

/** Sync highlight when prewarmed; otherwise escaped `<pre><code>`. */
export function highlightSync(code: string, lang = 'text', theme: string | null = DEFAULT_THEME): string {
    if (!cached) return fallbackPre(code);
    try {
        return cached.codeToHtml(code ?? '', {
            lang: normalizeLang(lang),
            theme: normalizeTheme(theme),
            transformers: [stripPreInlineStyle],
        });
    } catch {
        return fallbackPre(code);
    }
}

/**
 * Inline-structure sync highlight for embedders that own the `<pre>` chrome
 * (markdown-it fence callback in the document pipeline). Returns the token
 * spans only — no `<pre>` wrapper, no inline background. Empty string when no
 * highlighter is prewarmed so the embedder can fall back to escaped code.
 */
export function highlightInline(code: string, lang = 'text', theme: string | null = DEFAULT_THEME): string {
    if (!cached) return '';
    try {
        return cached.codeToHtml(code ?? '', {
            lang: normalizeLang(lang),
            theme: normalizeTheme(theme),
            structure: 'inline',
            transformers: [stripPreInlineStyle],
        });
    } catch {
        return '';
    }
}

function fallbackPre(code: string): string {
    const escaped = String(code ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    return `<pre class="shiki shiki-fallback"><code>${escaped}</code></pre>`;
}
