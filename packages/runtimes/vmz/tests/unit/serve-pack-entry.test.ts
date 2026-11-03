/**
 * serve-host bootstrap entry — the browser script src must come from
 * `_vmz/pack-manifest.json`, never from the unpacked root module.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { packEntryHref } from '../../../vmz-runtime/src/host/serve/pack-entry.ts';

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
