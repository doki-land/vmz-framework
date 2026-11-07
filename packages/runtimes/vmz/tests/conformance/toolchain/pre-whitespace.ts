/**
 * gate: `<pre>` / `<textarea>` literal text keeps its authored whitespace
 * through the real `.vmz` build (compile → emit → client product).
 *
 * Chain: real build (writes a project, runs `vmz build`, reads the emitted
 * client JS). The runtime serialization half lives in
 * `ssr-pre-textarea-leading-newline`, which asserts the exact SSR bytes.
 *
 * Before the fix the compiler folded every multi-line text run
 * (`split_whitespace().join(" ")`), so a code block became one line. The
 * assertions here compare the emitted `api.text(...)` literal against the
 * authored bytes rather than checking that folding "did not happen".
 *
 * Usage: node --experimental-strip-types packages/runtimes/vmz/tests/conformance/toolchain/pre-whitespace.ts
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const bin = path.join(root, 'packages', 'runtimes', 'vmz', 'bin', 'vmz.js');

function fail(msg: string): never {
    console.error(`pre-whitespace GATE FAIL: ${msg}`);
    process.exit(1);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-pre-ws-'));
const srcDir = path.join(dir, 'src');
const pagesDir = path.join(srcDir, 'pages');
fs.mkdirSync(pagesDir, { recursive: true });
fs.writeFileSync(
    path.join(srcDir, 'Application.vmz'),
    '<template><p>shell</p></template>\n<script client>\nexport default class Application {}\n</script>\n',
);
// Authored bytes matter: two-line indented code block, a textarea, and a
// normal element as the control that must keep folding.
fs.writeFileSync(
    path.join(pagesDir, 'index.vmz'),
    [
        '<template>',
        '<pre>',
        '  a',
        '    b',
        '</pre>',
        '<textarea>',
        '  x',
        '</textarea>',
        '<p>',
        '  c',
        '</p>',
        '</template>',
        '<script client>',
        'export default class IndexPage {}',
        '</script>',
        '',
    ].join('\n'),
);

// Line endings are a property of the checkout, not of the document. The same
// source checked out with CRLF (Windows) must emit the same bytes as with LF,
// so each of these pages asserts a `\n` product regardless of what was written.
const crlfPage = [
    '<template>',
    '<pre>',
    '  a',
    '</pre>',
    '</template>',
    '<script client>',
    'export default class CrlfPage {}',
    '</script>',
    '',
].join('\r\n');
fs.writeFileSync(path.join(pagesDir, 'crlf.vmz'), crlfPage);
// A BOM is a byte-order mark, never document text: it must not reach the product
// or shift the first span.
fs.writeFileSync(
    path.join(pagesDir, 'bom.vmz'),
    `\uFEFF${[
        '<template>',
        '<pre>',
        '  b',
        '</pre>',
        '</template>',
        '<script client>',
        'export default class BomPage {}',
        '</script>',
        '',
    ].join('\n')}`,
);
// Mixed endings happen when two editors disagree; each run must still normalize.
fs.writeFileSync(
    path.join(pagesDir, 'mixed.vmz'),
    [
        '<template>',
        '<pre>',
        '  c',
        '</pre>',
        '</template>',
        '<script client>',
        'export default class MixedPage {}',
        '</script>',
        '',
    ].join('\n').replace('<pre>\n', '<pre>\r\n'),
);
// No trailing newline at EOF, and the pre content ends without one.
fs.writeFileSync(
    path.join(pagesDir, 'eof.vmz'),
    ['<template>', '<pre>', '  d</pre>', '</template>', '<script client>', 'export default class EofPage {}</script>'].join('\n'),
);

const outDir = path.join(dir, 'dist');

console.log('pre-whitespace: vmz build…');
const build = spawnSync(process.execPath, [bin, 'build', dir, '--out-dir', outDir], {
    cwd: root,
    encoding: 'utf8',
});
if (build.status !== 0) {
    fail(`vmz build exit ${build.status}\n${build.stderr}\n${build.stdout}`);
}

const clientPath = path.join(outDir, 'web-ssr', 'pages', 'index.client.js');
if (!fs.existsSync(clientPath)) fail(`missing emitted client module: ${clientPath}`);
const client = fs.readFileSync(clientPath, 'utf8');

function readPage(name: string): string {
    const file = path.join(outDir, 'web-ssr', 'pages', `${name}.client.js`);
    if (!fs.existsSync(file)) fail(`missing emitted client module: ${file}`);
    return fs.readFileSync(file, 'utf8');
}

// Exact authored bytes, as a JS string literal in the emitted module.
const preLiteral = 'api.text("\\n  a\\n    b\\n")';
if (!client.includes(preLiteral)) {
    fail(`pre text is not verbatim in the emitted module, want ${preLiteral}\n${client}`);
}
const textareaLiteral = 'api.text("\\n  x\\n")';
if (!client.includes(textareaLiteral)) {
    fail(`textarea text is not verbatim in the emitted module, want ${textareaLiteral}\n${client}`);
}

// Control: a normal element still condenses indentation to one text run. The
// trailing space is the existing normal-element behavior (last authored char is
// whitespace), asserted here so the fix cannot silently widen folding rules.
const controlLiteral = 'api.text("c ")';
if (!client.includes(controlLiteral)) {
    fail(`normal element text changed, want ${controlLiteral}\n${client}`);
}
if (client.includes('api.text("a b")')) {
    fail(`pre text was folded into one line\n${client}`);
}

// Line-ending independence: CRLF, mixed endings and A BOM must all emit `\n`
// bytes, so the same document renders identically on every checkout.
for (const [page, want] of [
    ['crlf', 'api.text("\\n  a\\n")'],
    ['mixed', 'api.text("\\n  c\\n")'],
    ['eof', 'api.text("\\n  d")'],
    ['bom', 'api.text("\\n  b\\n")'],
] as const) {
    const emitted = readPage(page);
    if (!emitted.includes(want)) {
        fail(`${page} source did not normalize to ${want}\n${emitted}`);
    }
    if (emitted.includes('\\r')) {
        fail(`${page} product carries a carriage return\n${emitted}`);
    }
    if (emitted.includes('\uFEFF')) {
        fail(`${page} product carries a BOM\n${emitted}`);
    }
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(
    'pre-whitespace GATE PASS: `<pre>` / `<textarea>` keep authored whitespace, `<p>` still folds, CRLF / BOM / mixed / EOF normalize to `\\n`',
);
