/**
 * Language-neutral highlighter surface for VMZ content engines.
 * Default implementation is plain HTML-escape highlight (no grammar runtime).
 * Concrete engines (syntect / shiki / wasm32) register via `registerHighlighter`.
 */

/** UTF-8 / UTF-16 agnostic byte or code-unit offsets — consumers map to line/col. */
export type SourceSpan = {
    start: number;
    end: number;
};

export type HighlightToken = {
    text: string;
    span: SourceSpan;
    scopes?: string[];
};

export type HighlightTheme = {
    id: string;
    displayName?: string;
};

export type HighlightOptions = {
    language?: string;
    theme?: string | HighlightTheme;
};

export type HighlightResult = {
    html: string;
    tokens: HighlightToken[];
    language?: string;
    theme?: string;
};

/**
 * Compile-time / SSR native code artifact. Source mapping is offset-only —
 * never bake UTF-8/UTF-16 column numbers into the artifact.
 */
export type NativeCodeArtifact = {
    kind: 'native-code';
    source: string;
    language?: string;
    /** Pre-rendered static markup when available (no client grammar). */
    html?: string;
    tokens?: HighlightToken[];
    spans?: SourceSpan[];
};

export type Highlighter = {
    readonly id: string;
    readonly target?: string;
    highlight(code: string, options?: HighlightOptions): HighlightResult | Promise<HighlightResult>;
};

function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Plain fallback: escape + wrap in pre/code. No grammar, no WASM. */
export function createPlainHighlighter(id = 'plain'): Highlighter {
    return {
        id,
        target: 'plain',
        highlight(code: string, options?: HighlightOptions): HighlightResult {
            const source = String(code ?? '');
            const escaped = escapeHtml(source);
            const language = options?.language;
            const theme = typeof options?.theme === 'string' ? options.theme : options?.theme?.id;
            const langAttr = language ? ` data-language="${escapeHtml(language)}"` : '';
            return {
                html: `<pre class="vmz-highlight"${langAttr}><code>${escaped}</code></pre>`,
                tokens: [
                    {
                        text: source,
                        span: { start: 0, end: source.length },
                        scopes: ['source'],
                    },
                ],
                language,
                theme,
            };
        },
    };
}

let active: Highlighter = createPlainHighlighter();

export function registerHighlighter(highlighter: Highlighter): void {
    if (!highlighter || typeof highlighter.highlight !== 'function') {
        throw new TypeError('registerHighlighter: invalid highlighter');
    }
    active = highlighter;
}

export function getHighlighter(): Highlighter {
    return active;
}

/** Test / bootstrap hook — restore plain default. */
export function resetHighlighterForTests(): void {
    active = createPlainHighlighter();
}

export { escapeHtml };
