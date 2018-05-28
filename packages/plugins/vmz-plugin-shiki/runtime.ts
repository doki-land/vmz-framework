/**
 * Shiki highlight helper — async with optional sync cache after prewarm.
 * For `lang === 'vmz'`, prefers `vmz-textmate/shiki` when available.
 */

import type { Highlighter } from 'shiki';

let cached: Highlighter | null = null;
let pending: Promise<Highlighter> | null = null;

export async function prewarmShiki(opts: { themes?: string[] } = {}): Promise<Highlighter> {
    if (cached) return cached;
    if (pending) return pending;
    pending = (async () => {
        const themes = opts.themes?.length ? opts.themes : ['vitesse-dark'];
        try {
            const { createVmzHighlighter } = await import('vmz-textmate/shiki');
            cached = await createVmzHighlighter({ themes });
        } catch {
            const { createHighlighter } = await import('shiki');
            cached = await createHighlighter({
                themes,
                langs: ['javascript', 'typescript', 'tsx', 'jsx', 'json', 'html', 'css', 'markdown', 'bash'],
            });
        }
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
