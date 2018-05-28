// @ts-nocheck
/**
 * npm / pnpm workspace package resolution helpers (N4.3).
 * Design: `规划设计/vmz/14` — Node owns package resolution; Rust owns semantics.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * @typedef {object} ResolvedPackage
 * @property {string} name
 * @property {string} root
 * @property {boolean} [private]
 * @property {boolean} hasSrc
 * @property {string} [version]
 */

/**
 * Resolve workspace packages under a project (package.json workspaces or pnpm-workspace.yaml).
 * Does not invent VMZ semantics — only filesystem / npm layout facts for plugins.
 *
 * @param {string} project
 * @returns {ResolvedPackage[]}
 */
export function resolveWorkspacePackages(project) {
    const root = path.resolve(project);
    const patterns = readWorkspacePatterns(root);
    /** @type {Map<string, ResolvedPackage>} */
    const out = new Map();

    // Always include the project itself when it has package.json.
    const self = readPkg(root);
    if (self) out.set(self.root, self);

    for (const pattern of patterns) {
        for (const dir of expandWorkspacePattern(root, pattern)) {
            const pkg = readPkg(dir);
            if (pkg) out.set(pkg.root, pkg);
        }
    }

    return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Resolve a package name to an absolute root (workspace first, then node_modules).
 * @param {string} project
 * @param {string} name
 * @returns {string | null}
 */
export function resolvePackageRoot(project, name) {
    const hit = resolveWorkspacePackages(project).find((p) => p.name === name);
    if (hit) return hit.root;
    const nm = path.join(path.resolve(project), 'node_modules', ...name.split('/'));
    if (existsSync(path.join(nm, 'package.json'))) return nm;
    return null;
}

/**
 * @param {string} root
 * @returns {string[]}
 */
function readWorkspacePatterns(root) {
    const patterns = [];
    const pkgPath = path.join(root, 'package.json');
    if (existsSync(pkgPath)) {
        try {
            const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
            const ws = pkg.workspaces;
            if (Array.isArray(ws)) patterns.push(...ws);
            else if (ws && Array.isArray(ws.packages)) patterns.push(...ws.packages);
        } catch {
            /* ignore */
        }
    }
    const pnpm = path.join(root, 'pnpm-workspace.yaml');
    if (existsSync(pnpm)) {
        try {
            const text = readFileSync(pnpm, 'utf8');
            for (const line of text.split(/\r?\n/)) {
                const m = line.match(/^\s*-\s*['"]?([^'"]+)['"]?\s*$/);
                if (m) patterns.push(m[1]);
            }
        } catch {
            /* ignore */
        }
    }
    return [...new Set(patterns)];
}

/**
 * Minimal glob: supports `packages/*`, `examples/*`, exact dirs. No `**`.
 * @param {string} root
 * @param {string} pattern
 */
function expandWorkspacePattern(root, pattern) {
    const cleaned = pattern.replace(/\\/g, '/').replace(/\/$/, '');
    if (!cleaned.includes('*')) {
        const dir = path.join(root, cleaned);
        return existsSync(dir) ? [dir] : [];
    }
    const star = cleaned.indexOf('*');
    const prefix = cleaned.slice(0, star).replace(/\/$/, '');
    const suffix = cleaned.slice(star + 1); // e.g. "" or "/*" — we only support one *
    if (suffix.includes('*')) return [];
    const base = path.join(root, prefix);
    if (!existsSync(base)) return [];
    /** @type {string[]} */
    const dirs = [];
    for (const name of readdirSync(base, { withFileTypes: true })) {
        if (!name.isDirectory()) continue;
        const dir = path.join(base, name.name);
        if (suffix && !existsSync(path.join(dir, suffix.replace(/^\//, '')))) {
            // suffix after * is path remainder like `/foo` — rare; skip strict check
        }
        dirs.push(dir);
    }
    return dirs;
}

/**
 * @param {string} dir
 * @returns {ResolvedPackage | null}
 */
function readPkg(dir) {
    const pkgPath = path.join(dir, 'package.json');
    if (!existsSync(pkgPath)) return null;
    try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        if (!pkg.name) return null;
        return {
            name: pkg.name,
            root: dir,
            private: Boolean(pkg.private),
            hasSrc: existsSync(path.join(dir, 'src')),
            version: typeof pkg.version === 'string' ? pkg.version : undefined,
        };
    } catch {
        return null;
    }
}
