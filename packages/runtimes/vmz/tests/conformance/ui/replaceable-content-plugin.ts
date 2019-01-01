/**
 * replaceable-content-plugin — third-party highlighter registration shape
 * (syntect-flavored) without compiler core hard-coding engine filenames.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);

function fail(msg: string): never {
    console.error(`replaceable-content-plugin GATE FAIL: ${msg}`);
    process.exit(1);
}

const syntectRoot = path.join(root, 'packages', 'plugins', 'vmz-plugin-syntect');
const hlRoot = path.join(root, 'packages', 'content', 'vmz-highlighter');

console.log('replaceable-content-plugin: package identity…');
const pkgPath = path.join(syntectRoot, 'package.json');
if (!fs.existsSync(pkgPath)) fail('missing packages/plugins/vmz-plugin-syntect/package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
if (pkg.name !== '@vmz/plugin-syntect') fail(`name want @vmz/plugin-syntect, got ${pkg.name}`);
if (!pkg.dependencies?.['@vmz/highlighter'] && !pkg.peerDependencies?.['@vmz/highlighter']) {
    fail('@vmz/plugin-syntect must depend on @vmz/highlighter');
}

// Compiler crates must not hard-code syntect / comrak / shiki as core deps.
console.log('replaceable-content-plugin: compiler core free of engine pins…');
const compilerCargo = path.join(root, 'packages', 'compilers', 'vmz-compiler', 'Cargo.toml');
const cargo = fs.readFileSync(compilerCargo, 'utf8').toLowerCase();
for (const banned of ['syntect', 'comrak', 'shiki']) {
    if (cargo.includes(banned)) fail(`vmz-compiler Cargo.toml must not pin ${banned}`);
}

console.log('replaceable-content-plugin: build outputs…');
if (!fs.existsSync(path.join(syntectRoot, 'dist', 'index.js'))) {
    fail('missing @vmz/plugin-syntect dist — run pnpm --filter @vmz/plugin-syntect build');
}
if (!fs.existsSync(path.join(hlRoot, 'dist', 'index.js'))) {
    fail('missing @vmz/highlighter dist — run pnpm --filter @vmz/highlighter build');
}

console.log('replaceable-content-plugin: register via factory…');
const hl = await import(pathToFileURL(path.join(hlRoot, 'dist', 'index.js')).href);
hl.resetHighlighterForTests?.();
const syn = await import(pathToFileURL(path.join(syntectRoot, 'dist', 'index.js')).href);
if (typeof syn.syntect !== 'function') fail('@vmz/plugin-syntect must export syntect()');
const registered = syn.syntect({ id: 'syntect-gate' });
if (registered?.id !== 'syntect-gate') fail(`syntect() id want syntect-gate, got ${registered?.id}`);
const active = hl.getHighlighter();
if (active?.id !== 'syntect-gate') fail('registerHighlighter did not activate syntect factory result');
const out = await active.highlight('let x = 1;');
if (!out?.html?.includes('vmz-highlight')) fail('registered highlighter must produce html');

console.log('replaceable-content-plugin: PASS');
