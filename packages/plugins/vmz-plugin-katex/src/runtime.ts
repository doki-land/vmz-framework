/** Optional helpers for apps that want KaTeX outside the materialized component. */

export async function renderKatex(tex: string, display = false): Promise<string> {
    const mod = await import('katex');
    const katex = mod.default ?? mod;
    return katex.renderToString(tex ?? '', {
        displayMode: !!display,
        throwOnError: false,
    });
}
