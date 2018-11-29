/**
 * plugin protocol tests + typed config / media adapters.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { expect } from '../../../../../scripts/test/expect.mjs';
import { PLUGIN_PROTOCOL, applyPlugins, contentHash, createWorkspace, defineConfig, definePlugin, loadVmzConfig } from 'vmz';
import katexPlugin from '@vmz/plugin-katex';
import shiki from '@vmz/plugin-shiki';
import conformance from 'vmz-plugin-conformance';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '../..');
const vmzDistIndex = path.join(packageRoot, 'dist', 'index.js');

describe('vmz plugin protocol (N3)', () => {
    it('PLUGIN_PROTOCOL is 0.1.0', () => {
        expect(PLUGIN_PROTOCOL).toBe('0.1.0');
    });

    it('rejects graph_mutation contributions', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-n3-rej-'));
        fs.mkdirSync(path.join(dir, 'src'));
        const ws = createWorkspace({ root: dir, outDir: path.join(dir, 'dist') });
        const report = ws.applyPluginContributions({
            pluginName: 'evil',
            pluginVersion: '0.0.1',
            protocol: PLUGIN_PROTOCOL,
            stage: 'workspace_resolve',
            cacheKey: 'x',
            items: [
                {
                    id: 'push',
                    kind: 'graph_mutation',
                    detail: 'nodes.push',
                },
            ],
        });
        expect(report.accepted).toBe(0);
        expect(report.rejected[0]?.reason).toMatch(/forbidden/i);
        ws.dispose();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('conformance plugin: source + target; program graph still from Rust build', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-n3-ok-'));
        fs.mkdirSync(path.join(dir, 'src'));
        fs.writeFileSync(
            path.join(dir, 'src', 'Application.vmz'),
            `<template><p>hi</p></template>\n<script client>\nexport default class Application {}\n</script>\n`,
        );
        const outDir = path.join(dir, 'dist');
        const ws = createWorkspace({ root: dir, outDir });

        const reports = await applyPlugins(ws, [conformance], { project: dir, outDir });
        expect(reports.some((r) => r.accepted > 0)).toBe(true);
        expect(fs.existsSync(path.join(dir, 'src', '.vmz-conformance-note.txt'))).toBe(true);

        const built = ws.build();
        expect(built.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
        expect(fs.existsSync(path.join(outDir, 'vmz-plugin-targets.json'))).toBe(true);
        expect(fs.existsSync(path.join(outDir, 'vmz-targets', 'edge-preview.json'))).toBe(true);
        expect(fs.existsSync(path.join(outDir, 'Application.program.json'))).toBe(true);
        const program = JSON.parse(fs.readFileSync(path.join(outDir, 'Application.program.json'), 'utf8'));
        expect(program.schema).toBe('vmz.program.v0');

        ws.dispose();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('definePlugin + defineConfig + hash helper', () => {
        const p = definePlugin({
            name: 't',
            version: '1.0.0',
            stages: ['analyzer'],
            contribute: () => ({ stage: 'analyzer', items: [] }),
        });
        expect(p.manifest.name).toBe('t');
        expect(contentHash('abc')).toHaveLength(64);
        const cfg = defineConfig({
            plugins: [p],
            engines: { math: 'katex', code: 'shiki' },
        });
        expect(cfg.engines?.math).toBe('katex');
    });

    it('loadVmzConfig reads vmz.config.ts and root vmz.plugin.ts', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-cfg-ts-'));
        const vmzEntry = vmzDistIndex;
        fs.writeFileSync(
            path.join(dir, 'vmz.config.ts'),
            `import { defineConfig } from ${JSON.stringify(vmzEntry)};
export default defineConfig({
  engines: { math: 'katex', code: 'shiki' },
  plugins: [],
});
`,
        );
        fs.writeFileSync(
            path.join(dir, 'vmz.plugin.ts'),
            `import { definePlugin } from ${JSON.stringify(vmzEntry)};
export default definePlugin({
  name: 'local-root-plugin',
  version: '0.0.1',
  stages: ['analyzer'],
  contribute: () => ({ stage: 'analyzer', items: [] }),
});
`,
        );
        const loaded = await loadVmzConfig(dir);
        expect(loaded.engines.math).toBe('katex');
        expect(loaded.engines.code).toBe('shiki');
        expect(loaded.path).toMatch(/vmz\.config\.ts$/);
        expect(loaded.pluginPath).toMatch(/vmz\.plugin\.ts$/);
        expect(loaded.plugins.some((p) => p.manifest.name === 'local-root-plugin')).toBe(true);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('katex + shiki plugins materialize components and Code/Math facades', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-media-'));
        fs.mkdirSync(path.join(dir, 'src'));
        fs.writeFileSync(
            path.join(dir, 'src', 'Application.vmz'),
            `<template><p>hi</p></template>\n<script client>\nexport default class Application {}\n</script>\n`,
        );
        const outDir = path.join(dir, 'dist');
        const ws = createWorkspace({ root: dir, outDir });
        const reports = await applyPlugins(ws, [katexPlugin, shiki()], {
            project: dir,
            outDir,
            engines: { math: 'katex', code: 'shiki' },
        });
        expect(reports.some((r) => r.accepted > 0)).toBe(true);
        expect(fs.existsSync(path.join(dir, 'src', 'components', 'Katex.vmz'))).toBe(true);
        expect(fs.existsSync(path.join(dir, 'src', 'components', 'Shiki.vmz'))).toBe(true);
        expect(fs.existsSync(path.join(dir, 'src', 'components', 'Math.vmz'))).toBe(true);
        expect(fs.existsSync(path.join(dir, 'src', 'components', 'Code.vmz'))).toBe(true);
        const math = fs.readFileSync(path.join(dir, 'src', 'components', 'Math.vmz'), 'utf8');
        expect(math).toContain('<Katex');
        expect(math).toContain('v-if=');
        expect(math).toContain('katex');
        const code = fs.readFileSync(path.join(dir, 'src', 'components', 'Code.vmz'), 'utf8');
        expect(code).toContain('<Shiki');
        expect(code).toContain('v-if=');
        expect(code).toContain("|| 'shiki'");
        expect(code).not.toContain('if={');
        // Attr values must not embed raw `"` (facades use `'…'` JS literals inside `"…"` attrs).
        for (const m of code.matchAll(/\bv-(?:else-)?if="([^"]*)"/g)) {
            expect(m[1].includes('"')).toBe(false);
        }
        ws.dispose();
        fs.rmSync(dir, { recursive: true, force: true });
    });
});
