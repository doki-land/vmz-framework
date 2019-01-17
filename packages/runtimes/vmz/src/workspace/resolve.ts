/**
 * Shared project path resolution for the Node CLI host .
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface ResolveWorkspaceDirsOpts {
    cwd?: string;
    path?: string;
    outDir?: string;
}

export interface PackageMeta {
    name?: string;
    private?: boolean;
}

export function findPackageJson(startDir: string): string | null {
    let dir = path.resolve(startDir);
    for (;;) {
        const candidate = path.join(dir, 'package.json');
        if (existsSync(candidate)) return candidate;
        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}

/** Resolve project root + out dir from CLI args / cwd. Prefers an explicit path; otherwise walks up for package.json with `src/`. */
export function resolveWorkspaceDirs(opts: ResolveWorkspaceDirsOpts = {}): {
    project: string;
    outDir: string;
    cwd: string;
} {
    const cwd = opts.cwd ?? process.cwd();
    const input = path.resolve(cwd, opts.path ?? '.');

    let project = input;
    if (!existsSync(path.join(project, 'src')) && !existsSync(path.join(project, 'package.json'))) {
        const pkg = findPackageJson(cwd);
        if (pkg) project = path.dirname(pkg);
    }

    const outDir = opts.outDir ? (path.isAbsolute(opts.outDir) ? opts.outDir : path.join(project, opts.outDir)) : path.join(project, 'dist');

    return { project, outDir, cwd };
}

export function readPackageMeta(projectRoot: string): PackageMeta | null {
    const pkgPath = path.join(projectRoot, 'package.json');
    if (!existsSync(pkgPath)) return null;
    try {
        return JSON.parse(readFileSync(pkgPath, 'utf8'));
    } catch {
        return null;
    }
}
