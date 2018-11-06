/**
 * developer / project / global `vmz` JS gate.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { expect } from '../../../../../scripts/test/expect.mjs';
import { findNearestProjectVmz, getInvocationContext, isGlobalAllowedCommand, resolveThisPackageRoot, runCli } from 'vmz';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function tryReal(p) {
    try {
        return fs.realpathSync(p);
    } catch {
        return path.resolve(p);
    }
}

describe('vmz invocation gate', () => {
    it('resolveThisPackageRoot points at the vmz package', () => {
        const root = resolveThisPackageRoot();
        expect(fs.existsSync(path.join(root, 'package.json'))).toBe(true);
        const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
        expect(pkg.name).toBe('vmz');
    });

    it('monorepo source is developer mode', () => {
        const ctx = getInvocationContext({
            cwd: packageRoot,
            thisPackageRoot: packageRoot,
        });
        expect(ctx.mode).toBe('developer');
        expect(ctx.isDeveloper).toBe(true);
        expect(ctx.isProjectLocal).toBe(false);
        expect(ctx.isGlobalLike).toBe(false);
    });

    it('node_modules/@vmz/vmz matching nearest is project mode', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-inv-project-'));
        const linked = path.join(dir, 'node_modules', '@vmz', 'vmz');
        fs.mkdirSync(linked, { recursive: true });
        fs.writeFileSync(path.join(linked, 'package.json'), JSON.stringify({ name: '@vmz/vmz', version: '0.0.0' }));
        const ctx = getInvocationContext({
            cwd: dir,
            thisPackageRoot: linked,
        });
        expect(ctx.mode).toBe('project');
        expect(ctx.isProjectLocal).toBe(true);
        expect(ctx.isDeveloper).toBe(false);
        expect(ctx.isGlobalLike).toBe(false);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('legacy bare vmz matching nearest is still project mode', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-inv-project-legacy-'));
        const linked = path.join(dir, 'node_modules', 'vmz');
        fs.mkdirSync(linked, { recursive: true });
        fs.writeFileSync(path.join(linked, 'package.json'), '{"name":"vmz","version":"0.0.0"}');
        const ctx = getInvocationContext({
            cwd: dir,
            thisPackageRoot: linked,
        });
        expect(ctx.mode).toBe('project');
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('unrelated node_modules install is global mode', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-inv-global-'));
        const fakeGlobal = path.join(dir, 'npm-global', 'node_modules', '@vmz', 'vmz');
        fs.mkdirSync(fakeGlobal, { recursive: true });
        fs.writeFileSync(path.join(fakeGlobal, 'package.json'), JSON.stringify({ name: '@vmz/vmz', version: '0.0.0' }));
        const app = path.join(dir, 'app');
        fs.mkdirSync(app);
        const ctx = getInvocationContext({
            cwd: app,
            thisPackageRoot: fakeGlobal,
        });
        expect(ctx.mode).toBe('global');
        expect(ctx.isGlobalLike).toBe(true);
        expect(ctx.isDeveloper).toBe(false);
        expect(ctx.isProjectLocal).toBe(false);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('global + no local refuses check', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-inv-refuse-'));
        // Global prefix must not sit on the cwd walk path, or it looks project-local.
        const fakeGlobal = path.join(dir, 'npm-global', 'node_modules', '@vmz', 'vmz');
        fs.mkdirSync(fakeGlobal, { recursive: true });
        fs.writeFileSync(path.join(fakeGlobal, 'package.json'), JSON.stringify({ name: '@vmz/vmz', version: '0.0.0' }));

        const app = path.join(dir, 'app');
        fs.mkdirSync(app);

        const code = await runCli(['check', app], {
            cwd: app,
            thisPackageRoot: fakeGlobal,
        });
        expect(code).toBe(1);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('global + local present re-execs project bin', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-inv-reexec-'));
        const fakeGlobal = path.join(dir, 'global', 'node_modules', '@vmz', 'vmz');
        fs.mkdirSync(fakeGlobal, { recursive: true });
        fs.writeFileSync(path.join(fakeGlobal, 'package.json'), JSON.stringify({ name: '@vmz/vmz', version: '0.0.0-global' }));

        const localPkg = path.join(dir, 'app', 'node_modules', '@vmz', 'vmz');
        fs.mkdirSync(path.join(localPkg, 'bin'), { recursive: true });
        fs.writeFileSync(path.join(localPkg, 'package.json'), JSON.stringify({ name: '@vmz/vmz', version: '0.0.0-local' }));
        fs.writeFileSync(path.join(localPkg, 'bin', 'vmz.js'), '#!/usr/bin/env node\n');

        /** @type {{ bin: string, argv: string[] }[]} */
        const calls = [];
        const code = await runCli(['check', '.'], {
            cwd: path.join(dir, 'app'),
            thisPackageRoot: fakeGlobal,
            reexec: async (bin, argv) => {
                calls.push({ bin, argv });
                return 42;
            },
        });

        expect(code).toBe(42);
        expect(calls.length).toBe(1);
        expect(path.normalize(calls[0].bin)).toBe(path.normalize(path.join(localPkg, 'bin', 'vmz.js')));
        expect(calls[0].argv).toEqual(['check', '.']);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('developer check still reaches Workspace path', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-inv-local-'));
        fs.mkdirSync(path.join(dir, 'src'));
        fs.writeFileSync(
            path.join(dir, 'src', 'Application.vmz'),
            `<template><p>hi</p></template>\n<script client>\nexport default class Application {}\n</script>\n`,
        );

        // Pretend cwd resolved this workspace package as node_modules/@vmz/vmz
        const linked = path.join(dir, 'node_modules', '@vmz', 'vmz');
        fs.mkdirSync(path.dirname(linked), { recursive: true });
        fs.symlinkSync(packageRoot, linked, process.platform === 'win32' ? 'junction' : 'dir');

        const nearest = findNearestProjectVmz(dir);
        expect(nearest).toBeTruthy();

        const code = await runCli(['check', dir], {
            cwd: dir,
            thisPackageRoot: packageRoot,
        });
        expect(code).toBe(0);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('findNearestProjectVmz prefers @vmz/vmz', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-inv-prefer-'));
        const scoped = path.join(dir, 'node_modules', '@vmz', 'vmz');
        const legacy = path.join(dir, 'node_modules', 'vmz');
        fs.mkdirSync(scoped, { recursive: true });
        fs.mkdirSync(legacy, { recursive: true });
        fs.writeFileSync(path.join(scoped, 'package.json'), JSON.stringify({ name: '@vmz/vmz', version: '0.0.0' }));
        fs.writeFileSync(path.join(legacy, 'package.json'), JSON.stringify({ name: 'vmz', version: '0.0.0' }));
        const nearest = findNearestProjectVmz(dir);
        expect(nearest).toBeTruthy();
        expect(path.normalize(nearest)).toBe(path.normalize(tryReal(scoped)));
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('findNearestProjectVmz accepts scoped @vmz/vmz install', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-inv-scope-'));
        const linked = path.join(dir, 'node_modules', '@vmz', 'vmz');
        fs.mkdirSync(linked, { recursive: true });
        fs.writeFileSync(path.join(linked, 'package.json'), JSON.stringify({ name: '@vmz/vmz', version: '0.0.0' }));
        const nearest = findNearestProjectVmz(dir);
        expect(nearest).toBeTruthy();
        expect(path.normalize(nearest)).toBe(path.normalize(tryReal(linked)));
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('global mode only allows help and version', () => {
        expect(isGlobalAllowedCommand('help')).toBe(true);
        expect(isGlobalAllowedCommand('version')).toBe(true);
        expect(isGlobalAllowedCommand('new')).toBe(false);
        expect(isGlobalAllowedCommand('init')).toBe(false);
        expect(isGlobalAllowedCommand('lsp')).toBe(false);
        expect(isGlobalAllowedCommand('mcp')).toBe(false);
        expect(isGlobalAllowedCommand('check')).toBe(false);
    });

    it('removed native-forward commands are unknown', async () => {
        const codeNew = await runCli(['new', 'demo'], { cwd: packageRoot, thisPackageRoot: packageRoot });
        expect(codeNew).toBe(1);
        const codeLsp = await runCli(['lsp'], { cwd: packageRoot, thisPackageRoot: packageRoot });
        expect(codeLsp).toBe(1);
        const codeMcp = await runCli(['mcp'], { cwd: packageRoot, thisPackageRoot: packageRoot });
        expect(codeMcp).toBe(1);
    });

    it('global help is derived intro + version only (no scaffold / project walls)', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-inv-help-'));
        const fakeGlobal = path.join(dir, 'npm-global', 'node_modules', '@vmz', 'vmz');
        fs.mkdirSync(fakeGlobal, { recursive: true });
        fs.writeFileSync(path.join(fakeGlobal, 'package.json'), JSON.stringify({ name: '@vmz/vmz' }));
        const cwd = path.join(dir, 'empty-cwd');
        fs.mkdirSync(cwd);

        let out = '';
        const orig = console.log;
        console.log = (...a) => {
            out += a.join(' ') + '\n';
        };
        try {
            const code = await runCli(['help'], {
                cwd,
                thisPackageRoot: fakeGlobal,
            });
            expect(code).toBe(0);
            expect(out.includes('global install')).toBe(true);
            expect(out.includes('@vmz/vmz')).toBe(true);
            expect(out.includes('version')).toBe(true);
            expect(out.includes('vmz new')).toBe(false);
            expect(out.includes('vmz lsp')).toBe(false);
            expect(out.includes('cli.help.project')).toBe(false);
            expect(out.includes('vmz check [path]')).toBe(false);
            expect(out.includes('  check ')).toBe(false);
        } finally {
            console.log = orig;
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
