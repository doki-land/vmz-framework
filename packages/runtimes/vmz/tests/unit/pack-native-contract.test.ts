/**
 * Frozen v0 consumption contract for `pack-native.ts` — fake binding injected,
 * no native binary required. Mirrors the `packPlan`/`packWrite` request and
 * response shapes verbatim: exact fields, explicit diagnostics, no fallbacks.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    buildPackRequest,
    PackNativeError,
    runPackPlan,
    runPackWrite,
} from '../../src/workspace/pack-native.ts';
import type { PackNativeBinding } from '../../src/workspace/pack-native.ts';

const validPlan = {
    artifacts: [
        {
            chunkId: 'entry/main',
            fileName: 'entry-main-ab12cd34.js',
            code: 'export const a=1;',
            modules: ['E:/abs/src/lib.js'],
            imports: ['shared-9f8e7d6c.js'],
            dynamic: [],
            sourceMapFileName: 'entry-main-ab12cd34.js.map',
        },
    ],
    assets: [
        {
            modulePath: 'E:/abs/src/entry.js',
            specifier: './logo.svg',
            fileName: 'assets/logo-0123456789abcdef.svg',
            url: '/_vmz/assets/logo-0123456789abcdef.svg',
            sourcePath: 'E:/abs/src/logo.svg',
        },
    ],
    styles: [
        {
            fileName: 'style-1234abcd.css',
            url: '/_vmz/style-1234abcd.css',
            modules: ['E:/abs/src/entry.js'],
            sourcePaths: ['E:/abs/src/theme.css'],
        },
    ],
    entryFiles: [{ logical: 'main', file: 'entry-main-ab12cd34.js' }],
    dynamicFiles: [{ from: 'entry-main-ab12cd34.js', to: 'shared-9f8e7d6c.js' }],
    manifestJson: JSON.stringify({ version: 'v0', entries: { main: 'entry-main-ab12cd34.js' } }),
};

function okResponseJson(plan: unknown = validPlan): string {
    return JSON.stringify({ ok: true, plan, diagnostics: [] });
}

function fakeBinding(planResponse: string): PackNativeBinding & { calls: string[] } {
    const calls: string[] = [];
    return {
        calls,
        packPlan(requestJson: string) {
            calls.push(`plan:${requestJson}`);
            return planResponse;
        },
        packWrite(requestJson: string, outDir: string) {
            calls.push(`write:${requestJson}:${outDir}`);
            return planResponse;
        },
    };
}

describe('pack-native buildPackRequest (v0)', () => {
    it('assembles the contract request JSON with exact fields', () => {
        const requestJson = buildPackRequest({
            entries: { main: 'E:/abs/src/entry.js' },
            target: 'browser',
            root: 'E:/abs/project',
            uses: [{ logical: 'main', execution: 'side-effects', exports: { kind: 'named', names: ['a', 'b'] } }],
            publicBase: '/_vmz/',
        });
        assert.deepEqual(JSON.parse(requestJson), {
            entries: [{ logical: 'main', path: 'E:/abs/src/entry.js' }],
            target: 'browser',
            root: 'E:/abs/project',
            uses: [{ logical: 'main', execution: 'side-effects', exports: { kind: 'named', names: ['a', 'b'] } }],
            publicBase: '/_vmz/',
        });
    });

    it('passes the execution/exports demand through without guessing', () => {
        const requestJson = buildPackRequest({
            entries: { main: 'E:/abs/src/entry.js' },
            target: 'node',
            root: 'E:/abs/project',
            uses: [{ logical: 'main', execution: 'full', exports: { kind: 'all' } }],
            publicBase: '/_vmz/',
        });
        assert.deepEqual(JSON.parse(requestJson).uses, [
            { logical: 'main', execution: 'full', exports: { kind: 'all' } },
        ]);
    });

    it('rejects execution and exports spellings outside the contract', () => {
        assert.throws(
            () =>
                buildPackRequest({
                    entries: { main: 'E:/abs/src/entry.js' },
                    target: 'browser',
                    root: 'E:/abs/project',
                    uses: [{ logical: 'main', execution: 'full', exports: { kind: 'ghost' } } as never],
                    publicBase: '/_vmz/',
                }),
            (error: unknown) => {
                assert.ok(error instanceof PackNativeError);
                assert.equal(error.code, 'pack.native.request-uses');
                return true;
            },
        );
        assert.throws(
            () =>
                buildPackRequest({
                    entries: { main: 'E:/abs/src/entry.js' },
                    target: 'browser',
                    root: 'E:/abs/project',
                    uses: [{ logical: 'main', execution: 'partial', exports: { kind: 'all' } } as never],
                    publicBase: '/_vmz/',
                }),
            (error: unknown) => {
                assert.ok(error instanceof PackNativeError);
                assert.equal(error.code, 'pack.native.request-uses');
                return true;
            },
        );
    });

    it('rejects uses that do not cover every entries logical', () => {
        assert.throws(
            () =>
                buildPackRequest({
                    entries: { main: 'E:/abs/src/entry.js', island: 'E:/abs/src/island.js' },
                    target: 'browser',
                    root: 'E:/abs/project',
                    uses: [{ logical: 'main', execution: 'full', exports: { kind: 'all' } }],
                    publicBase: '/_vmz/',
                }),
            (error: unknown) => {
                assert.ok(error instanceof PackNativeError);
                assert.equal(error.code, 'pack.native.request-uses');
                assert.match(error.message, /island/);
                return true;
            },
        );
    });

    it('rejects a target outside the contract enum', () => {
        assert.throws(
            () =>
                buildPackRequest({
                    entries: { main: 'E:/abs/src/entry.js' },
                    target: 'deno' as 'node',
                    root: 'E:/abs/project',
                    uses: [{ logical: 'main', execution: 'full', exports: { kind: 'all' } }],
                    publicBase: '/_vmz/',
                }),
            (error: unknown) => {
                assert.ok(error instanceof PackNativeError);
                assert.equal(error.code, 'pack.native.request-target');
                return true;
            },
        );
    });

    it('rejects relative entry paths and roots', () => {
        assert.throws(
            () =>
                buildPackRequest({
                    entries: { main: 'src/entry.js' },
                    target: 'browser',
                    root: 'E:/abs/project',
                    uses: [{ logical: 'main', execution: 'full', exports: { kind: 'all' } }],
                    publicBase: '/_vmz/',
                }),
            (error: unknown) => {
                assert.ok(error instanceof PackNativeError);
                assert.equal(error.code, 'pack.native.request-invalid');
                return true;
            },
        );
    });
});

describe('pack-native runPackPlan / runPackWrite (v0)', () => {
    const requestJson = buildPackRequest({
        entries: { main: 'E:/abs/src/entry.js' },
        target: 'browser',
        root: 'E:/abs/project',
        uses: [{ logical: 'main', execution: 'side-effects', exports: { kind: 'named', names: ['a', 'b'] } }],
        publicBase: '/_vmz/',
    });

    it('parses an ok response into artifacts, entryFiles and a parseable manifestJson', () => {
        const binding = fakeBinding(okResponseJson());
        const response = runPackPlan(requestJson, { binding });
        assert.equal(response.ok, true);
        assert.equal(response.plan.artifacts.length, 1);
        assert.equal(response.plan.artifacts[0].fileName, 'entry-main-ab12cd34.js');
        assert.deepEqual(response.plan.entryFiles, [{ logical: 'main', file: 'entry-main-ab12cd34.js' }]);
        const manifest = JSON.parse(response.plan.manifestJson);
        assert.equal(manifest.version, 'v0');
        assert.equal(binding.calls[0], `plan:${requestJson}`);
    });

    it('runPackWrite forwards the request and outDir to the binding', () => {
        const binding = fakeBinding(okResponseJson());
        const response = runPackWrite(requestJson, 'E:/abs/dist', { binding });
        assert.equal(response.plan.assets[0].url, '/_vmz/assets/logo-0123456789abcdef.svg');
        assert.equal(binding.calls[0], `write:${requestJson}:E:/abs/dist`);
    });

    it('throws with every diagnostic when ok is false', () => {
        const failing = JSON.stringify({
            ok: false,
            diagnostics: [
                { code: 'pack.unresolved', message: 'cannot resolve "lodash"', path: 'E:/abs/src/entry.js', span: [10, 20] },
                { code: 'pack.cycle', message: 'import cycle detected' },
            ],
        });
        try {
            runPackPlan(requestJson, { binding: fakeBinding(failing) });
            assert.fail('expected PackNativeError');
        } catch (error) {
            assert.ok(error instanceof PackNativeError);
            assert.equal(error.code, 'pack.native.plan-failed');
            assert.equal(error.diagnostics.length, 2);
            assert.deepEqual(error.diagnostics[0], {
                code: 'pack.unresolved',
                message: 'cannot resolve "lodash"',
                path: 'E:/abs/src/entry.js',
                span: [10, 20],
            });
            assert.equal(error.diagnostics[1].code, 'pack.cycle');
        }
    });

    it('rejects a response that is not valid JSON', () => {
        assert.throws(
            () => runPackPlan(requestJson, { binding: fakeBinding('not json {') }),
            (error: unknown) => {
                assert.ok(error instanceof PackNativeError);
                assert.equal(error.code, 'pack.native.response-json');
                return true;
            },
        );
    });

    it('rejects malformed plan shapes explicitly', () => {
        const cases: Array<(plan: Record<string, unknown>) => void> = [
            (plan) => {
                plan.artifacts = 'nope';
            },
            (plan) => {
                plan.artifacts = [{ chunkId: 'entry/main', code: '', modules: [], imports: [], dynamic: [] }];
            },
            (plan) => {
                delete (plan.artifacts as Record<string, unknown>[])[0].sourceMapFileName;
            },
            (plan) => {
                plan.entryFiles = [{ logical: 'main' }];
            },
            (plan) => {
                plan.styles = [{ fileName: 'style.css', url: '/style.css', modules: 'nope', sourcePaths: [] }];
            },
            (plan) => {
                delete plan.styles;
            },
            (plan) => {
                plan.manifestJson = 42;
            },
            (plan) => {
                (plan as Record<string, unknown>).extraField = true;
            },
        ];
        for (const mutate of cases) {
            const plan = structuredClone(validPlan) as Record<string, unknown>;
            mutate(plan);
            assert.throws(
                () => runPackPlan(requestJson, { binding: fakeBinding(okResponseJson(plan)) }),
                (error: unknown) => {
                    assert.ok(error instanceof PackNativeError);
                    assert.equal(error.code, 'pack.native.response-shape');
                    return true;
                },
            );
        }
    });

    it('rejects ok:true without plan and ok:false with plan', () => {
        assert.throws(
            () => runPackPlan(requestJson, { binding: fakeBinding(JSON.stringify({ ok: true, diagnostics: [] })) }),
            (error: unknown) => {
                assert.ok(error instanceof PackNativeError);
                assert.equal(error.code, 'pack.native.response-shape');
                return true;
            },
        );
        assert.throws(
            () =>
                runPackPlan(
                    requestJson,
                    { binding: fakeBinding(JSON.stringify({ ok: false, plan: validPlan, diagnostics: [] })) },
                ),
            (error: unknown) => {
                assert.ok(error instanceof PackNativeError);
                assert.equal(error.code, 'pack.native.response-shape');
                return true;
            },
        );
    });

    it('rejects a binding missing the contract functions', () => {
        assert.throws(
            () => runPackPlan(requestJson, { binding: {} as unknown as PackNativeBinding }),
            (error: unknown) => {
                assert.ok(error instanceof PackNativeError);
                assert.equal(error.code, 'pack.native.binding-missing');
                return true;
            },
        );
    });
});
