/**
 * highlighter-wasm thin gate — @vmz/highlighter + wasm32 fallback + CE surface.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);

function fail(msg: string): never {
    console.error(`highlighter-wasm GATE FAIL: ${msg}`);
    process.exit(1);
}

const hlRoot = path.join(root, 'packages', 'content', 'vmz-highlighter');
const wasmRoot = path.join(root, 'packages', 'content', 'vmz-highlighter-unknown-wasm32');

console.log('highlighter-wasm: package identity…');
for (const [dir, name] of [
    [hlRoot, '@vmz/highlighter'],
    [wasmRoot, '@vmz/highlighter-unknown-wasm32'],
] as const) {
    const pkgPath = path.join(dir, 'package.json');
    if (!fs.existsSync(pkgPath)) fail(`missing ${path.relative(root, pkgPath)}`);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (pkg.name !== name) fail(`${path.relative(root, pkgPath)} name want ${name}, got ${pkg.name}`);
    if (pkg.private !== true) fail(`${name} must be private`);
    if (pkg.type !== 'module') fail(`${name} must be type:module`);
}

const hlPkg = JSON.parse(fs.readFileSync(path.join(hlRoot, 'package.json'), 'utf8'));
if (!hlPkg.exports?.['.']) fail('@vmz/highlighter missing exports "."');
if (!hlPkg.exports?.['./ce']) fail('@vmz/highlighter missing exports "./ce"');

const wasmPkg = JSON.parse(fs.readFileSync(path.join(wasmRoot, 'package.json'), 'utf8'));
if (!wasmPkg.dependencies?.['@vmz/highlighter'] && !wasmPkg.peerDependencies?.['@vmz/highlighter']) {
    fail('@vmz/highlighter-unknown-wasm32 must depend on @vmz/highlighter');
}

console.log('highlighter-wasm: build outputs…');
for (const f of ['dist/index.js', 'dist/index.d.ts', 'dist/ce.js', 'dist/ce.d.ts']) {
    if (!fs.existsSync(path.join(hlRoot, f))) {
        fail(`missing @vmz/highlighter ${f} — run pnpm --filter @vmz/highlighter build`);
    }
}
if (!fs.existsSync(path.join(wasmRoot, 'dist', 'index.js'))) {
    fail('missing @vmz/highlighter-unknown-wasm32 dist — run pnpm --filter @vmz/highlighter-unknown-wasm32 build');
}

console.log('highlighter-wasm: plain highlight…');
const hl = await import(pathToFileURL(path.join(hlRoot, 'dist', 'index.js')).href);
const {
    createPlainHighlighter,
    registerHighlighter,
    getHighlighter,
    resetHighlighterForTests,
} = hl;
resetHighlighterForTests?.();
const plain = createPlainHighlighter();
const result = await plain.highlight('const x = 1 < 2;', { language: 'ts' });
if (!result?.html?.includes('&lt;')) fail(`plain highlight must HTML-escape: ${result?.html}`);
if (!result.html.includes('vmz-highlight')) fail('plain highlight missing vmz-highlight class');
if (!Array.isArray(result.tokens) || result.tokens[0]?.span?.start !== 0) {
    fail('plain highlight must emit offset-only token spans');
}

registerHighlighter(plain);
if (getHighlighter() !== plain && getHighlighter().id !== plain.id) {
    fail('getHighlighter did not return registered highlighter');
}

console.log('highlighter-wasm: wasm32 fallback…');
const wasm = await import(pathToFileURL(path.join(wasmRoot, 'dist', 'index.js')).href);
if (typeof wasm.createUnknownWasm32Highlighter !== 'function') {
    fail('@vmz/highlighter-unknown-wasm32 must export createUnknownWasm32Highlighter');
}
const wasmHl = wasm.createUnknownWasm32Highlighter();
if (wasmHl.target !== 'wasm32') fail(`wasm32 highlighter target want wasm32, got ${wasmHl.target}`);
const wasmOut = await wasmHl.highlight('fn main() {}', { language: 'rust' });
if (!wasmOut?.html?.includes('vmz-highlight')) fail('wasm32 highlight missing class');

console.log('highlighter-wasm: CE registers…');
installMinimalDom();
const ce = await import(pathToFileURL(path.join(hlRoot, 'dist', 'ce.js')).href);
if (typeof ce.defineVmzHighlighter !== 'function') fail('./ce must export defineVmzHighlighter');
ce.defineVmzHighlighter();
if (typeof customElements === 'undefined' || !customElements.get('vmz-highlighter')) {
    fail('vmz-highlighter custom element did not register');
}
if (ce.VMZ_HIGHLIGHTER_TAG !== 'vmz-highlighter') fail('VMZ_HIGHLIGHTER_TAG mismatch');

console.log('highlighter-wasm: PASS');

/** Minimal customElements + HTMLElement so CE define works under Node. */
function installMinimalDom(): void {
    const g = globalThis as Record<string, unknown>;
    if (typeof g.HTMLElement === 'undefined') {
        g.HTMLElement = class HTMLElement {
            textContent = '';
            shadowRoot: unknown = null;
            attachShadow() {
                const pre = { setAttribute() {}, innerHTML: '' };
                const root = { appendChild() {}, querySelector: () => pre };
                this.shadowRoot = root;
                return root;
            }
            getAttribute() {
                return null;
            }
            setAttribute() {}
        };
    }
    if (typeof g.document === 'undefined') {
        g.document = {
            createElement(tag: string) {
                if (tag === 'pre') {
                    return { setAttribute() {}, innerHTML: '', tagName: 'PRE' };
                }
                return { setAttribute() {}, innerHTML: '', tagName: tag.toUpperCase() };
            },
        };
    }
    if (typeof g.customElements === 'undefined') {
        const registry = new Map<string, unknown>();
        g.customElements = {
            define(name: string, ctor: unknown) {
                if (registry.has(name)) throw new Error(`already defined: ${name}`);
                registry.set(name, ctor);
            },
            get(name: string) {
                return registry.get(name);
            },
        };
    }
}
