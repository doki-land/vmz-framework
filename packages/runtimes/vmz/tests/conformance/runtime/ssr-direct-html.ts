/** Direct v-html must serialize raw HTML on the first server response. */
import { strict as assert } from 'node:assert';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const href = pathToFileURL(path.join(root, 'packages/runtimes/vmz-runtime/dist/faces/dom.js')).href;
const { renderToString } = await import(href);

class RawHtml {
    static __vmzDirect = true;
    static __vmzState = ['html'];
    html = '<strong>Rendered</strong>';
    static __vmzCreate(
        this: RawHtml,
        api: { el: (tag: string) => { innerHTML: string }; attr: (el: unknown, name: string, value: string) => void },
    ) {
        const el = api.el('div');
        el.innerHTML = this.html;
        api.attr(el, 'class', 'raw-html');
        return el;
    }
}

// The payload digest marker rides on the host so resume can keep this exact
// subtree, and its `[0-9a-z-]` alphabet must survive serialization unescaped.
assert.match(
    await renderToString(RawHtml),
    /^<div class="raw-html" data-vmz-html-hash="[0-9a-z-]+"><strong>Rendered<\/strong><\/div>$/,
);
console.log('ssr-direct-html ok');
