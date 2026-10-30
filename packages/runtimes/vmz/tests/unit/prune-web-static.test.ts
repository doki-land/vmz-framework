/**
 * Contract for `pruneWebStaticDelivery`: after HTML emit the web-static dist
 * keeps the `/dom.browser.js` face closure (transitive relative imports), the
 * packed chunks under `_vmz/pack/`, assets, HTML and JSON metadata, and drops
 * every unpacked module JS/map plus the Node-only serve-host material.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { pruneWebStaticDelivery } from '../../src/workspace/static-emit.ts';

const root = mkdtempSync(path.join(os.tmpdir(), 'vmz-prune-static-'));
after(() => rmSync(root, { recursive: true, force: true }));

function makeDist(name: string, files: Record<string, string>) {
    const distDir = path.join(root, name);
    for (const [rel, text] of Object.entries(files)) {
        const abs = path.join(distDir, ...rel.split('/'));
        mkdirSync(path.dirname(abs), { recursive: true });
        writeFileSync(abs, text);
    }
    return distDir;
}

describe('pruneWebStaticDelivery', () => {
    it('keeps the face closure, pack chunks, html and json, drops unpacked JS', () => {
        const dist = makeDist('full', {
            'index.html': '<html><body></body></html>',
            'vmz-deployment.json': JSON.stringify({ schema: 'vmz.deployment.v0', units: [] }),
            'pages/charts.program.json': '{}',
            'entry-client.js': 'import "./pages/charts.client.js";',
            'entry-client.js.map': '{}',
            'vmz-dom.js': 'export const ssr = 1;',
            'vmz-runtime.js': 'export const server = 1;',
            'dom-ssr.js': 'export const a = 1;',
            'dom.browser.js': "export * from './dom-core.js';\nexport { hydrate } from './browser/resume/hydrate.js';",
            'dom-core.js': "export { m } from './dom-attr-normalize.js';",
            'dom-attr-normalize.js': 'export const m = 1;',
            'browser/resume/hydrate.js': 'export const hydrate = 1;',
            'dom.client.js': 'export const client = 1;',
            'vmz-serve-host.mjs': 'console.log(1);',
            '#server/pages/charts.js': 'export const load = 1;',
            'ssr/render.js': 'export const render = 1;',
            '_vmz/host/serve/http.js': 'export const http = 1;',
            '_vmz/pack/entry-client-aa11.js': 'export default 1;',
            '_vmz/pack-manifest.json': '{}',
            'assets/vmz-designs.css': 'body{}',
            'vmz.css': 'body{}',
        });
        const result = pruneWebStaticDelivery(dist);
        const kept = [
            'index.html',
            'vmz-deployment.json',
            'pages/charts.program.json',
            'vmz.css',
            'assets/vmz-designs.css',
            '_vmz/pack/entry-client-aa11.js',
            '_vmz/pack-manifest.json',
            'dom.browser.js',
            'dom-core.js',
            'dom-attr-normalize.js',
            'browser/resume/hydrate.js',
        ];
        for (const rel of kept) assert.ok(existsSync(path.join(dist, ...rel.split('/'))), `kept ${rel}`);
        const gone = [
            'entry-client.js',
            'entry-client.js.map',
            'vmz-dom.js',
            'vmz-runtime.js',
            'dom-ssr.js',
            'dom.client.js',
            'vmz-serve-host.mjs',
            '#server/pages/charts.js',
            'ssr/render.js',
            '_vmz/host/serve/http.js',
        ];
        for (const rel of gone) assert.ok(!existsSync(path.join(dist, ...rel.split('/'))), `removed ${rel}`);
        assert.ok(!existsSync(path.join(dist, '#server')), 'empty #server dir removed');
        assert.ok(!existsSync(path.join(dist, '_vmz/host')), 'empty _vmz/host dir removed');
        assert.ok(existsSync(path.join(dist, '_vmz')), '_vmz root stays');
        assert.ok(existsSync(path.join(dist, 'pages')), 'pages dir stays (JSON IR kept)');
        assert.equal(result.keptFaces.includes('dom.browser.js'), true);
        assert.equal(result.keptFaces.includes('browser/resume/hydrate.js'), true);
        assert.equal(result.removed, gone.length);
    });

    it('is a no-op without the face entry and never touches assets or pack output', () => {
        const dist = makeDist('nofaces', {
            'index.html': '<html></html>',
            'assets/app-cc33.js': 'export const a = 1;',
            '_vmz/pack/entry-client-aa11.js': 'export default 1;',
        });
        const result = pruneWebStaticDelivery(dist);
        assert.equal(result.removed, 0);
        assert.deepEqual(result.keptFaces, []);
        assert.ok(existsSync(path.join(dist, 'assets/app-cc33.js')));
        assert.ok(existsSync(path.join(dist, '_vmz/pack/entry-client-aa11.js')));
    });
});
