/**
 * Replaceable markdown surface. Default is a minimal safe subset —
 * headings, paragraphs, fenced code as escaped pre. No markdown-it.
 */

export type MarkdownRenderOptions = {
    /** Optional language hint for fenced blocks (informative only). */
    defaultFenceLanguage?: string;
};

export type MarkdownResult = {
    html: string;
};

export type MarkdownEngine = {
    readonly id: string;
    readonly target?: string;
    render(source: string, options?: MarkdownRenderOptions): MarkdownResult | Promise<MarkdownResult>;
};

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Minimal safe subset:
 * - ATX headings `#`–`######`
 * - fenced code ``` … ```
 * - remaining blocks → paragraphs
 */
export function createPlainMarkdown(id = 'plain'): MarkdownEngine {
    return {
        id,
        target: 'plain',
        render(source: string, _options?: MarkdownRenderOptions): MarkdownResult {
            const text = String(source ?? '').replace(/\r\n/g, '\n');
            const parts: string[] = [];
            const lines = text.split('\n');
            let i = 0;
            let para: string[] = [];

            const flushPara = () => {
                if (para.length === 0) return;
                const body = escapeHtml(para.join('\n').trim());
                if (body) parts.push(`<p>${body}</p>`);
                para = [];
            };

            while (i < lines.length) {
                const line = lines[i]!;
                const fence = line.match(/^```([\w-]*)\s*$/);
                if (fence) {
                    flushPara();
                    const lang = fence[1] || '';
                    const bodyLines: string[] = [];
                    i += 1;
                    while (i < lines.length && !/^```\s*$/.test(lines[i]!)) {
                        bodyLines.push(lines[i]!);
                        i += 1;
                    }
                    i += 1; // closing fence or EOF
                    const langAttr = lang ? ` data-language="${escapeHtml(lang)}"` : '';
                    parts.push(
                        `<pre class="vmz-md-fence"${langAttr}><code>${escapeHtml(bodyLines.join('\n'))}</code></pre>`,
                    );
                    continue;
                }

                const heading = line.match(/^(#{1,6})\s+(.+)$/);
                if (heading) {
                    flushPara();
                    const level = heading[1]!.length;
                    parts.push(`<h${level}>${escapeHtml(heading[2]!.trim())}</h${level}>`);
                    i += 1;
                    continue;
                }

                if (line.trim() === '') {
                    flushPara();
                    i += 1;
                    continue;
                }

                para.push(line);
                i += 1;
            }
            flushPara();

            return { html: parts.join('\n') || '<p></p>' };
        },
    };
}

let active: MarkdownEngine = createPlainMarkdown();

export function registerMarkdown(engine: MarkdownEngine): void {
    if (!engine || typeof engine.render !== 'function') {
        throw new TypeError('registerMarkdown: invalid markdown engine');
    }
    active = engine;
}

export function getMarkdown(): MarkdownEngine {
    return active;
}

/** Test / bootstrap hook — restore plain default. */
export function resetMarkdownForTests(): void {
    active = createPlainMarkdown();
}
