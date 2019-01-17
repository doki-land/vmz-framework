/**
 * Track per-file fingerprints so dev rebuilds only dirty leaves (session).
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const WATCH_EXT = new Set(['.vmz', '.ts', '.tsx', '.js', '.mjs', '.css', '.json']);

export function fileFingerprintMap(srcDir: string): Map<string, string> {
    const map = new Map<string, string>();
    walk(srcDir, (file) => {
        const st = statSync(file);
        map.set(file, `${st.mtimeMs}|${st.size}`);
    });
    return map;
}

export function diffFingerprints(prev: Map<string, string>, next: Map<string, string>): { changed: string[]; deleted: string[] } {
    const changed: string[] = [];
    const deleted: string[] = [];
    for (const [file, fp] of next) {
        if (prev.get(file) !== fp) changed.push(file);
    }
    for (const file of prev.keys()) {
        if (!next.has(file)) deleted.push(file);
    }
    return { changed, deleted };
}

function walk(dir: string, fn: (file: string) => void): void {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        const st = statSync(full);
        if (st.isDirectory()) walk(full, fn);
        else if (WATCH_EXT.has(path.extname(name))) fn(full);
    }
}
