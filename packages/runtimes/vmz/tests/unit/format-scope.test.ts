/**
 * `vmz format <path>` scope contract: an explicit path is the whole scope.
 *
 * Every case runs inside a throwaway git repo so `git status --short` is the
 * ground truth for "what changed" — the strongest guard against scope leaks
 * like the historical implicit `cargo fmt --all`.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { expect } from '../../../../../scripts/test/expect.mjs';
import { runCli } from 'vmz';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const hasRustfmt = spawnSync('rustfmt', ['--version'], { stdio: 'ignore' }).status === 0;

let dir: string | undefined;

function git(args: string[], cwd: string): string {
    const r = spawnSync('git', ['-c', 'user.name=vmz-test', '-c', 'user.email=vmz-test@example.com', ...args], {
        cwd,
        encoding: 'utf8',
    });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
    return r.stdout;
}

function statusPaths(cwd: string): string[] {
    const out = git(['status', '--short'], cwd);
    return out
        .split('\n')
        .filter((line) => line.length > 2)
        .map((line) => line.slice(3).trim().replace(/\\/g, '/'))
        .sort();
}

function setup(files: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-format-scope-'));
    git(['-c', 'init.defaultBranch=dev', 'init', '-q'], root);
    for (const [rel, content] of Object.entries(files)) {
        const file = path.join(root, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
    }
    git(['add', '-A'], root);
    git(['commit', '-qm', 'baseline'], root);
    dir = root;
    return root;
}

function runFormat(argv: string[]): Promise<number> {
    return runCli(argv, { cwd: packageRoot, thisPackageRoot: packageRoot });
}

afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = undefined;
});

describe('vmz format scope', () => {
    it('single .ts file formats only itself', async () => {
        const root = setup({
            'target.ts': 'const  x=1',
            'sibling.ts': 'const  y=2',
            'package.json': '{"name":"scope-ts","private":true}\n',
        });
        const siblingMtime = fs.statSync(path.join(root, 'sibling.ts')).mtimeMs;

        const code = await runFormat(['format', path.join(root, 'target.ts')]);

        expect(code).toBe(0);
        expect(fs.readFileSync(path.join(root, 'target.ts'), 'utf8')).toBe('const x = 1');
        expect(fs.readFileSync(path.join(root, 'sibling.ts'), 'utf8')).toBe('const  y=2');
        expect(fs.statSync(path.join(root, 'sibling.ts')).mtimeMs).toBe(siblingMtime);
        expect(statusPaths(root)).toEqual(['target.ts']);
    });

    it('single .vmz file formats only itself', async () => {
        const vmz = (decl: string) =>
            `<template><p>hi</p></template>\n<script client>\n${decl}\nexport default class App {}\n</script>\n`;
        const root = setup({
            'src/package.json': '{"name":"scope-vmz","private":true}\n',
            'src/Target.vmz': vmz('const  x=1'),
            'src/Sibling.vmz': vmz('const  y=2'),
        });
        const target = path.join(root, 'src', 'Target.vmz');
        const sibling = path.join(root, 'src', 'Sibling.vmz');
        const siblingBefore = fs.readFileSync(sibling, 'utf8');

        const code = await runFormat(['format', target]);

        expect(code).toBe(0);
        const after = fs.readFileSync(target, 'utf8');
        expect(after.includes('const x = 1')).toBe(true);
        expect(after.includes('const  x=1')).toBe(false);
        expect(fs.readFileSync(sibling, 'utf8')).toBe(siblingBefore);
        expect(statusPaths(root)).toEqual(['src/Target.vmz']);
    });

    it('explicit single .rs file formats only itself', { skip: !hasRustfmt }, async () => {
        const root = setup({
            'Cargo.toml': '[package]\nname = "scope-rs"\nedition = "2021"\n',
            'src/lib.rs': 'mod child;\nfn  parent( ) {}\n',
            'src/child.rs': 'fn  child( ) {}\n',
        });

        const code = await runFormat(['format', path.join(root, 'src', 'lib.rs')]);

        expect(code).toBe(0);
        expect(fs.readFileSync(path.join(root, 'src', 'lib.rs'), 'utf8')).toBe('mod child;\nfn parent() {}\n');
        // rustfmt must not follow `mod child;` — the historical leak class.
        expect(fs.readFileSync(path.join(root, 'src', 'child.rs'), 'utf8')).toBe('fn  child( ) {}\n');
        expect(statusPaths(root)).toEqual(['src/lib.rs']);
    });

    it('directory target stays inside the directory', async () => {
        const root = setup({
            'inside/a.ts': 'const  x=1',
            'inside/nested/b.ts': 'const  y=2',
            'outside/c.ts': 'const  z=3',
            'package.json': '{"name":"scope-dir","private":true}\n',
        });

        const code = await runFormat(['format', path.join(root, 'inside')]);

        expect(code).toBe(0);
        expect(fs.readFileSync(path.join(root, 'inside', 'a.ts'), 'utf8')).toBe('const x = 1');
        expect(fs.readFileSync(path.join(root, 'inside', 'nested', 'b.ts'), 'utf8')).toBe('const y = 2');
        expect(fs.readFileSync(path.join(root, 'outside', 'c.ts'), 'utf8')).toBe('const  z=3');
        expect(statusPaths(root)).toEqual(['inside/a.ts', 'inside/nested/b.ts']);
    });

    it('no arguments exits non-zero and changes nothing', async () => {
        const root = setup({
            'target.ts': 'const  x=1',
            'package.json': '{"name":"scope-none","private":true}\n',
        });

        const code = await runFormat(['format']);

        expect(code).toBe(1);
        expect(fs.readFileSync(path.join(root, 'target.ts'), 'utf8')).toBe('const  x=1');
        expect(statusPaths(root)).toEqual([]);
    });

    it('missing path exits non-zero and changes nothing', async () => {
        const root = setup({
            'target.ts': 'const  x=1',
            'package.json': '{"name":"scope-missing","private":true}\n',
        });

        const code = await runFormat(['format', path.join(root, 'does-not-exist.ts')]);

        expect(code).toBe(1);
        expect(fs.readFileSync(path.join(root, 'target.ts'), 'utf8')).toBe('const  x=1');
        expect(statusPaths(root)).toEqual([]);
    });
});
