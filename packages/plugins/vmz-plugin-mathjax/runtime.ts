/**
 * MathJax TeX → HTML/SVG helper.
 * Prefer KaTeX for common docs; MathJax for heavier TeX coverage.
 */

type TexConvert = (tex: string, display: boolean) => string;

let tex2svg: TexConvert | null = null;

async function getConvert(): Promise<TexConvert> {
    if (tex2svg) return tex2svg;
    const { mathjax } = await import('mathjax-full/js/mathjax.js');
    const { TeX } = await import('mathjax-full/js/input/tex.js');
    const { SVG } = await import('mathjax-full/js/output/svg.js');
    const { liteAdaptor } = await import('mathjax-full/js/adaptors/liteAdaptor.js');
    const { RegisterHTMLHandler } = await import('mathjax-full/js/handlers/html.js');
    const adaptor = liteAdaptor();
    RegisterHTMLHandler(adaptor);
    const html = mathjax.document('', {
        InputJax: new TeX({ packages: ['base', 'ams'] }),
        OutputJax: new SVG({ fontCache: 'none' }),
    });
    tex2svg = (tex, display) => {
        const node = html.convert(tex ?? '', { display: !!display });
        return adaptor.outerHTML(node);
    };
    return tex2svg;
}

export async function renderMathjax(tex: string, display = false): Promise<string> {
    const convert = await getConvert();
    return convert(tex, display);
}

export function renderMathjaxFallback(tex: string): string {
    const escaped = String(tex ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    return `<span class="mathjax-fallback">${escaped}</span>`;
}
