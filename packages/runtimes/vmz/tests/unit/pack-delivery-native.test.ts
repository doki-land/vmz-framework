/**
 * Delivery-path contract for `pack.ts` on the Rust `vmz-pack` binding —
 * fake binding injected, no native binary required. Verifies the bootstrap
 * entry assembly, the `_vmz/pack/` write target, the v0 pack manifest shape,
 * explicit failure propagation, and `packEntryHref` resolution.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, describe, it } from 'node:test';
import {
    packEntryHref,
    packFromDeploymentIr,
    packNodeEntryFile,
    packSsrFromDeploymentIr,
    PACK_MANIFEST_SCHEMA,
    PACK_NODE_MANIFEST_REL,
    PACK_NODE_MANIFEST_SCHEMA,
    PACK_NODE_OUTPUT_DIR_REL,
    PACK_OUTPUT_DIR_REL,
} from '../../src/workspace/pack.ts';
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
        inputDigest: 'a'.repeat(64),
        graphDigest: 'b'.repeat(64),
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
            { logical: 'entry-client.js', execution: 'full', exports: { kind: 'all' } },
            { logical: 'entry-event.js', execution: 'full', exports: { kind: 'all' } },
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
        assert.equal(manifest.minify, 'tokens');
        assert.equal(manifest.treeShake, 'vmz-pack-link-pruning');
        assert.equal(manifest.sourceMaps, 'chunk-v3-token-mappings');
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

    it('maps deployment chunk ids to browser chunks by exact module path (unitChunks)', () => {
        const distDir = path.join(root, 'units');
        mkdirSync(path.join(distDir, 'pages'), { recursive: true });
        writeFileSync(
            path.join(distDir, 'vmz-deployment.json'),
            JSON.stringify({
                schema: 'vmz.deployment.v0',
                units: [
                    { kind: 'page', chunkId: 'pages/index', clientEntry: 'pages/index.client.js' },
                    { kind: 'component', chunkId: 'components/Orphan', clientEntry: '' },
                ],
            }),
        );
        writeFileSync(path.join(distDir, 'pages', 'index.client.js'), 'export default {};');
        writeFileSync(path.join(distDir, 'entry-client.js'), 'console.log(1);');
        const pageModule = path.join(distDir, 'pages', 'index.client.js').replace(/\\/g, '/');
        const binding = fakeBinding({
            ok: true,
            plan: {
                ...planResponse.plan,
                artifacts: [
                    {
                        chunkId: 'isolated/pages/index.client.js',
                        fileName: 'pages-index-bb22.js',
                        code: 'export default class Page {};',
                        modules: [pageModule],
                        imports: [],
                        dynamic: [],
                        sourceMapFileName: 'pages-index-bb22.js.map',
                    },
                ],
                entryFiles: [{ logical: 'entry-client.js', file: 'entry-client-aa11.js' }],
                dynamicFiles: [],
                styles: [],
                assets: [],
                manifestJson: JSON.stringify({ version: 'v0', entries: [], chunks: [], assets: [] }),
            },
            diagnostics: [],
        });
        const { manifest } = packFromDeploymentIr(distDir, { projectRoot: root, binding });
        assert.deepEqual(manifest.unitChunks, [
            { logical: 'components/Orphan', clientEntry: 'components/Orphan.client.js', chunkId: null, fileName: null },
            {
                logical: 'pages/index',
                clientEntry: 'pages/index.client.js',
                chunkId: 'isolated/pages/index.client.js',
                fileName: 'pages-index-bb22.js',
            },
        ]);
        const raw = JSON.parse(readFileSync(path.join(distDir, '_vmz', 'pack-manifest.json'), 'utf8'));
        assert.deepEqual(raw.unitChunks, manifest.unitChunks, 'unitChunks 必须落盘并被 packDigest 覆盖');
    });

    it('includes only bootstrap files that exist (entry-event optional)', () => {
        const distDir = makeDist('client-only', { 'entry-client.js': 'console.log(1);' });
        const binding = fakeBinding(planResponse);
        packFromDeploymentIr(distDir, { projectRoot: root, binding });
        const request = JSON.parse(binding.calls[0].requestJson);
        assert.deepEqual(request.entries, [{ logical: 'entry-client.js', path: path.join(distDir, 'entry-client.js') }]);
        assert.deepEqual(request.uses, [
            { logical: 'entry-client.js', execution: 'full', exports: { kind: 'all' } },
        ]);
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

function makeDistWithUnits(name: string, units: unknown[], files: Record<string, string>) {
    const distDir = path.join(root, name);
    mkdirSync(distDir, { recursive: true });
    writeFileSync(path.join(distDir, 'vmz-deployment.json'), JSON.stringify({ schema: 'vmz.deployment.v0', units }));
    for (const [file, text] of Object.entries(files)) {
        const abs = path.join(distDir, ...file.split('/'));
        mkdirSync(path.dirname(abs), { recursive: true });
        writeFileSync(abs, text);
    }
    return distDir;
}

const nodeUnits = [
    { chunkId: 'Application', kind: 'application', clientEntry: 'Application.client.js', dependsOn: [] },
    {
        chunkId: 'components/Greeting',
        kind: 'component',
        clientEntry: 'components/Greeting.client.js',
        dependsOn: [],
    },
    { chunkId: 'pages/index', kind: 'page', clientEntry: 'pages/index.client.js', dependsOn: ['components/Greeting'] },
];

const nodeClientFiles = {
    'Application.client.js': 'export default class Application {}',
    'components/Greeting.client.js': 'export default class Greeting {}',
    'pages/index.client.js': 'export default class IndexPage {}',
};

const nodePlanResponse = {
    ok: true,
    plan: {
        artifacts: [
            {
                chunkId: 'Application',
                fileName: 'Application-node-11aa.js',
                code: 'export default class Application {}',
                modules: ['E:/app/dist/web-ssr/Application.client.js'],
                imports: [],
                dynamic: [],
                sourceMapFileName: 'Application-node-11aa.js.map',
            },
            {
                chunkId: 'components/Greeting',
                fileName: 'components-Greeting-node-33cc.js',
                code: 'export default class Greeting {}',
                modules: ['E:/app/dist/web-ssr/components/Greeting.client.js'],
                imports: [],
                dynamic: [],
                sourceMapFileName: 'components-Greeting-node-33cc.js.map',
            },
            {
                chunkId: 'pages/index',
                fileName: 'pages-index-node-22bb.js',
                code: 'import Greeting from "./components-Greeting-node-33cc.js";\nexport default class IndexPage {}\nexport { Greeting };',
                modules: ['E:/app/dist/web-ssr/pages/index.client.js'],
                imports: ['components-Greeting-node-33cc.js'],
                dynamic: [],
                sourceMapFileName: 'pages-index-node-22bb.js.map',
            },
        ],
        styles: [],
        assets: [],
        entryFiles: [
            { logical: 'Application', file: 'Application-node-11aa.js' },
            { logical: 'components/Greeting', file: 'components-Greeting-node-33cc.js' },
            { logical: 'pages/index', file: 'pages-index-node-22bb.js' },
        ],
        dynamicFiles: [],
        manifestJson: JSON.stringify({ version: 'v0', target: 'node', entries: { Application: 'Application-node-11aa.js' } }),
        inputDigest: 'c'.repeat(64),
        graphDigest: 'd'.repeat(64),
    },
    diagnostics: [],
};

function writeNodeChunks(distDir: string) {
    for (const artifact of nodePlanResponse.plan.artifacts) {
        writeFileSync(path.join(distDir, '_vmz', 'pack-node', artifact.fileName), artifact.code, 'utf8');
    }
}

describe('packSsrFromDeploymentIr on the vmz-pack binding (v0)', () => {
    it('packs every unit clientEntry with logical=chunkId, side-effects and named default on target node', () => {
        const distDir = makeDistWithUnits('node-full', nodeUnits, nodeClientFiles);
        const binding = fakeBinding(nodePlanResponse);
        const { manifest, path: manifestPath } = packSsrFromDeploymentIr(distDir, { projectRoot: root, binding });

        assert.equal(binding.calls.length, 1);
        assert.equal(binding.calls[0].outDir, path.join(distDir, ...PACK_NODE_OUTPUT_DIR_REL.split('/')));
        const request = JSON.parse(binding.calls[0].requestJson);
        assert.equal(request.target, 'node');
        assert.equal(request.root, root);
        assert.equal(request.publicBase, '/');
        assert.deepEqual(
            request.entries.map((e: { logical: string }) => e.logical).sort(),
            ['Application', 'components/Greeting', 'pages/index'],
        );
        const byLogical = new Map(nodeUnits.map((u) => [u.chunkId, path.join(distDir, ...u.clientEntry.split('/'))]));
        for (const entry of request.entries) {
            assert.ok(path.isAbsolute(entry.path), `entry path must be absolute: ${entry.path}`);
            assert.equal(entry.path, byLogical.get(entry.logical));
        }
        assert.deepEqual(request.uses, nodeUnits.map((u) => ({
            logical: u.chunkId,
            execution: 'side-effects',
            exports: { kind: 'named', names: ['default'] },
        })));

        assert.equal(manifestPath, path.join(distDir, ...PACK_NODE_MANIFEST_REL.split('/')));
        const pkg = JSON.parse(readFileSync(path.join(distDir, '_vmz', 'pack-node', 'package.json'), 'utf8'));
        assert.equal(pkg.type, 'module');
        assert.equal(manifest.schema, PACK_NODE_MANIFEST_SCHEMA);
        assert.equal(manifest.target, 'node');
        assert.equal(manifest.deploymentSchema, 'vmz.deployment.v0');
        assert.deepEqual(manifest.entryFiles, nodePlanResponse.plan.entryFiles);
        assert.equal(manifest.entryCount, 3);
        assert.equal(manifest.chunkCount, 3);
        assert.equal(manifest.chunks.length, 3);
        assert.match(manifest.chunks[0].digest, /^[a-f0-9]{64}$/);
        assert.deepEqual(manifest.nativeManifest, JSON.parse(nodePlanResponse.plan.manifestJson));
        assert.match(manifest.packDigest as string, /^[a-f0-9]{64}$/);
    });

    it('maps emitted unit entries back to their source files as projection origins', () => {
        const srcDir = path.join(root, 'node-src');
        mkdirSync(path.join(srcDir, 'components'), { recursive: true });
        const widgetSource = path.join(srcDir, 'components', 'Widget.vmz');
        writeFileSync(widgetSource, '<template><span /></template>');
        const units = [
            ...nodeUnits,
            {
                chunkId: 'components/Widget',
                kind: 'component',
                clientEntry: 'components/Widget.client.js',
                source: widgetSource,
            },
        ];
        const distDir = makeDistWithUnits('node-origins', units, {
            ...nodeClientFiles,
            'components/Widget.client.js': 'export default class Widget {}',
        });
        const binding = fakeBinding(nodePlanResponse);
        packSsrFromDeploymentIr(distDir, { projectRoot: root, binding });
        const request = JSON.parse(binding.calls[0].requestJson);
        const emitted = realpathSync(path.join(distDir, 'components', 'Widget.client.js'));
        assert.deepEqual(request.origins, { [emitted]: realpathSync(widgetSource) });
    });

    it('collapses repeated deployment units by chunkId into one node entry', () => {
        // Deployment IR repeats a component once per consuming page.
        const duplicated = [...nodeUnits, nodeUnits[1], nodeUnits[1]];
        const distDir = makeDistWithUnits('node-dupes', duplicated, nodeClientFiles);
        const binding = fakeBinding(nodePlanResponse);
        packSsrFromDeploymentIr(distDir, { projectRoot: root, binding });
        const request = JSON.parse(binding.calls[0].requestJson);
        assert.deepEqual(
            request.entries.map((e: { logical: string }) => e.logical).sort(),
            ['Application', 'components/Greeting', 'pages/index'],
        );
        assert.equal(request.uses.length, 3);
    });

    it('packs only node-reachable units and leaves orphan components out', () => {
        // `components/Orphan` is never reached by a page or the application
        // shell: no Node consumer imports it, so it must not become an entry.
        const orphan = {
            chunkId: 'components/Orphan',
            kind: 'component',
            clientEntry: 'components/Orphan.client.js',
            dependsOn: [],
        };
        const units = [...nodeUnits, orphan];
        const distDir = makeDistWithUnits('node-orphan', units, {
            ...nodeClientFiles,
            'components/Orphan.client.js': 'export default class Orphan {}',
        });
        const binding = fakeBinding(nodePlanResponse);
        const { manifest } = packSsrFromDeploymentIr(distDir, { projectRoot: root, binding });

        const request = JSON.parse(binding.calls[0].requestJson);
        const logicals = request.entries.map((e: { logical: string }) => e.logical).sort();
        assert.deepEqual(logicals, ['Application', 'components/Greeting', 'pages/index']);
        assert.ok(!logicals.includes('components/Orphan'));

        const entryRows = (manifest.entries as Array<{ logical: string; file: string }>).map((e) => e.logical).sort();
        assert.deepEqual(entryRows, ['Application', 'components/Greeting', 'pages/index']);
        const chunkIds = (manifest.chunks as Array<{ chunkId: string }>).map((c) => c.chunkId).sort();
        assert.ok(!chunkIds.includes('components/Orphan'), `orphan chunk leaked into the node pack: ${chunkIds.join(', ')}`);
    });

    it('keeps standalone layout units as node roots even without any dependsOn edge', () => {
        // `layouts/DocumentLayout` is emitted with kind `other` and is requested
        // by the integrated document mount via `packNodeEntryFile`. No page lists
        // it in `dependsOn`, so it must be a root rather than a closure member.
        const layout = {
            chunkId: 'layouts/DocumentLayout',
            kind: 'other',
            clientEntry: 'layouts/DocumentLayout.client.js',
            dependsOn: ['components/Greeting'],
        };
        const units = [...nodeUnits, layout];
        const distDir = makeDistWithUnits('node-layout-root', units, {
            ...nodeClientFiles,
            'layouts/DocumentLayout.client.js': 'export default class DocumentLayout {}',
        });
        const binding = fakeBinding(nodePlanResponse);
        packSsrFromDeploymentIr(distDir, { projectRoot: root, binding });
        const request = JSON.parse(binding.calls[0].requestJson);
        assert.deepEqual(
            request.entries.map((e: { logical: string }) => e.logical).sort(),
            ['Application', 'components/Greeting', 'layouts/DocumentLayout', 'pages/index'],
        );
    });

    it('rejects one chunkId mapping to conflicting client entries', () => {
        const conflicting = [
            { chunkId: 'components/Greeting', kind: 'component', clientEntry: 'components/Greeting.client.js' },
            { chunkId: 'components/Greeting', kind: 'component', clientEntry: 'components/GreetingCopy.client.js' },
            { chunkId: 'pages/index', kind: 'page', clientEntry: 'pages/index.client.js', dependsOn: ['components/Greeting'] },
        ];
        const distDir = makeDistWithUnits('node-conflict', conflicting, {
            ...nodeClientFiles,
            'components/GreetingCopy.client.js': 'export default class GreetingCopy {}',
        });
        assert.throws(
            () => packSsrFromDeploymentIr(distDir, { projectRoot: root, binding: fakeBinding(nodePlanResponse) }),
            /conflicting client entries/,
        );
    });

    it('falls back to ${chunkId}.client.js only for an empty clientEntry, and requires the file', () => {
        const legacyPage = {
            chunkId: 'pages/index',
            kind: 'page',
            clientEntry: 'pages/index.client.js',
            dependsOn: ['components/Legacy'],
        };
        const distDir = makeDistWithUnits(
            'node-empty-entry',
            [{ chunkId: 'components/Legacy', kind: 'component', clientEntry: '' }, legacyPage],
            {
                'components/Legacy.client.js': 'export default class Legacy {}',
                'pages/index.client.js': 'export default class IndexPage {}',
            },
        );
        const binding = fakeBinding(nodePlanResponse);
        packSsrFromDeploymentIr(distDir, { projectRoot: root, binding });
        const request = JSON.parse(binding.calls[0].requestJson);
        assert.deepEqual(
            request.entries.map((entry: { logical: string }) => entry.logical).sort(),
            ['components/Legacy', 'pages/index'],
        );
        assert.equal(
            request.entries.find((entry: { logical: string }) => entry.logical === 'components/Legacy').path,
            path.join(distDir, 'components', 'Legacy.client.js'),
        );

        const missing = makeDistWithUnits(
            'node-empty-entry-missing',
            [{ chunkId: 'components/Legacy', kind: 'component', clientEntry: '' }, legacyPage],
            { 'pages/index.client.js': 'export default class IndexPage {}' },
        );
        assert.throws(
            () => packSsrFromDeploymentIr(missing, { projectRoot: root, binding: fakeBinding(nodePlanResponse) }),
            /unit "components\/Legacy" client entry missing: components\/Legacy\.client\.js/,
        );
    });

    it('rejects a deployment IR without units explicitly', () => {
        const distDir = makeDist('node-no-units', {});
        assert.throws(
            () => packSsrFromDeploymentIr(distDir, { projectRoot: root, binding: fakeBinding(nodePlanResponse) }),
            /deployment IR has no units/,
        );
    });
});

describe('packNodeEntryFile (v0)', () => {
    it('resolves and imports the packed chunk while the root client file is absent', async () => {
        const distDir = makeDistWithUnits('node-href', nodeUnits, nodeClientFiles);
        packSsrFromDeploymentIr(distDir, { projectRoot: root, binding: fakeBinding(nodePlanResponse) });
        writeNodeChunks(distDir);
        for (const rel of Object.keys(nodeClientFiles)) rmSync(path.join(distDir, ...rel.split('/')), { force: true });

        const abs = packNodeEntryFile(distDir, 'pages/index');
        assert.equal(abs, path.join(distDir, '_vmz', 'pack-node', 'pages-index-node-22bb.js'));
        assert.ok(existsSync(abs));
        const mod = await import(pathToFileURL(abs).href);
        assert.equal(typeof mod.default, 'function');
        assert.match(readFileSync(abs, 'utf8'), /^\s*export\s+(default|{)/m);
        assert.match(readFileSync(abs, 'utf8'), /from "\.\/components-Greeting-node-33cc\.js"/);
    });

    it('throws when the logical entry is not in the node manifest even if the root file exists', () => {
        const distDir = makeDistWithUnits(
            'node-href-missing-logical',
            [{ chunkId: 'Application', kind: 'application', clientEntry: 'Application.client.js' }],
            {
                'Application.client.js': 'export default class Application {}',
                'pages/index.client.js': 'export default class IndexPage {}',
            },
        );
        const single = {
            ...nodePlanResponse,
            plan: {
                ...nodePlanResponse.plan,
                entryFiles: [{ logical: 'Application', file: 'Application-node-11aa.js' }],
            },
        };
        packSsrFromDeploymentIr(distDir, { projectRoot: root, binding: fakeBinding(single) });
        assert.ok(existsSync(path.join(distDir, 'pages', 'index.client.js')));
        assert.throws(() => packNodeEntryFile(distDir, 'pages/index'), /no entry file for "pages\/index"/);
    });

    it('throws when the node pack manifest is absent', () => {
        const distDir = makeDistWithUnits('node-href-nomanifest', [], {
            'pages/index.client.js': 'export default class IndexPage {}',
        });
        assert.throws(() => packNodeEntryFile(distDir, 'pages/index'), /missing .*pack-node-manifest\.json/);
    });
});
