/**
 * Assert the packed browser entry and its relative ESM closure resolve over HTTP.
 *
 * `vmz-pack` final-names browser chunks under `_vmz/pack/`, so the entry file
 * carries its content hash in the name and every internal import is relative to
 * that directory. Bare package specifiers must not survive packing.
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
const BARE_SPEC_RE = /\b(?:import|export)\s+[^'"\n]*?\s+from\s+(['"])(@[^'"]+)\1/g;

function collectLocalSpecs(jsText: string): string[] {
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

function hasBareSpecifier(jsText: string): boolean {
    return new RegExp(BARE_SPEC_RE.source, BARE_SPEC_RE.flags).test(jsText);
}

/** Resolve a relative/absolute ESM spec against the URL path of the importing module. */
function resolveSpecAgainstImporter(importerUrlPath: string, spec: string): string | null {
    if (spec.startsWith('/')) return spec;
    const importerDir = importerUrlPath.includes('/') ? importerUrlPath.slice(0, importerUrlPath.lastIndexOf('/')) : '';
    if (spec.startsWith('./')) {
        const leaf = spec.slice(2);
        return importerDir ? `${importerDir}/${leaf}` : `/${leaf}`;
    }
    if (spec.startsWith('../')) {
        const parts = importerDir.split('/').filter(Boolean);
        let rest = spec;
        while (rest.startsWith('../')) {
            parts.pop();
            rest = rest.slice(3);
        }
        const joined = [...parts, rest].filter(Boolean).join('/');
        return `/${joined}`;
    }
    return null;
}

/**
 * @param {string} distDir
 * @param {string} baseUrl no trailing slash
 * @param {(url: string) => Promise<HttpGetResult>} getFn
 * @returns {string[]} errors (empty = pass)
 */
export async function assertPackedEntryImportsHttp(
    distDir: string,
    baseUrl: string,
    getFn: (url: string) => Promise<HttpGetResult>,
): Promise<string[]> {
    const errors: string[] = [];
    const manifestPath = path.join(distDir, '_vmz', 'pack-manifest.json');
    if (!fs.existsSync(manifestPath)) {
        errors.push('missing _vmz/pack-manifest.json');
        return errors;
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const entry = (manifest?.entryFiles || []).find((item: { logical?: string }) => item.logical === 'entry-client.js');
    if (!entry?.file) {
        errors.push('entry-client.js is not packed');
        return errors;
    }
    const entryUrlPath = `/_vmz/pack/${entry.file}`;
    const entryRes = await getFn(`${baseUrl}${entryUrlPath}`);
    if (entryRes.status !== 200) {
        errors.push(`GET ${entryUrlPath} status ${entryRes.status}`);
        return errors;
    }
    const js = entryRes.body;
    if (hasBareSpecifier(js)) {
        errors.push('packed entry-client.js still contains bare package specifiers');
    }

    const seen = new Set<string>([entryUrlPath]);
    const queue: { urlPath: string; body: string; depth: number }[] = [{ urlPath: entryUrlPath, body: js, depth: 0 }];
    while (queue.length) {
        const current = queue.shift()!;
        if (current.depth >= 2) continue;
        for (const spec of collectLocalSpecs(current.body)) {
            const urlPath = resolveSpecAgainstImporter(current.urlPath, spec.split('?')[0]);
            if (!urlPath || seen.has(urlPath)) continue;
            seen.add(urlPath);
            const res = await getFn(`${baseUrl}${urlPath}`);
            if (res.status !== 200) {
                errors.push(`GET ${urlPath} status ${res.status} (from ${current.urlPath} import ${spec})`);
                continue;
            }
            if (/\.[cm]?js$/i.test(urlPath)) {
                queue.push({ urlPath, body: res.body, depth: current.depth + 1 });
            }
        }
    }
    return errors;
}
