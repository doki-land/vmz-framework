/**
 * serve-host bootstrap entry — the browser script src must come from
 * `_vmz/pack-manifest.json`, never from the unpacked root module.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { packChunkHref, packEntryHref, packIslandHrefs } from '../../../vmz-runtime/src/host/serve/pack-entry.ts';

const root = mkdtempSync(path.join(os.tmpdir(), 'vmz-serve-pack-entry-'));
after(() => rmSync(root, { recursive: true, force: true }));

function makeDist(name: string, manifest?: unknown) {
    const distDir = path.join(root, name);
    mkdirSync(distDir, { recursive: true });
    if (manifest !== undefined) {
        mkdirSync(path.join(distDir, '_vmz'), { recursive: true });
        writeFileSync(path.join(distDir, '_vmz', 'pack-manifest.json'), JSON.stringify(manifest));
    }
    return distDir;
}

function manifestWith(publicBase: string | undefined, entries: Array<{ logical: string; file: string }>) {
    const body: Record<string, unknown> = { entryFiles: entries };
    if (publicBase !== undefined) body.publicBase = publicBase;
    return body;
}

describe('packEntryHref', () => {
    it('resolves the packed bootstrap entry under the default public base', () => {
        const dist = makeDist('default', manifestWith('/', [{ logical: 'entry-client.js', file: 'entry-client-aa11.js' }]));
        assert.equal(packEntryHref(dist, 'entry-client.js'), '/_vmz/pack/entry-client-aa11.js');
    });

    it('honours a non-root public base without doubling slashes', () => {
        const dist = makeDist('assets', manifestWith('/assets/', [{ logical: 'entry-event.js', file: 'entry-event-bb22.js' }]));
        assert.equal(packEntryHref(dist, 'entry-event.js'), '/assets/_vmz/pack/entry-event-bb22.js');
    });

    it('fails explicitly when the pack manifest is absent', () => {
        const dist = makeDist('missing-manifest');
        assert.throws(() => packEntryHref(dist, 'entry-client.js'), /packEntryHref: missing/);
    });

    it('fails explicitly when the logical entry is absent', () => {
        const dist = makeDist('missing-logical', manifestWith('/', [{ logical: 'entry-client.js', file: 'entry-client-aa11.js' }]));
        assert.throws(() => packEntryHref(dist, 'entry-event.js'), /has no entry file for "entry-event.js"/);
    });
});

describe('packChunkHref', () => {
    const units = [
        { logical: 'pages/index', clientEntry: 'pages/index.client.js', chunkId: 'chunk-a', fileName: 'async/pages-index-aa11.js' },
        { logical: 'layouts/site', clientEntry: 'layouts/site.client.js', chunkId: null, fileName: null },
    ];

    it('maps the deployment unit logical id to its exact chunk file', () => {
        const dist = makeDist('unit-hit', { publicBase: '/', unitChunks: units });
        assert.equal(packChunkHref(dist, 'pages/index'), '/_vmz/pack/async/pages-index-aa11.js');
    });

    it('rejects units outside the client graph and unknown logical ids', () => {
        const dist = makeDist('unit-miss', { publicBase: '/', unitChunks: units });
        assert.throws(() => packChunkHref(dist, 'layouts/site'), /not in the browser client graph/);
        assert.throws(() => packChunkHref(dist, 'pages/other'), /has no unit chunk for "pages\/other"/);
    });
});

describe('packIslandHrefs', () => {
    it('resolves the runtime shared chunk by exact module path and lists page chunks', () => {
        const dist = makeDist('island', {
            publicBase: '/',
            unitChunks: [{ logical: 'pages/index', fileName: 'async/pages-index-aa11.js' }],
            chunks: [
                { chunkId: 'shared-a', fileName: 'shared-runtime-bb22.js', modules: [path.join(root, 'island', 'dom.browser.js')] },
            ],
        });
        assert.deepEqual(packIslandHrefs(dist), {
            dom: '/_vmz/pack/shared-runtime-bb22.js',
            pages: { 'pages/index': '/_vmz/pack/async/pages-index-aa11.js' },
        });
    });

    it('fails explicitly when no chunk carries dom.browser.js', () => {
        const dist = makeDist('island-miss', { publicBase: '/', unitChunks: [], chunks: [] });
        assert.throws(() => packIslandHrefs(dist), /no chunk carries "dom.browser.js"/);
    });
});
