import type { Mermaid } from 'mermaid';

let mermaid: Mermaid | null = null;

async function getMermaid(): Promise<Mermaid> {
    if (mermaid) return mermaid;
    const mod = await import('mermaid');
    mermaid = (mod.default ?? mod) as Mermaid;
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
    return mermaid;
}

/** Render Mermaid source to SVG HTML. */
export async function renderMermaid(source: string, id = 'vmz-mmd'): Promise<string> {
    const m = await getMermaid();
    const { svg } = await m.render(id.replace(/[^a-zA-Z0-9_-]/g, '_'), source ?? '');
    return svg;
}

/** Sync fallback when not yet loaded. */
export function renderMermaidFallback(source: string): string {
    const escaped = String(source ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    return `<pre class="mermaid-fallback">${escaped}</pre>`;
}
