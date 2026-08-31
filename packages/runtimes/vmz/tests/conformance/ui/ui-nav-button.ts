/**
 * ui-nav-button — `Button` with `href` renders a single navigable anchor control.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const vmzBin = path.join(root, 'packages', 'runtimes', 'vmz', 'bin', 'vmz.js');
const homepage = path.join(root, 'packages', 'homepage');

function fail(msg) {
    console.error(`ui-nav-button GATE FAIL: ${msg}`);
    process.exit(1);
}

console.log('ui-nav-button: build homepage (Button from @vmz/ui)…');
const build = spawnSync(process.execPath, [vmzBin, 'build', homepage], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
});
if (build.status !== 0) fail(`homepage build failed\n${build.stdout}\n${build.stderr}`);

const dist = path.join(homepage, 'dist', 'web-ssr');
const buttonJs = path.join(dist, 'components', 'Button.client.js');
if (!fs.existsSync(buttonJs)) {
    fail(`missing ${buttonJs}`);
}
const src = fs.readFileSync(buttonJs, 'utf8');
if (!src.includes('api.el("a"') && !src.includes("api.el('a'")) {
    fail('Button.client.js missing anchor element emit for href nav');
}
if (!src.includes('href')) fail('Button.client.js missing href binding');

console.log('ui-nav-button: SSR anchor with href…');
const domHref = pathToFileURL(path.join(root, 'packages', 'runtimes', 'vmz-runtime', 'dist', 'dom.js')).href;
const { registerComponents, renderToString } = await import(domHref);
const { default: Button } = await import(pathToFileURL(buttonJs).href);
registerComponents({ Button });
const html = await renderToString(Button, { href: '/playground', variant: 'primary', type: 'button' });
if (!html.includes('<a') || !html.includes('href="/playground"')) {
    fail(`expected anchor href, got: ${html.slice(0, 400)}`);
}
if (html.includes('<button')) fail('href Button must not also emit <button>');

console.log('ui-nav-button GATE PASS: single navigable Button anchor');
