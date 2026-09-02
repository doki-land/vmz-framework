/**
 * v0.1.5: coalesce keeps dirty set; watch roots follow compile graph / local links.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { expect } from '../../../../../scripts/test/expect.mjs';
import { coalesceRootBurst, collectDevWatchRoots, classifyWatchRoot, mergeDirtySets } from '../../src/dev/dev-watch-roots.ts';
import { fileFingerprintMap } from '../../src/workspace/watch-diff.ts';

describe('dev-watch coalesce + roots (v0.1.5)', () => {
    it('mergeDirtySets prefers later change over delete and vice versa', () => {
        const a = { changed: ['a.vmz', 'b.vmz'], deleted: ['c.vmz'] };
        const b = { changed: ['c.vmz'], deleted: ['a.vmz'] };
        const m = mergeDirtySets(a, b);
        expect(m.changed.sort()).toEqual(['b.vmz', 'c.vmz']);
        expect(m.deleted.sort()).toEqual(['a.vmz']);
    });

    it('coalesceRootBurst keeps initial dirty after fingerprint advances', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-coalesce-'));
        const f1 = path.join(dir, 'one.vmz');
        const f2 = path.join(dir, 'two.vmz');
        fs.writeFileSync(f1, 'a');
        fs.writeFileSync(f2, 'a');
        /** @type {Map<string, Map<string, string>>} */
        const fingerprints = new Map();
        fingerprints.set(dir, fileFingerprintMap(dir));

        const initial = { changed: [f1, f2], deleted: [] };
        fingerprints.set(dir, fileFingerprintMap(dir));

        let sleeps = 0;
        const result = await coalesceRootBurst(dir, fingerprints, initial, {
            maxRounds: 3,
            settleMs: 5,
            sleep: async () => {
                sleeps += 1;
            },
        });
        expect(sleeps).toBeGreaterThanOrEqual(1);
        expect(result.changed.sort()).toEqual([f1, f2].sort());
        expect(result.deleted).toEqual([]);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('coalesceRootBurst accumulates files created during settle', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-coalesce2-'));
        const f1 = path.join(dir, 'one.vmz');
        fs.writeFileSync(f1, 'a');
        /** @type {Map<string, Map<string, string>>} */
        const fingerprints = new Map();
        fingerprints.set(dir, fileFingerprintMap(dir));
        const initial = { changed: [f1], deleted: [] };

        let round = 0;
        const f2 = path.join(dir, 'two.vmz');
        const result = await coalesceRootBurst(dir, fingerprints, initial, {
            maxRounds: 5,
            settleMs: 5,
            sleep: async () => {
                round += 1;
                if (round === 1) fs.writeFileSync(f2, 'b');
            },
        });
        expect(result.changed.sort()).toEqual([f1, f2].sort());
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('collectDevWatchRoots includes external deployment sources and file: deps', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-watch-mono-'));
        const app = path.join(root, 'app');
        const kit = path.join(root, 'kit');
        fs.mkdirSync(path.join(app, 'src', 'pages'), { recursive: true });
        fs.mkdirSync(path.join(app, 'dist'), { recursive: true });
        fs.mkdirSync(path.join(kit, 'src', 'components'), { recursive: true });
        fs.writeFileSync(path.join(kit, 'package.json'), JSON.stringify({ name: '@tmp/kit', version: '0.0.0' }));
        const shell = path.join(kit, 'src', 'components', 'Shell.vmz');
        fs.writeFileSync(shell, '<template><div /></template>\n');
        const relKit = path.relative(app, kit).replace(/\\/g, '/');
        fs.writeFileSync(
            path.join(app, 'package.json'),
            JSON.stringify({
                name: '@tmp/app',
                version: '0.0.0',
                dependencies: { '@tmp/kit': `file:${relKit}` },
            }),
        );
        fs.writeFileSync(path.join(app, 'src', 'pages', 'index.vmz'), '<template><div /></template>\n');

        // Simulate compile graph: unit source outside the app project.
        fs.writeFileSync(
            path.join(app, 'dist', 'vmz-deployment.json'),
            JSON.stringify({
                schema: 'vmz.deployment.v0',
                units: [
                    {
                        chunkId: 'pages/index',
                        kind: 'page',
                        source: path.join(app, 'src', 'pages', 'index.vmz'),
                    },
                    {
                        chunkId: 'components/Shell',
                        kind: 'component',
                        source: shell,
                    },
                ],
            }),
        );

        const watched = collectDevWatchRoots({ project: app, outDir: path.join(app, 'dist') });
        const kitSrc = path.resolve(path.join(kit, 'src'));
        expect(watched.dependencyRoots.map((r) => path.resolve(r))).toContain(kitSrc);
        expect(watched.roots.map((r) => path.resolve(r))).toContain(kitSrc);
        expect(watched.applicationRoots.some((r) => path.resolve(r) === path.resolve(path.join(app, 'src')))).toBe(true);

        fs.rmSync(root, { recursive: true, force: true });
    });

    it('collectDevWatchRoots includes public/ when present', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-watch-public-'));
        const app = path.join(root, 'app');
        fs.mkdirSync(path.join(app, 'src', 'pages'), { recursive: true });
        fs.mkdirSync(path.join(app, 'public', 'images'), { recursive: true });
        fs.writeFileSync(path.join(app, 'public', 'images', 'logo.png'), 'x');
        fs.writeFileSync(path.join(app, 'src', 'pages', 'index.vmz'), '<template><div /></template>\n');
        fs.mkdirSync(path.join(app, 'dist'), { recursive: true });
        fs.writeFileSync(path.join(app, 'dist', 'vmz-deployment.json'), JSON.stringify({ schema: 'vmz.deployment.v0', units: [] }));
        const watched = collectDevWatchRoots({ project: app, outDir: path.join(app, 'dist') });
        expect(watched.publicRoot).toBe(path.join(app, 'public'));
        expect(watched.roots).toContain(watched.publicRoot);
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('classifyWatchRoot routes public/ to public bucket', () => {
        const project = '/tmp/app';
        const ctx = {
            src: path.join(project, 'src'),
            docsRoot: path.join(project, 'documents'),
            localesRoot: path.join(project, 'locales'),
            designsRoot: path.join(project, 'designs'),
            publicRoot: path.join(project, 'public'),
            dependencyRoots: [path.join(project, 'node_modules', '@pkg', 'ui', 'src')],
        };
        expect(classifyWatchRoot(ctx.publicRoot, ctx)).toBe('public');
        expect(classifyWatchRoot(ctx.designsRoot, ctx)).toBe('designs');
        expect(classifyWatchRoot(ctx.src, ctx)).toBe('src');
        expect(classifyWatchRoot(ctx.docsRoot, ctx)).toBe('docs');
        expect(classifyWatchRoot(ctx.dependencyRoots[0], ctx)).toBe('dep');
        expect(classifyWatchRoot(path.join(project, 'other'), ctx)).toBe('other');
    });
});
