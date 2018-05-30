/**
 * MathJax TeX -> SVG helper (MathJax v4 / `@mathjax/src`).
 * Prefer KaTeX for common docs; MathJax for heavier TeX coverage.
 */

type TexConvert = (tex: string, display: boolean) => string;

let tex2svg: TexConvert | null = null;

const EM = 16;
const EX = 8;

async function getConvert(): Promise<TexConvert> {
    if (tex2svg) return tex2svg;

    const { mathjax } = await import('@mathjax/src/js/mathjax.js');
    const { TeX } = await import('@mathjax/src/js/input/tex.js');
    const { SVG } = await import('@mathjax/src/js/output/svg.js');
    const { liteAdaptor } = await import('@mathjax/src/js/adaptors/liteAdaptor.js');
    const { RegisterHTMLHandler } = await import('@mathjax/src/js/handlers/html.js');
    await import('@mathjax/src/js/util/asyncLoad/esm.js');
    await import('@mathjax/src/js/input/tex/base/BaseConfiguration.js');
    await import('@mathjax/src/js/input/tex/ams/AmsConfiguration.js');

    const adaptor = liteAdaptor({ fontSize: EM });
    RegisterHTMLHandler(adaptor);

    const html = mathjax.document('', {
        InputJax: new TeX({ packages: ['base', 'ams'] }),
        OutputJax: new SVG({ fontCache: 'none', exFactor: EX / EM }),
    });

    tex2svg = (tex, display) => {
        const node = html.convert(tex ?? '', {
            display: !!display,
            em: EM,
            ex: EX,
            containerWidth: 80 * EM,
        });
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
