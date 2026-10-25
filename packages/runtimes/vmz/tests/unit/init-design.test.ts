import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { expect } from '../../../../../scripts/test/expect.mjs';
import { runCli } from 'vmz';

const MANIFEST = {
    schema: 'vmz.ui.preset.v0',
    id: 'web-surface',
    files: {
        root: 'presets/web-surface',
        theme: 'theme.json',
        tokens: ['tokens/brand.json'],
        themes: ['themes/dark.json'],
    },
};

let dir: string;
let logs: string[];
let originalLog: typeof console.log;

function write(file: string, data: unknown): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof data === 'string' ? data : `${JSON.stringify(data, null, 4)}\n`);
}

function installFakeUi(): void {
    const ui = path.join(dir, 'node_modules', '@vmz', 'ui');
    write(path.join(ui, 'package.json'), {
        name: '@vmz/ui',
        exports: {
            './presets/web-surface': './presets/web-surface.v0.json',
            './presets/web-surface/*': './presets/web-surface/*',
        },
    });
    write(path.join(ui, 'presets', 'web-surface.v0.json'), MANIFEST);
    write(path.join(ui, 'presets', 'web-surface', 'theme.json'), { entries: [] });
    write(path.join(ui, 'presets', 'web-surface', 'tokens', 'brand.json'), { brand: { primary: '#1677FF' } });
    write(path.join(ui, 'presets', 'web-surface', 'themes', 'dark.json'), { entries: [] });
}

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-init-design-'));
    write(path.join(dir, 'package.json'), { name: 'init-design-fixture' });
    installFakeUi();
    logs = [];
    originalLog = console.log;
    console.log = (...args: unknown[]) => {
        logs.push(args.join(' '));
    };
});

afterEach(() => {
    console.log = originalLog;
    fs.rmSync(dir, { recursive: true, force: true });
});

describe('vmz init design', () => {
    it('dry-run plans without writing files', async () => {
        const code = await runCli(['init', 'design', dir, '--dry-run']);
        expect(code).toBe(0);
        expect(fs.existsSync(path.join(dir, 'designs'))).toBe(false);
        expect(logs.join('\n')).toContain('create tokens/brand.json');
    });

    it('materializes the preset and skips existing files', async () => {
        expect(await runCli(['init', 'design', dir])).toBe(0);
        const brand = path.join(dir, 'designs', 'tokens', 'brand.json');
        const theme = path.join(dir, 'designs', 'theme.json');
        expect(fs.existsSync(brand)).toBe(true);
        expect(fs.existsSync(theme)).toBe(true);
        expect(fs.existsSync(path.join(dir, 'designs', 'themes', 'dark.json'))).toBe(true);

        fs.writeFileSync(brand, '{"custom":true}\n');
        expect(await runCli(['init', 'design', dir])).toBe(0);
        expect(fs.readFileSync(brand, 'utf8')).toBe('{"custom":true}\n');
        expect(logs.join('\n')).toContain('skip tokens/brand.json');
    });

    it('overwrites with --force', async () => {
        expect(await runCli(['init', 'design', dir])).toBe(0);
        const brand = path.join(dir, 'designs', 'tokens', 'brand.json');
        fs.writeFileSync(brand, '{"custom":true}\n');
        expect(await runCli(['init', 'design', dir, '--force'])).toBe(0);
        expect(fs.readFileSync(brand, 'utf8')).toContain('"primary"');
        expect(logs.join('\n')).toContain('overwrite tokens/brand.json');
    });

    it('honors --designs-dir', async () => {
        expect(await runCli(['init', 'design', dir, '--designs-dir', 'compositions/design'])).toBe(0);
        expect(fs.existsSync(path.join(dir, 'compositions', 'design', 'theme.json'))).toBe(true);
    });

    it('fails when @vmz/ui is not installed', async () => {
        fs.rmSync(path.join(dir, 'node_modules'), { recursive: true, force: true });
        expect(await runCli(['init', 'design', dir])).toBe(1);
    });
});
