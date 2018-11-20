/**
 * ui-direct-host-box — shared resolver + SSR host `display:contents` for chips.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);

function fail(msg) {
    console.error(`ui-direct-host-box GATE FAIL: ${msg}`);
    process.exit(1);
}

const distBox = path.join(root, 'packages', 'runtimes', 'vmz-runtime', 'dist', 'direct-host-box.js');
if (!fs.existsSync(distBox)) {
    fail(`missing ${distBox} — run pnpm --filter @vmz/core build`);
}

const { resolveDirectHostBox, INLINE_HOST_CONTENTS, directHostBoxStyleAttr } = await import(pathToFileURL(distBox).href);

console.log('ui-direct-host-box: resolveDirectHostBox…');
if (!INLINE_HOST_CONTENTS.has('Button')) fail('INLINE_HOST_CONTENTS missing Button');
if (resolveDirectHostBox('Button', null) !== 'contents') fail('Button default want contents');
if (resolveDirectHostBox('Badge', null) !== 'contents') fail('Badge default want contents');
if (resolveDirectHostBox('Notification', null) !== 'block') fail('Notification default want block');
if (resolveDirectHostBox('DataTable', null) !== 'block') fail('DataTable default want block');
if (resolveDirectHostBox('Button', { __vmzHostBox: 'block' }) !== 'block') fail('explicit block wins');
if (resolveDirectHostBox('Card', { __vmzHostBox: 'contents' }) !== 'contents') fail('explicit contents wins');
if (directHostBoxStyleAttr('Button', { __vmzHostBox: 'contents' }) !== 'display:contents') {
    fail('directHostBoxStyleAttr Button want display:contents');
}
if (directHostBoxStyleAttr('Notification', null) != null) fail('Notification must not emit contents style');

console.log('ui-direct-host-box: @vmz/ui chip meta…');
for (const name of ['Button', 'Badge', 'Link', 'Tag', 'Icon']) {
    const src = fs.readFileSync(path.join(root, 'packages', 'ui', 'vmz-ui', 'src', 'components', `${name}.vmz`), 'utf8');
    if (!src.includes("__vmzHostBox = 'contents'") && !src.includes('__vmzHostBox = "contents"')) {
        fail(`${name}.vmz missing static __vmzHostBox = contents`);
    }
}

console.log('ui-direct-host-box: SSR serialize Button host…');
const { registerComponents, renderToString } = await import(
    pathToFileURL(path.join(root, 'packages', 'runtimes', 'vmz-runtime', 'dist', 'dom.js')).href
);

class Button {
    static __vmzDirect = true;
    static __vmzHostBox = 'contents';
    static __vmzCreate(api) {
        const el = api.el('button');
        api.attr(el, 'class', 'vmz-ui-btn');
        el.appendChild(api.text('Chip'));
        return el;
    }
}

class Notification {
    static __vmzDirect = true;
    static __vmzHostBox = 'block';
    static __vmzCreate(api) {
        const el = api.el('div');
        api.attr(el, 'class', 'vmz-ui-notification');
        el.appendChild(api.text('Note'));
        return el;
    }
}

registerComponents({ Button, Notification });

class Page {
    static __vmzDirect = true;
    static __vmzCreate(api) {
        const root = api.el('div');
        api.attr(root, 'data-vmz-fixture', 'host-box');
        root.appendChild(api.component(this, 'Button', {}, null));
        root.appendChild(api.component(this, 'Notification', {}, null));
        return root;
    }
}

const html = await renderToString(Page, {});
if (!html.includes('data-vmz="Button"')) fail(`SSR missing Button host: ${html.slice(0, 400)}`);
if (!/data-vmz="Button"[^>]*style="display:contents"/.test(html) && !/style="display:contents"[^>]*data-vmz="Button"/.test(html)) {
    // attribute order may vary
    const buttonHost = html.match(/<div[^>]*data-vmz="Button"[^>]*>/);
    if (!buttonHost || !buttonHost[0].includes('display:contents')) {
        fail(`Button host missing display:contents: ${buttonHost?.[0] || html.slice(0, 500)}`);
    }
}
const notifHost = html.match(/<div[^>]*data-vmz="Notification"[^>]*>/);
if (!notifHost) fail(`SSR missing Notification host: ${html.slice(0, 400)}`);
if (notifHost[0].includes('display:contents')) fail(`Notification must keep layout box: ${notifHost[0]}`);

console.log('ui-direct-host-box PASS');
