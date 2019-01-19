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
