/**
 * Config host contract: native ESM loading, structured failures, no config
 * evaluation on help / invalid argv.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
    CONFIG_LOAD_FAILED,
    PLUGIN_ENTRY_INVALID,
    loadVmzConfig,
} from '../../src/workspace/plugin-host.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const vmzBin = path.resolve(here, '..', '..', 'bin', 'vmz.js');

function project(files: Record<string, string>): string {
    // Inside the package so bare npm imports (`@vmz/plugin-markdown-it`) resolve like a real project.
    const dir = fs.mkdtempSync(path.join(here, '.tmp-config-host-'));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'vmz-config-host-fixture', private: true, type: 'module' }));
    for (const [name, content] of Object.entries(files)) {
        const full = path.join(dir, name);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content);
    }
    return dir;
}

function runVmz(args: string[], cwd: string) {
    return spawnSync(process.execPath, [vmzBin, ...args], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}

test('loads vmz.config.mts through native ESM with erasable TS syntax', async (t) => {
    const dir = project({
        'types.mts': 'export interface WechatApp { appId: string }\n',
        'meta.mts': "export const appId: string = 'wx-native-config';\n",
        'vmz.config.mts': [
            "import type { WechatApp } from './types.mts';",
            "import { appId } from './meta.mts';",
            'const wechat: WechatApp = { appId };',
            'export default {',
            '  engines: { code: "shiki" },',
            '  delivery: { packaging: { wechat } },',
            '} satisfies Record<string, unknown>;',
            '',
        ].join('\n'),
    });
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    const cfg = await loadVmzConfig(dir);
    assert.equal(cfg.path, path.join(dir, 'vmz.config.mts'));
    assert.equal(cfg.engines.code, 'shiki');
    assert.equal(cfg.delivery.packaging.wechat.appId, 'wx-native-config');
    assert.deepEqual(cfg.plugins, []);
});

test('loads a project-local plugin entry and public npm plugin JS export', async (t) => {
    const dir = project({
        'local.plugin.ts': [
            'export default {',
            "  name: 'local-plugin',",
            "  version: '1.0.0',",
            '  stages: [],',
            '};',
            '',
        ].join('\n'),
        'vmz.config.ts': [
            "import markdownIt from '@vmz/plugin-markdown-it';",
            "export default { plugins: ['./local.plugin.ts', markdownIt] };",
            '',
        ].join('\n'),
    });
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    const cfg = await loadVmzConfig(dir);
    assert.deepEqual(
        cfg.plugins.map((p) => p.manifest.name),
        ['local-plugin', '@vmz/plugin-markdown-it'],
    );
});

test('non-erasable config syntax fails with a structured diagnostic', async (t) => {
    const dir = project({
        'vmz.config.ts': 'enum Raw { A = 1 }\nexport default { value: Raw.A };\n',
    });
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    await assert.rejects(loadVmzConfig(dir), (err: Error & { diagnostic?: { code: string; path: string; args: { detail: string } } }) => {
        assert.equal(err.diagnostic?.code, CONFIG_LOAD_FAILED);
        assert.equal(err.diagnostic?.path, path.join(dir, 'vmz.config.ts'));
        assert.ok(err.diagnostic?.args.detail.length);
        return true;
    });
});

test('config execution failure keeps the config path and cause in the diagnostic', async (t) => {
    const dir = project({
        'vmz.config.ts': "throw new Error('boom from vmz.config');\n",
    });
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    await assert.rejects(loadVmzConfig(dir), (err: Error & { diagnostic?: { code: string; args: { detail: string } } }) => {
        assert.equal(err.diagnostic?.code, CONFIG_LOAD_FAILED);
        assert.match(err.diagnostic?.args.detail ?? '', /boom from vmz\.config/);
        return true;
    });
});

test('missing plugin entry reports the resolved entry path', async (t) => {
    const dir = project({
        'vmz.config.ts': "export default { plugins: ['./missing.plugin.ts'] };\n",
    });
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    await assert.rejects(loadVmzConfig(dir), (err: Error & { diagnostic?: { code: string; path: string } }) => {
        assert.equal(err.diagnostic?.code, PLUGIN_ENTRY_INVALID);
        assert.equal(err.diagnostic?.path, path.join(dir, 'missing.plugin.ts'));
        return true;
    });
});

test('help, version and invalid argv do not evaluate the project config', async (t) => {
    const dir = project({
        'vmz.config.ts': [
            "import { writeFileSync } from 'node:fs';",
            "writeFileSync(new URL('./config-evaluated.txt', import.meta.url), 'yes');",
            'export default {};',
            '',
        ].join('\n'),
    });
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const marker = path.join(dir, 'config-evaluated.txt');

    const help = runVmz(['--help'], dir);
    assert.equal(help.status, 0, help.stderr);
    assert.ok(help.stdout.includes('Usage'));
    assert.equal(fs.existsSync(marker), false, '--help must not evaluate vmz.config');

    const version = runVmz(['--version'], dir);
    assert.equal(version.status, 0, version.stderr);
    assert.equal(fs.existsSync(marker), false, '--version must not evaluate vmz.config');

    const invalid = runVmz(['build', '--nope'], dir);
    assert.equal(invalid.status, 2, `${invalid.stdout}\n${invalid.stderr}`);
    assert.equal(fs.existsSync(marker), false, 'invalid argv must not evaluate vmz.config');
});

test('config execution failure exits 1 and prints one structured diagnostic', async (t) => {
    const dir = project({
        'vmz.config.ts': "throw new Error('boom at CLI boundary');\n",
    });
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    const build = runVmz(['build', dir], dir);
    assert.equal(build.status, 1, `${build.stdout}\n${build.stderr}`);
    const stderr = build.stderr;
    assert.match(stderr, /vmz::config::load_failed/);
    assert.match(stderr, /boom at CLI boundary/);
    assert.equal(stderr.split('vmz::config::load_failed').length - 1, 1, 'diagnostic must print once');
});
