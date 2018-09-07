/**
 * Assert content-addressed CSS @import targets are reachable with text/css (Gap 10 regression).
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const CSS_IMPORT_RE = /@import\s*(?:url\()?['"]?(\.\/)?([^'")\s;]+)['"]?\)?/gi;

export type HttpGetResult = {
    status: number;
    body: string;
    headers: http.IncomingHttpHeaders;
};

export function defaultHttpGet(url: string): Promise<HttpGetResult> {
    return new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
            const parts: Buffer[] = [];
            res.on('data', (c) => parts.push(c));
            res.on('end', () =>
                resolve({
                    status: res.statusCode || 0,
                    body: Buffer.concat(parts).toString('utf8'),
                    headers: res.headers,
                }),
            );
        });
        req.on('error', reject);
    });
}

function parseCssImportBasenames(cssText: string): string[] {
    const out: string[] = [];
    const re = new RegExp(CSS_IMPORT_RE.source, CSS_IMPORT_RE.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(cssText)) !== null) {
        const target = String(m[2] || '').replace(/^\.\//, '');
        if (target) out.push(path.basename(target));
    }
    return out;
}

/**
 * @param {string} distDir
 * @param {string} baseUrl no trailing slash
 * @param {(url: string) => Promise<HttpGetResult>} [getFn]
 * @returns {string[]} errors (empty = pass)
 */
export async function assertHashedCssImportsHttp(
    distDir: string,
    baseUrl: string,
    getFn: (url: string) => Promise<HttpGetResult> = defaultHttpGet,
): Promise<string[]> {
    const errors: string[] = [];
    const manifestPath = path.join(distDir, '_vmz', 'content-addressed-assets.json');
    if (!fs.existsSync(manifestPath)) {
        errors.push('missing _vmz/content-addressed-assets.json');
        return errors;
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const vmzCssObj = (manifest?.objects || []).find((o: { logicalPath: string }) => o.logicalPath === 'vmz.css');
    if (!vmzCssObj?.assetPath) {
        return errors;
    }
    const entryUrl = `${baseUrl}/${String(vmzCssObj.assetPath).replace(/^\//, '')}`;
    const entryRes = await getFn(entryUrl);
    if (entryRes.status !== 200) {
        errors.push(`GET ${entryUrl} status ${entryRes.status}`);
        return errors;
    }
    const entryType = String(entryRes.headers['content-type'] || '');
    if (!entryType.includes('text/css')) {
        errors.push(`GET ${entryUrl} content-type want text/css, got ${entryType || '(none)'}`);
    }
    const hashedCss = entryRes.body;
    if (hashedCss.includes('vmz-designs.css') || hashedCss.includes('vmz-style.css')) {
        errors.push('hashed vmz.css still contains unrewritten logical @import paths');
    }
    const importBasenames = parseCssImportBasenames(hashedCss);
    if (!importBasenames.length) {
        errors.push('hashed vmz.css has no @import siblings to verify');
        return errors;
    }
    for (const base of importBasenames) {
        const url = `${baseUrl}/assets/${base}`;
        const res = await getFn(url);
        if (res.status !== 200) {
            errors.push(`GET ${url} status ${res.status} (from vmz.css @import)`);
            continue;
        }
        const ct = String(res.headers['content-type'] || '');
        if (!ct.includes('text/css')) {
            errors.push(`GET ${url} content-type want text/css, got ${ct || '(none)'}`);
        }
    }
    return errors;
}
