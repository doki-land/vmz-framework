/**
 * Dev watch helpers: coalesce multi-file bursts without dropping dirty set,
 * and derive extra watch roots from the compile graph (deployment unit sources).
 *
 * DevInput layers (0.1.24): author · dependency · public · devControl.
 * Never watch `dist/`, generated indexes, or generation write-set paths.
 */

import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { diffFingerprints, fileFingerprintMap } from './watch-diff.js';

/** Author-facing vs generated dev input bucket. */
export type DevInputKind = 'author' | 'dependency' | 'public' | 'devControl' | 'locales' | 'docs' | 'designs' | 'other';

const CONFIG_BASENAMES = ['vmz.config.ts', 'vmz.config.js', 'vmz.config.mjs', 'vmz.config.cjs'] as const;

/** `vmz.config.*` at project root (devControl). */
export function collectDevConfigPaths(project: string): string[] {
    const root = path.resolve(project);
    return CONFIG_BASENAMES.map((name) => path.join(root, name)).filter((p) => existsSync(p));
}

/** Fingerprint map for explicit config files (not directory walks). */
export function configFingerprintMap(configPaths: string[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const p of configPaths) {
        try {
            const st = statSync(p);
            map.set(p, `${st.mtimeMs}:${st.size}`);
        } catch {
            /* ignore */
        }
    }
    return map;
}

export interface DirtySet {
    changed: string[];
    deleted: string[];
}

interface CoalesceRootBurstOpts {
    sleep?: (ms: number) => Promise<void>;
    maxRounds?: number;
    settleMs?: number;
}

export function mergeDirtySets(a: DirtySet, b: DirtySet): DirtySet {
    const changed = new Set(a?.changed || []);
    const deleted = new Set(a?.deleted || []);
    for (const f of b?.changed || []) {
        changed.add(f);
        deleted.delete(f);
    }
    for (const f of b?.deleted || []) {
        deleted.add(f);
        changed.delete(f);
    }
    return { changed: [...changed], deleted: [...deleted] };
}

/**
 * Wait until `root` stops changing; return the **accumulated** dirty set since `initial`.
 * Updates `fingerprints` for `root` as it polls. Does **not** discard `initial`.
 *
 * @param {string} root
 * @param {Map<string, Map<string, string>>} fingerprints
 * @param {DirtySet} initial
 * @param {{ sleep?: (ms: number) => Promise<void>, maxRounds?: number, settleMs?: number }} [opts]
 * @returns {Promise<DirtySet>}
 */
export async function coalesceRootBurst(
    root: string,
    fingerprints: Map<string, Map<string, string>>,
    initial: DirtySet,
    opts: CoalesceRootBurstOpts = {},
) {
    const sleepFn = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    const maxRounds = opts.maxRounds ?? 20;
    const settleMs = opts.settleMs ?? 220;

    let accumulated = {
        changed: [...(initial?.changed || [])],
        deleted: [...(initial?.deleted || [])],
    };
    let guard = 0;
    while (guard++ < maxRounds) {
        await sleepFn(settleMs);
        const prev = fingerprints.get(root) || new Map();
        const next = fileFingerprintMap(root);
        const diff = diffFingerprints(prev, next);
        fingerprints.set(root, next);
        if (!diff.changed.length && !diff.deleted.length) break;
        accumulated = mergeDirtySets(accumulated, diff);
    }
    return accumulated;
}

/**
 * Walk up from a file to find a package.json directory.
 * @param {string} file
 * @returns {string | null}
 */
export function findPackageRoot(file: string): string | null {
    let dir = path.dirname(path.resolve(file));
    for (let i = 0; i < 24; i++) {
        if (existsSync(path.join(dir, 'package.json'))) return dir;
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return null;
}

/**
 * Prefer package/src when present; otherwise the directory containing the source file.
 * @param {string} sourceFile
 * @returns {string | null}
 */
export function watchRootForSourceFile(sourceFile: string): string | null {
    const abs = path.resolve(sourceFile);
    if (!existsSync(abs)) return null;
    const pkg = findPackageRoot(abs);
    if (pkg) {
        const src = path.join(pkg, 'src');
        if (existsSync(src)) return src;
        return pkg;
    }
    return path.dirname(abs);
}

/**
 * Absolute roots for workspace / file / link deps that have a src tree.
 * @param {string} project
 * @returns {string[]}
 */
export function localLinkDependencyRoots(project: string): string[] {
    const pkgPath = path.join(path.resolve(project), 'package.json');
    if (!existsSync(pkgPath)) return [];
    /** @type {string[]} */
    const roots = [];
    try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
        for (const [name, spec] of Object.entries(deps)) {
            if (typeof spec !== 'string') continue;
            let target = null;
            if (spec.startsWith('workspace:')) {
                // Resolve via node_modules (pnpm links workspace packages there).
                const nm = path.join(path.resolve(project), 'node_modules', ...name.split('/'));
                if (existsSync(path.join(nm, 'package.json'))) target = nm;
            } else if (spec.startsWith('file:') || spec.startsWith('link:')) {
                const rel = spec.replace(/^(file|link):/, '');
                target = path.resolve(project, rel);
            }
            if (!target) continue;
            try {
                target = realpathSync(target);
            } catch {
                /* keep as-is */
            }
            const src = path.join(target, 'src');
            if (existsSync(src)) roots.push(src);
            else if (existsSync(target)) roots.push(target);
        }
    } catch {
        /* ignore */
    }
    return roots;
}

/**
 * Collect watch roots: project src/locales/documents + compile-graph external sources
 * + local link/workspace package roots. Never adds a bare registry node_modules tree.
 *
 * @param {{ project: string, outDir: string }} opts
 * @returns {{ roots: string[], dependencyRoots: string[], applicationRoots: string[] }}
 */
interface CollectDevWatchRootsOpts {
    project: string;
    outDir: string;
}

export function collectDevWatchRoots(opts: CollectDevWatchRootsOpts): {
    roots: string[];
    dependencyRoots: string[];
    applicationRoots: string[];
    publicRoot: string | null;
    configPaths: string[];
} {
    const project = path.resolve(opts.project);
    const outDir = path.resolve(opts.outDir);
    void outDir;
    const src = path.join(project, 'src');
    const docsRoot = path.join(project, 'documents');
    const localesRoot = path.join(project, 'locales');
    const designsRoot = path.join(project, 'designs');
    const publicRootPath = path.join(project, 'public');
    const publicRoot = existsSync(publicRootPath) && statSync(publicRootPath).isDirectory() ? publicRootPath : null;
    const configPaths = collectDevConfigPaths(project);

    const applicationRoots: string[] = [];
    if (existsSync(src)) applicationRoots.push(src);
    if (existsSync(docsRoot)) applicationRoots.push(docsRoot);
    if (existsSync(localesRoot)) applicationRoots.push(localesRoot);
    if (existsSync(designsRoot)) applicationRoots.push(designsRoot);
    if (publicRoot) applicationRoots.push(publicRoot);

    const depSet = new Set<string>();

    const depJson = path.join(outDir, 'vmz-deployment.json');
    if (existsSync(depJson)) {
        try {
            const dep = JSON.parse(readFileSync(depJson, 'utf8'));
            for (const unit of dep.units || []) {
                const source = unit?.source;
                if (typeof source !== 'string' || !source) continue;
                let abs = path.resolve(source);
                try {
                    abs = realpathSync(abs);
                } catch {
                    /* keep */
                }
                const underProject = abs === project || abs.startsWith(project + path.sep) || abs.startsWith(project + '/');
                if (underProject) continue;
                const root = watchRootForSourceFile(abs);
                if (root) depSet.add(path.resolve(root));
            }
        } catch {
            /* ignore corrupt deployment */
        }
    }

    for (const r of localLinkDependencyRoots(project)) {
        depSet.add(path.resolve(r));
    }

    // Drop dependency roots that are already under an application root.
    const dependencyRoots = [...depSet].filter((r) => {
        return !applicationRoots.some((app) => r === app || r.startsWith(app + path.sep) || r.startsWith(app + '/'));
    });

    const roots = [...applicationRoots];
    for (const r of dependencyRoots) {
        if (!roots.includes(r)) roots.push(r);
    }

    return { roots, dependencyRoots, applicationRoots, publicRoot, configPaths };
}

/** Map watch bucket to DevInput layer. */
export function devInputKindForWatchBucket(bucket: ReturnType<typeof classifyWatchRoot>): DevInputKind {
    if (bucket === 'src') return 'author';
    if (bucket === 'dep') return 'dependency';
    if (bucket === 'public') return 'public';
    if (bucket === 'locales') return 'locales';
    if (bucket === 'docs') return 'docs';
    if (bucket === 'designs') return 'designs';
    return 'other';
}

/**
 * Classify which watch bucket a root belongs to.
 * @param {string} root
 * @param {{
 *   src: string,
 *   docsRoot: string,
 *   localesRoot: string,
 *   designsRoot: string,
 *   dependencyRoots: string[],
 * }} ctx
 * @returns {'src' | 'locales' | 'docs' | 'designs' | 'dep' | 'other'}
 */
export interface ClassifyWatchRootCtx {
    src: string;
    docsRoot: string;
    localesRoot: string;
    designsRoot: string;
    publicRoot?: string | null;
    dependencyRoots: string[];
}

export function classifyWatchRoot(
    root: string,
    ctx: ClassifyWatchRootCtx,
): 'src' | 'locales' | 'docs' | 'designs' | 'dep' | 'public' | 'other' {
    if (root === ctx.src) return 'src';
    if (ctx.publicRoot && root === ctx.publicRoot) return 'public';
    if (root === ctx.localesRoot) return 'locales';
    if (root === ctx.docsRoot) return 'docs';
    if (root === ctx.designsRoot) return 'designs';
    if ((ctx.dependencyRoots || []).includes(root)) return 'dep';
    return 'other';
}

/**
 * Classify whether a changed file lives under a dependency watch root (not app src).
 * @param {string} file
 * @param {string[]} dependencyRoots
 */
export function isDependencyPath(file: string, dependencyRoots: string[]) {
    const abs = path.resolve(file);
    return (dependencyRoots || []).some((r) => abs === r || abs.startsWith(r + path.sep) || abs.startsWith(r + '/'));
}
