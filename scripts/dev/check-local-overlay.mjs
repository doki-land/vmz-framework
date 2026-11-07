#!/usr/bin/env node
/**
 * Guard the git-ignored `.cargo/config.toml` path overlay.
 *
 * Cargo reads `.cargo/config.toml` from the current directory upward only, so a
 * `cargo` invocation started outside this repository silently resolves the git
 * revisions instead of the local checkouts. Build output never shows which source
 * won, which is how an overlay can be declared but inactive for months.
 *
 *   pnpm check:overlay                     # local: the overlay must be applied
 *   pnpm check:overlay --expect-no-overlay # CI: nothing may come from a local path
 *
 * Exit 0: local mode — no overlay file (clean clone), or every declared patch
 *         resolves to its declared path. CI mode — no overlay file and every
 *         dependency resolves from a pinned revision.
 * Exit 1: the path is missing, the declaration does not take effect, or CI would
 *         build from an unpinned local checkout.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CONFIG = path.join(ROOT, '.cargo', 'config.toml');
// CI has no checkout of the sibling repositories, so a local path dependency
// there means resolution drifted away from the pinned revisions.
const EXPECT_NO_OVERLAY = process.argv.includes('--expect-no-overlay');

const PATCH_HEADER = /^\s*\[patch\."([^"]+)"\]\s*$/;
const PATCH_ENTRY = /^\s*([A-Za-z0-9_-]+)\s*=\s*\{\s*path\s*=\s*"([^"]+)"\s*\}\s*$/;

function fail(message) {
    console.error(`check-local-overlay: ${message}`);
    process.exit(1);
}

function readDeclarations() {
    if (!fs.existsSync(CONFIG)) {
        return null;
    }
    const declarations = [];
    let source = null;
    for (const line of fs.readFileSync(CONFIG, 'utf8').split(/\r?\n/)) {
        const header = PATCH_HEADER.exec(line);
        if (header) {
            source = header[1];
            continue;
        }
        if (source === null) {
            continue;
        }
        const entry = PATCH_ENTRY.exec(line);
        if (entry) {
            declarations.push({ crate: entry[1], source, dir: path.resolve(ROOT, entry[2]) });
        }
    }
    return declarations;
}

function sameDir(a, b) {
    const left = path.resolve(a);
    const right = path.resolve(b);
    return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function assertPaths(declarations) {
    for (const { crate, dir } of declarations) {
        if (!fs.existsSync(dir) || !fs.existsSync(path.join(dir, 'Cargo.toml'))) {
            fail(`${crate} declares a path that does not exist: ${dir}`);
        }
    }
}

function resolveSources(locked) {
    // `cwd` is pinned to the repository root, which is the only place Cargo loads
    // this config from. Local mode deliberately skips `--locked`: the overlay
    // rewrites the resolution, so a git-form lock fails for the wrong reason.
    const result = spawnSync('cargo', ['metadata', '--format-version', '1', ...(locked ? ['--locked'] : [])], {
        cwd: ROOT,
        encoding: 'utf8',
        shell: false,
        maxBuffer: 64 * 1024 * 1024,
    });
    if (result.status !== 0) {
        fail(`cargo metadata failed (${result.status ?? result.error?.code ?? 'unknown'}):\n${(
            result.stderr || ''
        ).trim()}`);
    }
    try {
        return JSON.parse(result.stdout).packages ?? [];
    } catch {
        fail('cargo metadata returned invalid JSON');
    }
}

function isInsideRoot(file) {
    const target = path.resolve(file);
    const root = path.resolve(ROOT) + path.sep;
    return process.platform === 'win32'
        ? target.toLowerCase().startsWith(root.toLowerCase())
        : target.startsWith(root);
}

function assertPinnedResolution(packages) {
    // Workspace members live inside the repository and legitimately have no
    // `source`. Anything else without a `source` is a path dependency.
    const local = packages.filter((pkg) => pkg.source === null && !isInsideRoot(pkg.manifest_path));
    if (local.length > 0) {
        fail(
            `dependencies resolve from local checkouts instead of pinned revisions:\n${local
                .map((pkg) => `  ${pkg.name} -> ${pkg.manifest_path}`)
                .join('\n')}`,
        );
    }
    console.log(`check-local-overlay: ${packages.length} packages, all dependencies pinned`);
}

function main() {
    const declarations = readDeclarations();

    if (EXPECT_NO_OVERLAY) {
        if (declarations && declarations.length > 0) {
            fail(`a local overlay is declared (${CONFIG}) but this run requires pinned revisions`);
        }
        assertPinnedResolution(resolveSources(true));
        return;
    }

    if (!declarations || declarations.length === 0) {
        console.log('check-local-overlay: no local overlay declared, nothing to verify');
        return;
    }

    assertPaths(declarations);

    const packages = resolveSources(false);
    for (const { crate, dir } of declarations) {
        const applied = packages.some(
            (pkg) => pkg.name === crate && pkg.source === null && sameDir(path.dirname(pkg.manifest_path), dir),
        );
        if (!applied) {
            const seen = packages
                .filter((pkg) => pkg.name === crate)
                .map((pkg) => pkg.source ?? pkg.manifest_path)
                .join(', ');
            fail(`${crate} is declared at ${dir} but did not resolve there (resolved: ${seen || 'not in the dependency graph'})`);
        }
        console.log(`check-local-overlay: ${crate} -> ${dir}`);
    }

    if (!sameDir(process.cwd(), ROOT)) {
        console.log(`check-local-overlay: run cargo from ${ROOT}; a cargo started elsewhere ignores the overlay`);
    }
}

main();
