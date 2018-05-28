// @ts-nocheck
/**
 * Track per-file fingerprints so dev rebuilds only dirty leaves (N4).
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const WATCH_EXT = new Set(['.vmz', '.ts', '.tsx', '.js', '.mjs', '.css', '.json']);

/**
 * @param {string} srcDir
 * @returns {Map<string, string>}
 */
export function fileFingerprintMap(srcDir) {
    /** @type {Map<string, string>} */
    const map = new Map();
    walk(srcDir, (file) => {
        const st = statSync(file);
        map.set(file, `${st.mtimeMs}|${st.size}`);
    });
    return map;
}

/**
 * @param {Map<string, string>} prev
 * @param {Map<string, string>} next
 * @returns {{ changed: string[], deleted: string[] }}
 */
export function diffFingerprints(prev, next) {
    /** @type {string[]} */
    const changed = [];
    /** @type {string[]} */
    const deleted = [];
    for (const [file, fp] of next) {
        if (prev.get(file) !== fp) changed.push(file);
    }
    for (const file of prev.keys()) {
        if (!next.has(file)) deleted.push(file);
    }
    return { changed, deleted };
}

/**
 * @param {string} dir
 * @param {(file: string) => void} fn
 */
function walk(dir, fn) {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        const st = statSync(full);
        if (st.isDirectory()) walk(full, fn);
        else if (WATCH_EXT.has(path.extname(name))) fn(full);
    }
}
