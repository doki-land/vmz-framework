/**
 * Unknown / wasm32 markdown fallback stub.
 * Marks `target: 'wasm32'` and delegates to plain markdown — no .wasm binary.
 */

import { createPlainMarkdown, type MarkdownEngine, type MarkdownRenderOptions, type MarkdownResult } from '@vmz/markdown';

export function createUnknownWasm32Markdown(id = 'unknown-wasm32'): MarkdownEngine {
    const plain = createPlainMarkdown(`${id}:plain`);
    return {
        id,
        target: 'wasm32',
        async render(source: string, options?: MarkdownRenderOptions): Promise<MarkdownResult> {
            const result = await plain.render(source, options);
            return {
                html: `<div class="vmz-markdown vmz-markdown--wasm32">${result.html}</div>`,
            };
        },
    };
}
