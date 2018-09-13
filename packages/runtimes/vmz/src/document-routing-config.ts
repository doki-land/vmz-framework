// @ts-nocheck
/**
 * Project locale routing config for document mount (locales/locales.json5).
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * @param {string} projectRoot
 * @returns {{ strategy?: string, defaultLocale?: string } | null}
 */
export function loadLocalesRouting(projectRoot) {
    const p = path.join(projectRoot, 'locales', 'locales.json5');
    if (!fs.existsSync(p)) return null;
    try {
        const raw = fs.readFileSync(p, 'utf8');
        let s = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        const m = s.match(/routing\s*:\s*\{([\s\S]*?)\}/);
        if (!m) return null;
        let block = `{${m[1]}}`;
        block = block.replace(/([,{]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
        block = block.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, inner) => JSON.stringify(inner));
        block = block.replace(/,\s*([}\]])/g, '$1');
        return JSON.parse(block);
    } catch {
        return null;
    }
}

/**
 * @param {string} routeBase
 * @param {string} pageKey
 */
export function docsRouteNone(routeBase, pageKey) {
    const base = String(routeBase || '/').replace(/\/$/, '') || '';
    const key = pageKey === 'index' ? '' : pageKey.replace(/\\/g, '/');
    const parts = [base.replace(/^\//, ''), key].filter((p) => p !== '');
    return '/' + (parts.length ? parts.join('/') : '');
}
