/**
 * Dev config build process: restarts re-evaluate config in a fresh process,
 * cancel waits for the old process before the next cycle may write artifacts.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ConfigCycleCancelledError, createConfigCycle } from '../../src/dev/config-cycle.ts';
import { createDevSession } from '../../src/dev/dev-session.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.resolve(here, '..', '..', 'dist', 'dev', 'config-cycle-worker.js');

function fixture(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-config-cycle-'));
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'cycle', private: true, type: 'module' }));
    fs.writeFileSync(
        path.join(dir, 'src', 'Application.vmz'),
        '<template><p>hi</p></template>\n<script client>\nexport default class Application {}\n</script>\n',
    );
    return dir;
}

function writeConfig(dir: string, appId: string): void {
    fs.writeFileSync(
        path.join(dir, 'vmz.config.ts'),
        [
            "import { appendFileSync } from 'node:fs';",
            `appendFileSync(new URL('./cycle.log', import.meta.url), \`\${process.pid}:${appId}\\n\`);`,
            `export default { delivery: { default: '${appId}' } };`,
            '',
        ].join('\n'),
    );
}

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
    const start = Date.now();
    while (!predicate()) {
        if (Date.now() - start > timeoutMs) throw new Error('waitFor timeout');
        await new Promise((r) => setTimeout(r, 25));
    }
}

test('restart cancels the old config process and re-evaluates in a fresh one', async (t) => {
    const dir = fixture();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    writeConfig(dir, 'one');
    const cycle = createConfigCycle({ project: dir, outDir: path.join(dir, 'dist'), workerPath });

    const first = await cycle.start();
    assert.equal(first.ok, true, JSON.stringify(first.error));
    assert.deepEqual((first.delivery as { default: string }).default, 'one');
    assert.equal(first.plugins.length, 0);
    assert.equal(cycle.running(), false);

    writeConfig(dir, 'second');
    const second = await cycle.restart();
    assert.equal(second.ok, true, JSON.stringify(second.error));
    assert.deepEqual((second.delivery as { default: string }).default, 'second');

    const lines = fs
        .readFileSync(path.join(dir, 'cycle.log'), 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean);
    assert.equal(lines.length, 2, lines.join(' | '));
    const [firstPid] = lines[0].split(':');
    const [secondPid] = lines[1].split(':');
    assert.notEqual(firstPid, secondPid, 'a new config process must evaluate the change');
    assert.match(lines[0], /:one$/);
    assert.match(lines[1], /:second$/);

    await cycle.cancel();
    assert.equal(cycle.running(), false);
});

test('cancel waits for the running config process to exit', async (t) => {
    const dir = fixture();
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.writeFileSync(
        path.join(dir, 'vmz.config.ts'),
        [
            "import { writeFileSync } from 'node:fs';",
            "writeFileSync(new URL('./started.txt', import.meta.url), String(process.pid));",
            'await new Promise((r) => setTimeout(r, 30000));',
            "export default { delivery: { default: 'late' } };",
            '',
        ].join('\n'),
    );
    const cycle = createConfigCycle({ project: dir, outDir: path.join(dir, 'dist'), workerPath });
    const running = cycle.start();
    await waitFor(() => fs.existsSync(path.join(dir, 'started.txt')));

    const startedAt = Date.now();
    await cycle.cancel();
    assert.equal(cycle.running(), false);
    assert.ok(Date.now() - startedAt < 10_000, 'cancel must not hang');
    await assert.rejects(running, ConfigCycleCancelledError);
});

test('dev session restarts the config cycle on config change and packs after it', async (t) => {
    const dir = fixture();
    const outDir = path.join(dir, 'dist');
    writeConfig(dir, 'one');
    let started = 0;
    let restarted = 0;
    let cancelled = 0;
    let builds = 0;
    let packs = 0;
    const report = {
        ok: true,
        configPath: path.join(dir, 'vmz.config.ts'),
        pluginPath: null,
        plugins: [],
        engines: {},
        delivery: { default: 'one' },
    };
    const cycle = {
        start: async () => {
            started += 1;
            return report;
        },
        restart: async () => {
            restarted += 1;
            return { ...report, delivery: { default: 'two' } };
        },
        cancel: async () => {
            cancelled += 1;
        },
        running: () => true,
    };
    const session = createDevSession({
        project: dir,
        outDir,
        target: 'mini-program-wechat',
        pollMs: 40,
        configCycleFn: () => cycle,
        createWorkspaceFn: () => ({
            build: () => {
                builds += 1;
                return { diagnostics: [], full: true, affectedChunks: [], emitted: [] };
            },
            updateFiles() {},
            dispose() {},
            lowerMiniprogramWechatPackaging() {
                packs += 1;
                return JSON.stringify({ status: 'ready', packRoot: 'dist/wechat', diagnostics: [] });
            },
        }),
    });
    t.after(async () => {
        await session.stop();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const running = session.start();
    await waitFor(() => started === 1 && packs > 0);
    // Let start() finish snapshotting config fingerprints before mutating the file.
    await new Promise((r) => setTimeout(r, 200));
    const buildsBefore = builds;
    const packsBefore = packs;

    writeConfig(dir, 'second');
    await waitFor(() => restarted > 0);
    await waitFor(() => builds > buildsBefore && packs > packsBefore);
    assert.equal(restarted, 1);
    assert.equal(started, 1, 'config change restarts, it must not start a second cycle');

    await session.stop();
    await running;
    assert.ok(cancelled >= 1);
});
