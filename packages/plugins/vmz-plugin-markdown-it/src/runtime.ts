/**
 * Deterministic CommonMark-ish subset for documents + `<Markdown>` .
 */
import MarkdownIt from 'markdown-it';

/** @type {import('markdown-it').default | null} */
let cached = null;

function createMd() {
    if (cached) return cached;
    cached = new MarkdownIt({
        html: false,
        linkify: true,
        typographer: false,
        breaks: false,
    });
    return cached;
}

/**
 * @param {string} source
 * @returns {string} HTML fragment (no wrapping document)
 */
export function renderMarkdown(source) {
    const md = createMd();
    return md.render(String(source ?? ''));
}

/**
 * @param {string} source
 * @returns {{
 * html: string,
 * headings: Array<{ level: number, id: string, text: string }>,
 * links: Array<{ href: string, text: string }>,
 * fences: Array<{ lang: string, info: string, content: string, lineStart: number, lineEnd: number }>
 * }}
 */
export function analyzeMarkdown(source) {
    const md = createMd();
    const tokens = md.parse(String(source ?? ''), {});
    /** @type {Array<{ level: number, id: string, text: string }>} */
    const headings = [];
    /** @type {Array<{ href: string, text: string }>} */
    const links = [];
    /** @type {Array<{ lang: string, info: string, content: string, lineStart: number, lineEnd: number }>} */
    const fences = [];
    const seenIds = new Set();

    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.type === 'heading_open') {
            const level = Number(String(t.tag || 'h1').slice(1)) || 1;
            const inline = tokens[i + 1];
            const text = inline && inline.type === 'inline' ? inline.content : '';
            let id = slugify(text);
            if (seenIds.has(id)) {
                let n = 2;
                while (seenIds.has(`${id}-${n}`)) n++;
                id = `${id}-${n}`;
            }
            seenIds.add(id);
            headings.push({ level, id, text });
            // Inject id into open token attrs for render.
            t.attrSet('id', id);
        }
        if (t.type === 'fence') {
            const info = String(t.info || '').trim();
            const lang = (info.split(/\s+/)[0] || '').toLowerCase();
            const map = Array.isArray(t.map) ? t.map : [0, 0];
            fences.push({
                lang,
                info,
                content: String(t.content || ''),
                lineStart: map[0] + 1,
                lineEnd: map[1],
            });
        }
        if (t.type === 'inline' && Array.isArray(t.children)) {
            for (const c of t.children) {
                if (c.type === 'link_open') {
                    const href = c.attrGet('href') || '';
                    links.push({ href, text: '' });
                }
            }
        }
    }

    const html = md.renderer.render(tokens, md.options, {});
    return { html, headings, links, fences };
}

/** @param {string} text */
export function slugify(text) {
    return (
        String(text || '')
            .trim()
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s_-]/gu, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '') || 'section'
    );
}
