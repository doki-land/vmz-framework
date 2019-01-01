/**
 * Unknown-language / missing-grammar wasm32 fallback highlighter.
 * Thin gate stub: marks `target: 'wasm32'` and delegates to plain highlight.
 * No real .wasm binary is shipped here.
 */

import { createPlainHighlighter, type HighlightOptions, type HighlightResult, type Highlighter } from '@vmz/highlighter';

export function createUnknownWasm32Highlighter(id = 'unknown-wasm32'): Highlighter {
    const plain = createPlainHighlighter(`${id}:plain`);
    return {
        id,
        target: 'wasm32',
        async highlight(code: string, options?: HighlightOptions): Promise<HighlightResult> {
            const result = await plain.highlight(code, options);
            return {
                ...result,
                html: result.html.replace('class="vmz-highlight"', 'class="vmz-highlight vmz-highlight--wasm32"'),
            };
        },
    };
}
