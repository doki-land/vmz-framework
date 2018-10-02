/**
 *: Node CLI / long-lived dev session rebuilds via Workspace -- never cargo/vmz-tools.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import { expect } from '../../../../../scripts/test/expect.mjs';
import { createDevSession, createWorkspace, parseArgs, resolveWorkspaceDirs, runCli, srcFingerprint } from 'vmz';

describe('vmz Node CLI host (N2)', () => {
    it('parseArgs handles flags and positionals', () => {
        const a = parseArgs(['.', '--out-dir', 'dist-x', '--port', '4000', '--release']);
        expect(a._).toEqual(['.']);
        expect(a['out-dir']).toBe('dist-x');
        expect(a.port).toBe('4000');
        expect(a.release).toBe(true);
        expect(Object.prototype.hasOwnProperty.call(a, 'port')).toBe(true);
        expect(Object.prototype.hasOwnProperty.call(parseArgs(['.']), 'port')).toBe(false);
        const t = parseArgs(['.', '--target', 'mini-program-wechat']);
        expect(t.target).toBe('mini-program-wechat');
    });

    it('resolveWorkspaceDirs joins relative out-dir', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-resolve-'));
        fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"t"}');
        fs.mkdirSync(path.join(dir, 'src'));
        const r = resolveWorkspaceDirs({ cwd: dir, path: '.', outDir: 'out' });
        expect(path.normalize(r.project)).toBe(path.normalize(dir));
        expect(path.normalize(r.outDir)).toBe(path.normalize(path.join(dir, 'out')));
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('runCli help exits 0 without native', async () => {
        const code = await runCli(['help']);
        expect(code).toBe(0);
    });

    it('dev session rebuild uses Workspace only (no cargo / vmz-tools spawn)', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-dev-sess-'));
        const src = path.join(dir, 'src');
        fs.mkdirSync(src);
        const vmz = path.join(src, 'Application.vmz');
        fs.writeFileSync(vmz, `<template><p>hi</p></template>\n<script client>\nexport default class Application {}\n</script>\n`);
        const outDir = path.join(dir, 'dist');

        /** @type {string[][]} */
        const spawned = [];
        const fakeChild = new EventEmitter();
        Object.assign(fakeChild, {
            killed: false,
            exitCode: null,
            kill() {
                this.killed = true;
                this.exitCode = 0;
            },
        });

        let builds = 0;
        const session = createDevSession({
            project: dir,
            outDir,
            host: '127.0.0.1',
            port: 59999,
            createWorkspaceFn: (opts) => {
                const ws = createWorkspace(opts);
                const origBuild = ws.build.bind(ws);
                ws.build = (...args) => {
                    builds += 1;
                    return origBuild(...args);
                };
                return ws;
            },
            spawnHostFn: () => {
                spawned.push(['host']);
                return /** @type {any} */ (fakeChild);
            },
            softReloadFn: async () => {},
        });

        const report = session.rebuild([{ path: vmz, kind: 'update' }]);
        expect(report.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
        expect(builds).toBe(1);

        // Second rebuild -- still Workspace, no CLI.
        const report2 = session.rebuild([{ path: vmz, kind: 'update' }]);
        expect(report2.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
        expect(builds).toBe(2);
        expect(spawned.filter((c) => c.some((x) => String(x).includes('cargo')))).toEqual([]);

        void session.stop();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('wechat preview packs dist/wechat and does not spawn serve-host', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-dev-wechat-'));
        const src = path.join(dir, 'src');
        fs.mkdirSync(src);
        fs.writeFileSync(
            path.join(src, 'Application.vmz'),
            `<template><p>hi</p></template>\n<script client>\nexport default class Application {}\n</script>\n`,
        );
        let packed = 0;
        /** @type {string[]} */
        const spawned = [];
        const session = createDevSession({
            project: dir,
            outDir: path.join(dir, 'dist'),
            target: 'mini-program-wechat',
            pollMs: 40,
            createWorkspaceFn: () => ({
                build: () => ({ diagnostics: [], full: true, affectedChunks: [], emitted: [] }),
                updateFiles() {},
                dispose() {},
                lowerMiniprogramWechatPackaging() {
                    packed += 1;
                    return JSON.stringify({ status: 'ready', packRoot: 'dist/wechat', diagnostics: [] });
                },
            }),
            spawnHostFn: () => {
                spawned.push('host');
                throw new Error('serve-host must not spawn for wechat preview');
            },
        });
        const started = session.start();
        await new Promise((r) => setTimeout(r, 80));
        await session.stop();
        await started.catch(() => {});
        expect(packed).toBeGreaterThanOrEqual(1);
        expect(spawned).toEqual([]);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('srcFingerprint changes when file updates', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-fp-'));
        const file = path.join(dir, 'x.vmz');
        fs.writeFileSync(file, 'a');
        const a = srcFingerprint(dir);
        await new Promise((r) => setTimeout(r, 20));
        fs.writeFileSync(file, 'b');
        const b = srcFingerprint(dir);
        expect(a).not.toBe(b);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('vmz check via runCli on tiny project', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-cli-check-'));
        fs.mkdirSync(path.join(dir, 'src'));
        fs.writeFileSync(
            path.join(dir, 'src', 'Application.vmz'),
            `<template><p>hi</p></template>\n<script client>\nexport default class Application {}\n</script>\n`,
        );
        const code = await runCli(['check', dir]);
        expect(code).toBe(0);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('vmz build --target mini-program-wechat packs dist/wechat', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-cli-wechat-build-'));
        fs.mkdirSync(path.join(dir, 'src', 'pages'), { recursive: true });
        fs.writeFileSync(
            path.join(dir, 'src', 'Application.vmz'),
            `<template><slot /></template>
<script client>
export default class Application {}
</script>
`,
        );
        fs.writeFileSync(
            path.join(dir, 'src', 'pages', 'home.vmz'),
            `<template><view class="home"><text>{{ n }}</text><button @click="inc">+</button></view></template>
<style>
.home { color: #111; }
</style>
<script client>
export default class HomePage {
  n = 0;
  inc() { this.n = this.n + 1; }
}
</script>
`,
        );
        const code = await runCli(['build', dir, '--target', 'mini-program-wechat']);
        expect(code).toBe(0);
        const packRoot = path.join(dir, 'dist', 'wechat');
        expect(fs.existsSync(path.join(packRoot, 'app.json'))).toBe(true);
        expect(fs.existsSync(path.join(packRoot, 'project.config.json'))).toBe(true);
        const projectCfg = JSON.parse(fs.readFileSync(path.join(packRoot, 'project.config.json'), 'utf8'));
        expect(projectCfg.miniprogramRoot).toBe('./');
        const stem = path.join(packRoot, 'pages', 'home', 'home');
        for (const ext of ['wxml', 'wxss', 'json', 'js']) {
            expect(fs.existsSync(`${stem}.${ext}`)).toBe(true);
        }
        fs.rmSync(dir, { recursive: true, force: true });
    });
});
