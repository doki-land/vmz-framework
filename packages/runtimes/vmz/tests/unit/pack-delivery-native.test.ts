/**
 * Delivery-path contract for `pack.ts` on the Rust `vmz-pack` binding —
 * fake binding injected, no native binary required. Verifies the bootstrap
 * entry assembly, the `_vmz/pack/` write target, the v0 pack manifest shape,
 * explicit failure propagation, and `packEntryHref` resolution.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { packEntryHref, packFromDeploymentIr, PACK_MANIFEST_SCHEMA, PACK_OUTPUT_DIR_REL } from '../../src/workspace/pack.ts';
import { PackNativeError } from '../../src/workspace/pack-native.ts';
import type { PackNativeBinding } from '../../src/workspace/pack-native.ts';

const root = mkdtempSync(path.join(os.tmpdir(), 'vmz-pack-delivery-'));
after(() => rmSync(root, { recursive: true, force: true }));

function makeDist(name: string, files: Record<string, string>) {
    const distDir = path.join(root, name);
    mkdirSync(distDir, { recursive: true });
    writeFileSync(path.join(distDir, 'vmz-deployment.json'), JSON.stringify({ schema: 'vmz.deployment.v0', units: [] }));
    for (const [file, text] of Object.entries(files)) writeFileSync(path.join(distDir, file), text);
    return distDir;
}

const planResponse = {
    ok: true,
    plan: {
        artifacts: [
            {
                chunkId: 'entry/entry-client.js',
                fileName: 'entry-client-aa11.js',
                code: 'import "./dom.browser-cc33.js";',
                modules: ['E:/app/dist/entry-client.js', 'E:/app/dist/dom.browser.js'],
                imports: [],
                dynamic: ['pages-index-bb22.js'],
                sourceMapFileName: 'entry-client-aa11.js.map',
            },
            {
                chunkId: 'pages/index',
                fileName: 'pages-index-bb22.js',
                code: 'export default {};',
                modules: ['E:/app/dist/pages/index.client.js'],
                imports: ['entry-client-aa11.js'],
                dynamic: [],
                sourceMapFileName: 'pages-index-bb22.js.map',
            },
        ],
        styles: [
            {
                fileName: 'style-ee55.css',
                url: '/_vmz/pack/style-ee55.css',
                modules: ['E:/app/dist/entry-client.js'],
                sourcePaths: ['E:/app/dist/theme.css'],
            },
        ],
        assets: [],
        entryFiles: [
            { logical: 'entry-client.js', file: 'entry-client-aa11.js' },
            { logical: 'entry-event.js', file: 'entry-event-dd44.js' },
        ],
        dynamicFiles: [{ from: 'entry-client-aa11.js', to: 'pages-index-bb22.js' }],
        manifestJson: JSON.stringify({ version: 'v0', entries: { 'entry-client.js': 'entry-client-aa11.js' } }),
    },
    diagnostics: [],
};

function fakeBinding(response: unknown): PackNativeBinding & { calls: Array<{ requestJson: string; outDir: string }> } {
    const calls: Array<{ requestJson: string; outDir: string }> = [];
    return {
        calls,
        packPlan(requestJson: string) {
            calls.push({ requestJson, outDir: '' });
            return JSON.stringify(response);
        },
        packWrite(requestJson: string, outDir: string) {
            calls.push({ requestJson, outDir });
            return JSON.stringify(response);
        },
    };
}

describe('packFromDeploymentIr on the vmz-pack binding (v0)', () => {
    it('assembles bootstrap entries, uses coverage, target/root/publicBase and writes under _vmz/pack', () => {
        const distDir = makeDist('full', { 'entry-client.js': 'console.log(1);', 'entry-event.js': 'console.log(2);' });
        const binding = fakeBinding(planResponse);
        const { manifest, path: manifestPath } = packFromDeploymentIr(distDir, {
            release: true,
            profileId: 'web-ssr',
            assembly: 'web-static',
            projectRoot: root,
            binding,
        });

        assert.equal(binding.calls.length, 1);
        assert.equal(binding.calls[0].outDir, path.join(distDir, ...PACK_OUTPUT_DIR_REL.split('/')));
        const request = JSON.parse(binding.calls[0].requestJson);
        assert.deepEqual(
            request.entries.map((e: { logical: string }) => e.logical).sort(),
            ['entry-client.js', 'entry-event.js'],
        );
        for (const entry of request.entries) {
            assert.ok(path.isAbsolute(entry.path), `entry path must be absolute: ${entry.path}`);
            assert.equal(path.dirname(entry.path), distDir);
        }
        assert.equal(request.target, 'browser');
        assert.equal(request.root, root);
        assert.equal(request.publicBase, '/');
        assert.deepEqual(request.uses, [
            { logical: 'entry-client.js', usedExports: null },
            { logical: 'entry-event.js', usedExports: null },
        ]);

        assert.equal(manifestPath, path.join(distDir, '_vmz', 'pack-manifest.json'));
        assert.ok(existsSync(manifestPath));
        assert.equal(manifest.schema, PACK_MANIFEST_SCHEMA);
        assert.equal(manifest.profileId, 'web-ssr');
        assert.equal(manifest.assembly, 'web-static');
        assert.equal(manifest.release, true);
        assert.equal(manifest.target, 'browser');
        assert.equal(manifest.publicBase, '/');
        assert.equal(manifest.deploymentSchema, 'vmz.deployment.v0');
        assert.equal(manifest.chunkCount, 2);
        assert.equal(manifest.entryCount, 2);
        assert.equal(manifest.minify, 'none');
        assert.equal(manifest.treeShake, 'vmz-pack-link-pruning');
        assert.equal(manifest.sourceMaps, 'chunk-v3-line-mappings');
        assert.equal(manifest.chunks.length, 2);
        assert.equal(manifest.chunks[0].fileName, 'entry-client-aa11.js');
        assert.equal(manifest.chunks[0].bytes, Buffer.byteLength(planResponse.plan.artifacts[0].code, 'utf8'));
        assert.match(manifest.chunks[0].digest, /^[a-f0-9]{64}$/);
        assert.equal(manifest.chunks[0].sourceMap, 'entry-client-aa11.js.map');
        assert.deepEqual(manifest.entryFiles, planResponse.plan.entryFiles);
        assert.deepEqual(manifest.dynamicFiles, planResponse.plan.dynamicFiles);
        assert.deepEqual(manifest.styles, planResponse.plan.styles);
        assert.equal(manifest.styleCount, 1);
        assert.deepEqual(manifest.nativeManifest, JSON.parse(planResponse.plan.manifestJson));
        assert.match(manifest.packDigest as string, /^[a-f0-9]{64}$/);
        // Retired vendor-era fields must not reappear.
        const raw = JSON.parse(readFileSync(manifestPath, 'utf8'));
        for (const gone of ['units', 'unitCount', 'clientPackageLowering', 'bundler', 'treeShakeBasis']) {
            assert.ok(!(gone in raw), `pack manifest must not carry retired field ${gone}`);
        }
    });

    it('includes only bootstrap files that exist (entry-event optional)', () => {
        const distDir = makeDist('client-only', { 'entry-client.js': 'console.log(1);' });
        const binding = fakeBinding(planResponse);
        packFromDeploymentIr(distDir, { projectRoot: root, binding });
        const request = JSON.parse(binding.calls[0].requestJson);
        assert.deepEqual(request.entries, [{ logical: 'entry-client.js', path: path.join(distDir, 'entry-client.js') }]);
        assert.deepEqual(request.uses, [{ logical: 'entry-client.js', usedExports: null }]);
    });

    it('rejects an empty bootstrap set explicitly (no silent skip)', () => {
        const distDir = makeDist('no-bootstrap', {});
        assert.throws(
            () => packFromDeploymentIr(distDir, { projectRoot: root, binding: fakeBinding(planResponse) }),
            (error: unknown) => {
                assert.ok(error instanceof PackNativeError);
                assert.equal(error.code, 'pack.native.request-invalid');
                return true;
            },
        );
    });

    it('propagates every binding diagnostic on ok:false', () => {
        const distDir = makeDist('failed', { 'entry-client.js': 'x', 'entry-event.js': 'y' });
        const binding = fakeBinding({
            ok: false,
            diagnostics: [
                { code: 'pack.unresolved', message: 'cannot resolve "@vmz/core/dom"', path: path.join(distDir, 'entry-client.js') },
                { code: 'pack.cycle', message: 'import cycle detected' },
            ],
        });
        assert.throws(
            () => packFromDeploymentIr(distDir, { projectRoot: root, binding }),
            (error: unknown) => {
                assert.ok(error instanceof PackNativeError);
                assert.equal(error.code, 'pack.native.plan-failed');
                assert.equal(error.diagnostics.length, 2);
                assert.equal(error.diagnostics[0].code, 'pack.unresolved');
                return true;
            },
        );
    });
});

describe('packEntryHref (v0)', () => {
    it('resolves the packed entry URL from the manifest entryFiles', () => {
        const distDir = makeDist('href', { 'entry-client.js': 'x', 'entry-event.js': 'y' });
        packFromDeploymentIr(distDir, { projectRoot: root, binding: fakeBinding(planResponse) });
        assert.equal(packEntryHref(distDir, 'entry-client.js'), '/_vmz/pack/entry-client-aa11.js');
        assert.equal(packEntryHref(distDir, 'entry-event.js'), '/_vmz/pack/entry-event-dd44.js');
    });

    it('throws when the logical entry is not in the mapping (no fallback)', () => {
        const distDir = makeDist('href-missing', { 'entry-client.js': 'x' });
        packFromDeploymentIr(distDir, { projectRoot: root, binding: fakeBinding(planResponse) });
        assert.throws(() => packEntryHref(distDir, 'vmz-dom.js'), /no entry file/);
    });

    it('throws when the pack manifest is absent', () => {
        const distDir = makeDist('href-nomanifest', { 'entry-client.js': 'x' });
        assert.throws(() => packEntryHref(distDir, 'entry-client.js'), /missing .*pack-manifest\.json/);
    });
});
