/**
 * SSR escaping must survive the HTML input stream byte-for-byte.
 *
 * A literal CR (and CRLF) is normalized to LF before tokenization, so a raw
 * `\r` in the response never reaches the DOM: hydration then rewrites text and
 * attribute values to different bytes. CR must be emitted as `&#13;`.
 */
import { strict as assert } from 'node:assert';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseHTML } from 'linkedom';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const href = pathToFileURL(path.join(root, 'packages/runtimes/vmz-runtime/dist/faces/dom.js')).href;
const { renderToString, renderToStream } = await import(href);

const CR = 'l1\r\nl2\rmid';
const TRICKY = 'a"b\'c<d&e';
const LINE_SEPS = 'x\u2028y\u2029z';

class Escapes {
    static __vmzDirect = true;
    static __vmzCreate(api: any) {
        const root = api.el('div');
        api.attr(root, 'data-cr', CR);
        api.attr(root, 'data-esc', TRICKY);
        api.attr(root, 'data-u', LINE_SEPS);
        const p = api.el('p');
        p.appendChild(api.text(CR));
        const q = api.el('p');
        q.appendChild(api.text(TRICKY));
        const r = api.el('p');
        r.appendChild(api.text(LINE_SEPS));
        root.appendChild(p);
        root.appendChild(q);
        root.appendChild(r);
        return root;
    }
}

const html = await renderToString(Escapes);
assert.ok(!html.includes('\r'), `SSR must not emit a raw CR: ${JSON.stringify(html)}`);
assert.ok(html.includes('l1&#13;\nl2&#13;mid'), `CR must be a character reference: ${JSON.stringify(html)}`);
assert.ok(html.includes('a&quot;b\'c&lt;d&amp;e'), `quotes/angle/ampersand escaping regressed: ${JSON.stringify(html)}`);
assert.ok(html.includes('x\u2028y\u2029z'), 'U+2028/U+2029 are valid text and must stay verbatim');

const chunks: string[] = [];
for await (const chunk of renderToStream(Escapes)) chunks.push(chunk);
assert.equal(chunks.join(''), html, 'streamed and flattened SSR must agree');

const { document } = parseHTML(`<!DOCTYPE html><html><body><div id="app">${html}</div></body></html>`);
const app = document.getElementById('app')!.firstElementChild!;
assert.equal(app.getAttribute('data-cr'), CR, 'parsed SSR attribute must equal the source value');
assert.equal(app.getAttribute('data-esc'), TRICKY, 'parsed SSR attribute must equal the source value');
const ps = app.querySelectorAll('p');
assert.equal(ps[0].textContent, CR, 'parsed SSR text must equal the source value');
assert.equal(ps[1].textContent, TRICKY, 'parsed SSR text must equal the source value');
assert.equal(ps[2].textContent, LINE_SEPS, 'U+2028/U+2029 must survive parsing');

console.log('ssr-escape-cr ok');
