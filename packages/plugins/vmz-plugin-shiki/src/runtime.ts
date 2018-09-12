/**
 * Shiki highlight helper — async with optional sync cache after prewarm.
 * TextMate grammar via configurable peer (default `vmz-textmate/shiki`).
 */

import type { Highlighter } from 'shiki';

export type ShikiRuntimeConfig = {
    /** Shiki + TextMate adapter module (default `vmz-textmate/shiki`). */
    textmate?: string;
    /** Default themes passed to the textmate highlighter factory. */
    themes?: string[];
};

const DEFAULT_TEXTMATE = 'vmz-textmate/shiki';

let config: ShikiRuntimeConfig = {};
let configResolved = false;
let cached: Highlighter | null = null;
let pending: Promise<Highlighter> | null = null;

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

function textmateSpec(): string {
    return config.textmate || DEFAULT_TEXTMATE;
}

async function loadTextmateHighlighter(themes: string[]): Promise<Highlighter | null> {
    const spec = textmateSpec();
    try {
        const mod = (await import(/* webpackIgnore: true */ spec)) as {
            createVmzHighlighter?: (opts: { themes?: string[]; langs?: unknown[] }) => Promise<Highlighter>;
            createHighlighter?: (opts: { themes?: string[]; langs?: unknown[] }) => Promise<Highlighter>;
            default?: { createVmzHighlighter?: (opts: { themes?: string[] }) => Promise<Highlighter> };
        };
        const factory = mod.createVmzHighlighter ?? mod.createHighlighter ?? mod.default?.createVmzHighlighter;
        if (typeof factory === 'function') {
            return factory({ themes, langs: [] });
        }
    } catch {
        /* try generic shiki below */
    }
    return null;
}

async function loadGenericHighlighter(themes: string[]): Promise<Highlighter> {
    const { createHighlighter } = await import('shiki');
    return createHighlighter({
        themes,
        langs: ['javascript', 'typescript', 'tsx', 'jsx', 'json', 'html', 'css', 'markdown', 'bash', 'text'],
    });
}

export async function prewarmShiki(opts: { themes?: string[] } = {}): Promise<Highlighter> {
    if (cached) return cached;
    if (pending) return pending;
    pending = (async () => {
        await resolveRuntimeConfig();
        const themes = opts.themes?.length ? opts.themes : config.themes?.length ? config.themes : ['vitesse-dark'];
        const fromTextmate = await loadTextmateHighlighter(themes);
        cached = fromTextmate ?? (await loadGenericHighlighter(themes));
        return cached!;
    })();
    return pending;
}

export async function highlight(code: string, lang = 'text', theme = 'vitesse-dark'): Promise<string> {
    const highlighter = await prewarmShiki({ themes: [theme] });
    try {
        return highlighter.codeToHtml(code ?? '', {
            lang: lang || 'text',
            theme,
        });
    } catch {
        return fallbackPre(code);
    }
}

/** Sync highlight when prewarmed; otherwise escaped `<pre><code>`. */
export function highlightSync(code: string, lang = 'text', theme = 'vitesse-dark'): string {
    if (!cached) return fallbackPre(code);
    try {
        return cached.codeToHtml(code ?? '', {
            lang: lang || 'text',
            theme,
        });
    } catch {
        return fallbackPre(code);
    }
}

function fallbackPre(code: string): string {
    const escaped = String(code ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    return `<pre class="shiki shiki-fallback"><code>${escaped}</code></pre>`;
}
