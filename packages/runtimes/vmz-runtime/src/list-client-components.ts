// @ts-nocheck
/**
 * Discover compiled client component modules from dist (deployment graph or components/).
 * Shared by serve-host SSR and static emit assemble.
 */

import fs from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * @param {string} dir
 * @returns {Promise<Array<{ name: string, entry: string }>>}
 */
export async function listClientComponents(dir) {
    /** @type {Map<string, { name: string, entry: string }>} */
    const byName = new Map();
    try {
        const raw = await readFile(path.join(dir, 'vmz-deployment.json'), 'utf8');
        const dep = JSON.parse(raw);
        for (const unit of dep.units || []) {
            if (unit?.kind !== 'component') continue;
            const chunkId = String(unit.chunkId || '');
            const name = chunkId.split('/').pop();
            if (!name) continue;
            const entry = String(unit.clientEntry || `${chunkId}.client.js`).replace(/\\/g, '/');
            byName.set(name, { name, entry });
        }
    } catch {
        /* fall through to directory scan */
    }
    if (byName.size === 0) {
        const folder = path.join(dir, 'components');
        let files = [];
        try {
            files = await readdir(folder);
        } catch {
            return [];
        }
        for (const f of files.filter((name) => name.endsWith('.client.js'))) {
            const name = f.replace(/\.client\.js$/, '');
            byName.set(name, { name, entry: `components/${name}.client.js` });
        }
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Sync variant for callers that already use fs sync (legacy static-emit helpers).
 * @param {string} dir
 * @returns {Array<{ name: string, entry: string }>}
 */
export function listClientComponentsSync(dir) {
    /** @type {Map<string, { name: string, entry: string }>} */
    const byName = new Map();
    const deploymentPath = path.join(dir, 'vmz-deployment.json');
    if (fs.existsSync(deploymentPath)) {
        try {
            const dep = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
            for (const unit of dep.units || []) {
                if (unit?.kind !== 'component') continue;
                const chunkId = String(unit.chunkId || '');
                const name = chunkId.split('/').pop();
                if (!name) continue;
                const entry = String(unit.clientEntry || `${chunkId}.client.js`).replace(/\\/g, '/');
                byName.set(name, { name, entry });
            }
        } catch {
            /* fall through */
        }
    }
    if (byName.size === 0) {
        const folder = path.join(dir, 'components');
        let files = [];
        try {
            files = fs.readdirSync(folder);
        } catch {
            return [];
        }
        for (const f of files.filter((name) => name.endsWith('.client.js'))) {
            const name = f.replace(/\.client\.js$/, '');
            byName.set(name, { name, entry: `components/${name}.client.js` });
        }
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Import all (or filtered) client components and register for SSR / static emit.
 * @param {string} distDir
 * @param {(map: Record<string, unknown>) => void} registerComponents
 * @param {{
 *   cacheBust?: string | number,
 *   include?: (entry: { name: string, entry: string }) => boolean,
 * }} [opts]
 */
export async function preloadComponentRegistry(distDir, registerComponents, opts = {}) {
    const entries = await listClientComponents(distDir);
    /** @type {Record<string, unknown>} */
    const map = {};
    for (const entry of entries) {
        if (opts.include && !opts.include(entry)) continue;
        const abs = path.join(distDir, entry.entry);
        let href = pathToFileURL(abs).href;
        if (opts.cacheBust != null && opts.cacheBust !== '') {
            href = `${href}?t=${encodeURIComponent(String(opts.cacheBust))}`;
        }
        const mod = await import(href);
        map[entry.name] = mod.default;
    }
    if (Object.keys(map).length) registerComponents(map);
    return map;
}
