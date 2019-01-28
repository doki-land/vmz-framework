/**
 * 0.2.0 Package Layout Hygiene — static source-tree asserts.
 */

import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from './repo-root.ts';

const CORE_SRC = 'packages/runtimes/vmz-runtime/src';
const CLI_SRC = 'packages/runtimes/vmz/src';

const CORE_LAYERS = ['browser', 'ssr', 'host', 'faces', 'shared'] as const;

/** Root of @vmz/core/src may only hold these (prefer empty). */
const CORE_ROOT_ALLOW = new Set<string>();

const CLI_DOMAIN_DIRS = ['cli', 'workspace', 'document', 'locale', 'delivery', 'dev', 'host-materialize'] as const;

/** Flat prefixes that must live under domain dirs, not CLI src root. */
const CLI_FLAT_FORBIDDEN_PREFIXES = ['document-', 'locale-', 'delivery-', 'dev-'];

const CLI_INDEX_MAX_LINES = 200;

function listTsFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((n) => /\.(ts|tsx|mts|cts)$/.test(n) && fs.statSync(path.join(dir, n)).isFile());
}

export function assertPackageLayoutCore(root = repoRoot(import.meta.url)): string[] {
    const errors: string[] = [];
    const src = path.join(root, CORE_SRC);
    if (!fs.existsSync(src)) {
        errors.push(`missing ${CORE_SRC}`);
        return errors;
    }
    for (const layer of CORE_LAYERS) {
        const p = path.join(src, layer);
        if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) {
            errors.push(`missing ${CORE_SRC}/${layer}/`);
        }
    }
    for (const name of listTsFiles(src)) {
        if (!CORE_ROOT_ALLOW.has(name)) {
            errors.push(`${CORE_SRC}/${name}: root .ts forbidden (move under browser|ssr|host|faces|shared)`);
        }
    }
    return errors;
}

export function assertPackageLayoutCli(root = repoRoot(import.meta.url)): string[] {
    const errors: string[] = [];
    const src = path.join(root, CLI_SRC);
    if (!fs.existsSync(src)) {
        errors.push(`missing ${CLI_SRC}`);
        return errors;
    }
    for (const dir of CLI_DOMAIN_DIRS) {
        const p = path.join(src, dir);
        if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) {
            errors.push(`missing ${CLI_SRC}/${dir}/`);
        }
    }
    for (const name of listTsFiles(src)) {
        if (name === 'index.ts') continue;
        for (const prefix of CLI_FLAT_FORBIDDEN_PREFIXES) {
            if (name.startsWith(prefix)) {
                errors.push(`${CLI_SRC}/${name}: flat domain file must move under ${prefix.replace(/-$/, '')}/`);
            }
        }
    }
    const indexPath = path.join(src, 'index.ts');
    if (fs.existsSync(indexPath)) {
        const lines = fs.readFileSync(indexPath, 'utf8').split(/\r?\n/).length;
        if (lines > CLI_INDEX_MAX_LINES) {
            errors.push(`${CLI_SRC}/index.ts has ${lines} lines (max ${CLI_INDEX_MAX_LINES})`);
        }
    } else {
        errors.push(`missing ${CLI_SRC}/index.ts`);
    }
    return errors;
}

/** Flat dist basenames that live under faces|browser|ssr|host after 0.2.0 layout. */
const FLAT_CORE_DIST_BASENAMES = new Set([
    'dom.js',
    'dom.client.js',
    'dom.browser.js',
    'server.js',
    'http.js',
    'index.js',
    'vmz-dom.js',
    'vmz-runtime.js',
    'dom-core.js',
    'dom-ssr.js',
    'client-nav.js',
    'direct-host-box.js',
    'unknown-component.js',
    'direct-api.types.js',
    'position-context.js',
    'render-host.js',
    'serve-host.js',
    'serve-host.mjs',
    'list-client-components.js',
    'deployment-registry.js',
    'localize-body-links.js',
    'route-layout-chain.js',
    'native-addon.js',
]);

const STALE_FLAT_CORE_DIST_RE = /vmz-runtime['"]\s*,\s*['"]dist['"]\s*,\s*['"]([^'"]+)['"]/g;
const STALE_FLAT_CLI_SRC_IMPORT_RE = /from\s+['"][^'"]*\/src\/([a-z0-9-]+)\.ts['"]/g;

function walkTsFiles(absDir: string, out: string[]): void {
    if (!fs.existsSync(absDir)) return;
    for (const name of fs.readdirSync(absDir)) {
        const full = path.join(absDir, name);
        const st = fs.statSync(full);
        if (st.isDirectory()) {
            if (name === 'node_modules' || name === 'dist') continue;
            walkTsFiles(full, out);
        } else if (/\.(ts|tsx|mts|cts)$/.test(name)) {
            out.push(full);
        }
    }
}

/**
 * Tests must not hardcode pre-layout flat `@vmz/core` dist paths or flat CLI src imports.
 * Catches the class of CI failures that appear only after earlier gates pass.
 */
export function assertNoStaleLayoutImports(root = repoRoot(import.meta.url)): string[] {
    const errors: string[] = [];
    const testRoot = path.join(root, 'packages/runtimes/vmz/tests');
    const files: string[] = [];
    walkTsFiles(testRoot, files);
    for (const full of files) {
        const rel = path.relative(root, full).replace(/\\/g, '/');
        const text = fs.readFileSync(full, 'utf8');
        for (const m of text.matchAll(STALE_FLAT_CORE_DIST_RE)) {
            const basenames = m[1];
            // Allow layered joins: ..., 'dist', 'faces', 'dom.js'
            // The regex captures the segment immediately after 'dist'.
            if (CORE_LAYERS.includes(basenames as (typeof CORE_LAYERS)[number])) continue;
            if (FLAT_CORE_DIST_BASENAMES.has(basenames)) {
                errors.push(`${rel}: flat @vmz/core dist path '${basenames}' (use faces|browser|ssr|host)`);
            }
        }
        for (const m of text.matchAll(STALE_FLAT_CLI_SRC_IMPORT_RE)) {
            const base = m[1];
            if (base === 'index') continue;
            if ((CLI_DOMAIN_DIRS as readonly string[]).includes(base)) continue;
            errors.push(`${rel}: flat CLI src import '${base}.ts' (use cli|workspace|document|locale|delivery|dev|host-materialize)`);
        }
    }
    return errors;
}
