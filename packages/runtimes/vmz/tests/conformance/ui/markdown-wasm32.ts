/**
 * markdown-wasm32 thin gate — @vmz/markdown + wasm32 fallback.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);

function fail(msg: string): never {
    console.error(`markdown-wasm32 GATE FAIL: ${msg}`);
    process.exit(1);
}

const mdRoot = path.join(root, 'packages', 'content', 'vmz-markdown');
const wasmRoot = path.join(root, 'packages', 'content', 'vmz-markdown-unknown-wasm32');

console.log('markdown-wasm32: package identity…');
for (const [dir, name] of [
    [mdRoot, '@vmz/markdown'],
    [wasmRoot, '@vmz/markdown-unknown-wasm32'],
] as const) {
    const pkgPath = path.join(dir, 'package.json');
    if (!fs.existsSync(pkgPath)) fail(`missing ${path.relative(root, pkgPath)}`);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (pkg.name !== name) fail(`${path.relative(root, pkgPath)} name want ${name}, got ${pkg.name}`);
    if (pkg.private !== true) fail(`${name} must be private`);
    if (pkg.type !== 'module') fail(`${name} must be type:module`);
}

const mdPkg = JSON.parse(fs.readFileSync(path.join(mdRoot, 'package.json'), 'utf8'));
if (!mdPkg.exports?.['.']) fail('@vmz/markdown missing exports "."');
if (mdPkg.dependencies?.['markdown-it'] || mdPkg.devDependencies?.['markdown-it']) {
    fail('@vmz/markdown must not depend on markdown-it (replaceable default)');
}

const wasmPkg = JSON.parse(fs.readFileSync(path.join(wasmRoot, 'package.json'), 'utf8'));
if (!wasmPkg.dependencies?.['@vmz/markdown'] && !wasmPkg.peerDependencies?.['@vmz/markdown']) {
    fail('@vmz/markdown-unknown-wasm32 must depend on @vmz/markdown');
}

console.log('markdown-wasm32: build outputs…');
if (!fs.existsSync(path.join(mdRoot, 'dist', 'index.js'))) {
    fail('missing @vmz/markdown dist — run pnpm --filter @vmz/markdown build');
}
if (!fs.existsSync(path.join(wasmRoot, 'dist', 'index.js'))) {
    fail('missing @vmz/markdown-unknown-wasm32 dist — run pnpm --filter @vmz/markdown-unknown-wasm32 build');
}

console.log('markdown-wasm32: plain render…');
const md = await import(pathToFileURL(path.join(mdRoot, 'dist', 'index.js')).href);
const { createPlainMarkdown, registerMarkdown, getMarkdown, resetMarkdownForTests } = md;
resetMarkdownForTests?.();
const plain = createPlainMarkdown();
const out = await plain.render('# Hello\n\npara `<raw>`\n\n```js\nconst x = 1 < 2;\n```');
if (!out?.html?.includes('<h1>Hello</h1>')) fail(`heading missing: ${out?.html}`);
if (!out.html.includes('<p>') || !out.html.includes('&lt;raw&gt;')) {
    fail(`paragraph escape missing: ${out.html}`);
}
if (!out.html.includes('vmz-md-fence') || !out.html.includes('&lt;')) {
    fail(`fence escape missing: ${out.html}`);
}

registerMarkdown(plain);
if (getMarkdown().id !== plain.id) fail('getMarkdown did not return registered engine');

console.log('markdown-wasm32: wasm32 fallback…');
const wasm = await import(pathToFileURL(path.join(wasmRoot, 'dist', 'index.js')).href);
if (typeof wasm.createUnknownWasm32Markdown !== 'function') {
    fail('@vmz/markdown-unknown-wasm32 must export createUnknownWasm32Markdown');
}
const wasmMd = wasm.createUnknownWasm32Markdown();
if (wasmMd.target !== 'wasm32') fail(`wasm32 markdown target want wasm32, got ${wasmMd.target}`);
const wasmOut = await wasmMd.render('## Title');
if (!wasmOut?.html?.includes('vmz-markdown--wasm32')) fail('wasm32 markdown missing marker class');
if (!wasmOut.html.includes('<h2>Title</h2>')) fail(`wasm32 markdown heading missing: ${wasmOut.html}`);

console.log('markdown-wasm32: PASS');
