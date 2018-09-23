/**
 * Assert content-addressed hashed entry-client ESM imports resolve over HTTP (Gap: entry relative imports).
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

export type HttpGetResult = {
    status: number;
    body: string;
    headers: http.IncomingHttpHeaders;
};

const FROM_SPEC_RE = /\b(?:import|export)\s+[^'"\n]*?\s+from\s+(['"])([^'"]+)\1/g;
const IMPORT_CALL_RE = /\bimport\s*\(\s*(['"])([^'"]+)\1/g;

function collectStaticSpecs(jsText: string): string[] {
    const out: string[] = [];
    for (const re of [FROM_SPEC_RE, IMPORT_CALL_RE]) {
        const local = new RegExp(re.source, re.flags);
        let m: RegExpExecArray | null;
        while ((m = local.exec(jsText)) !== null) {
            const spec = String(m[2] || '');
            if (spec.startsWith('../') || spec.startsWith('./') || spec.startsWith('/')) {
                out.push(spec);
            }
        }
    }
    return out;
}

function resolveAgainstAssets(spec: string): string | null {
    if (spec.startsWith('/')) return spec;
    if (spec.startsWith('../')) {
        // /assets/<hash>.js + ../foo → /foo
        return `/${spec.slice(3)}`;
    }
    if (spec.startsWith('./')) {
        // sibling under /assets/
        return `/assets/${spec.slice(2)}`;
    }
    return null;
}

/**
 * @param {string} distDir
 * @param {string} baseUrl no trailing slash
 * @param {(url: string) => Promise<HttpGetResult>} getFn
 * @returns {string[]} errors (empty = pass)
 */
export async function assertHashedEntryImportsHttp(
    distDir: string,
    baseUrl: string,
    getFn: (url: string) => Promise<HttpGetResult>,
): Promise<string[]> {
    const errors: string[] = [];
    const manifestPath = path.join(distDir, '_vmz', 'content-addressed-assets.json');
    if (!fs.existsSync(manifestPath)) {
        errors.push('missing _vmz/content-addressed-assets.json');
        return errors;
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const entry = (manifest?.objects || []).find((o: { logicalPath: string }) => o.logicalPath === 'entry-client.js');
    if (!entry?.assetPath) {
        errors.push('entry-client.js not content-addressed');
        return errors;
    }
    const entryUrl = `${baseUrl}/${String(entry.assetPath).replace(/^\//, '')}`;
    const entryRes = await getFn(entryUrl);
    if (entryRes.status !== 200) {
        errors.push(`GET ${entryUrl} status ${entryRes.status}`);
        return errors;
    }
    const js = entryRes.body;
    if (/\bfrom\s+['"]\.\/(?!\.\.)/.test(js) || /import\(\s*['"]\.\/['"]\s*\+/.test(js)) {
        errors.push('hashed entry-client.js still contains unresolved ./ relative imports');
    }

    const specs = collectStaticSpecs(js).filter((s) => s.startsWith('../') || s.startsWith('./') || s.startsWith('/'));
    if (!specs.length) {
        errors.push('hashed entry-client.js has no static ESM specs to verify');
        return errors;
    }
    const seen = new Set<string>();
    for (const spec of specs) {
        const urlPath = resolveAgainstAssets(spec.split('?')[0]);
        if (!urlPath) continue;
        if (seen.has(urlPath)) continue;
        seen.add(urlPath);
        const url = `${baseUrl}${urlPath}`;
        const res = await getFn(url);
        if (res.status !== 200) {
            errors.push(`GET ${url} status ${res.status} (from entry import ${spec})`);
        }
    }
    return errors;
}
