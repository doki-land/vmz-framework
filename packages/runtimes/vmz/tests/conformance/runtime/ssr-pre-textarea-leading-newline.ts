/**
 * `<pre>` / `<textarea>` drop one leading LF token after their start tag
 * (HTML tree construction). SSR must emit one sacrificial newline when the
 * value itself starts with LF, or the parsed DOM loses a real newline and
 * hydration rewrites a different value than the client renders.
 */
import { strict as assert } from 'node:assert';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const href = pathToFileURL(path.join(root, 'packages/runtimes/vmz-runtime/dist/faces/dom.js')).href;
const { renderToString, renderToStream } = await import(href);

class PreTextarea {
    static __vmzDirect = true;
    static __vmzCreate(api: any) {
        const root = api.el('div');
        const pre = api.el('pre');
        pre.appendChild(api.text('\nfoo\n  bar  \n'));
        const preBare = api.el('pre');
        preBare.appendChild(api.text('foo'));
        const preNested = api.el('pre');
        preNested.appendChild(api.el('b'));
        preNested.appendChild(api.text('\nfoo'));
        const ta = api.el('textarea');
        api.attr(ta, 'value', '\nfoo\n  bar  \n');
        const taBare = api.el('textarea');
        api.attr(taBare, 'value', 'foo');
        const taEmpty = api.el('textarea');
        api.attr(taEmpty, 'value', '');
        root.appendChild(pre);
        root.appendChild(preBare);
        root.appendChild(preNested);
        root.appendChild(ta);
        root.appendChild(taBare);
        root.appendChild(taEmpty);
        return root;
    }
}

const html = await renderToString(PreTextarea);
assert.ok(html.includes('<pre>\n\nfoo\n  bar  \n</pre>'), `pre lost its sacrificial newline: ${JSON.stringify(html)}`);
assert.ok(html.includes('<pre>foo</pre>'), `pre without a leading LF must not gain one: ${JSON.stringify(html)}`);
assert.ok(html.includes('<pre><b></b>\nfoo</pre>'), `a leading element must not trigger a sacrificial newline: ${JSON.stringify(html)}`);
assert.ok(
    html.includes('<textarea>\n\nfoo\n  bar  \n</textarea>'),
    `textarea lost its sacrificial newline: ${JSON.stringify(html)}`,
);
assert.ok(html.includes('<textarea>foo</textarea>'), `textarea without a leading LF must not gain one: ${JSON.stringify(html)}`);
assert.ok(html.includes('<textarea></textarea>'), `empty textarea must stay empty: ${JSON.stringify(html)}`);

const chunks: string[] = [];
for await (const chunk of renderToStream(PreTextarea)) chunks.push(chunk);
assert.equal(chunks.join(''), html, 'streamed and flattened SSR must agree');

console.log('ssr-pre-textarea-leading-newline ok');
