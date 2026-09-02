/**
 * Site favicon: author SVG → PNG + ICO + `_vmz/site-favicon.json` head links.
 * Convention: `assets/favicon.svg` (or `favicon.svg`) under project / already in dist.
 */

import fs from 'node:fs';
import path from 'node:path';
import { requireNativeAddon } from './native-addon.js';
import { writePrettyJsonFile } from './pretty-json.js';

export const SITE_FAVICON_SCHEMA = 'vmz.site_favicon.v0';

const ICO_SIZES = [16, 32, 48];

/**
 * @param {string} distDir
 * @param {{ projectRoot?: string, skipNative?: boolean }} [opts]
 */
interface SiteFaviconOpts {
    projectRoot?: string;
    skipNative?: boolean;
}

export function emitSiteFavicon(distDir: string, opts: SiteFaviconOpts = {}) {
    const absDist = path.resolve(distDir);
    const projectRoot = opts.projectRoot ? path.resolve(opts.projectRoot) : null;
    const src = discoverFaviconSvg(absDist, projectRoot);
    if (!src) {
        return { status: 'skipped', reason: 'no assets/favicon.svg' };
    }

    const svgText = fs.readFileSync(src.path, 'utf8');
    const assetsDir = path.join(absDist, 'assets');
    fs.mkdirSync(assetsDir, { recursive: true });
    const svgDest = path.join(assetsDir, 'favicon.svg');
    if (path.resolve(src.path) !== path.resolve(svgDest)) {
        fs.copyFileSync(src.path, svgDest);
    }

    /** @type {Buffer[]} */
    const pngs = [];
    if (!opts.skipNative) {
        const native = requireNativeAddon();
        if (typeof native.rasterizeSvgPng !== 'function') {
            throw new Error('vmz native addon missing rasterizeSvgPng — rebuild with `pnpm napi:build`');
        }
        for (const px of ICO_SIZES) {
            const buf = Buffer.from(native.rasterizeSvgPng(svgText, px));
            pngs.push(buf);
            fs.writeFileSync(path.join(assetsDir, `favicon-${px}.png`), buf);
        }
    }

    let icoPath = null;
    if (pngs.length) {
        const ico = packPngsIntoIco(pngs.map((png, i) => ({ png, size: ICO_SIZES[i] })));
        icoPath = path.join(absDist, 'favicon.ico');
        fs.writeFileSync(icoPath, ico);
    }

    const headParts = [];
    if (icoPath) {
        headParts.push('<link rel="icon" href="/favicon.ico" sizes="any">');
    }
    headParts.push('<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">');
    for (const px of ICO_SIZES) {
        if (fs.existsSync(path.join(assetsDir, `favicon-${px}.png`))) {
            headParts.push(`<link rel="icon" type="image/png" sizes="${px}x${px}" href="/assets/favicon-${px}.png">`);
        }
    }
    const headHtml = `${headParts.join('\n')}\n`;

    const artifact = {
        schema: SITE_FAVICON_SCHEMA,
        status: 'ready',
        source: src.rel,
        svg: 'assets/favicon.svg',
        ico: icoPath ? 'favicon.ico' : null,
        png: ICO_SIZES.filter((px) => fs.existsSync(path.join(assetsDir, `favicon-${px}.png`))).map((px) => `assets/favicon-${px}.png`),
        headHtml,
    };
    const vmzDir = path.join(absDist, '_vmz');
    fs.mkdirSync(vmzDir, { recursive: true });
    writePrettyJsonFile(path.join(vmzDir, 'site-favicon.json'), artifact);
    return artifact;
}

/**
 * Read ready head HTML for static/SSR shells (empty when missing).
 * @param {string} distDir
 */
export function readSiteFaviconHeadHtml(distDir) {
    try {
        const p = path.join(distDir, '_vmz', 'site-favicon.json');
        if (!fs.existsSync(p)) return '';
        const j = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (j?.status !== 'ready' || typeof j.headHtml !== 'string') return '';
        return j.headHtml;
    } catch {
        return '';
    }
}

/**
 * @param {string} distDir
 * @param {string|null} projectRoot
 */
function discoverFaviconSvg(distDir, projectRoot) {
    const candidates = [path.join(distDir, 'assets', 'favicon.svg'), path.join(distDir, 'favicon.svg')];
    if (projectRoot) {
        candidates.push(
            path.join(projectRoot, 'assets', 'favicon.svg'),
            path.join(projectRoot, 'favicon.svg'),
            path.join(projectRoot, 'public', 'assets', 'favicon.svg'),
            path.join(projectRoot, 'public', 'favicon.svg'),
        );
    }
    for (const abs of candidates) {
        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
            return {
                path: abs,
                rel: path.relative(projectRoot || distDir, abs).replace(/\\/g, '/') || 'assets/favicon.svg',
            };
        }
    }
    return null;
}

/**
 * PNG-in-ICO (Vista+); widely accepted by modern browsers.
 * @param {Array<{ png: Buffer, size: number }>} images
 */
export function packPngsIntoIco(images) {
    const count = images.length;
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(count, 4);
    const entries = Buffer.alloc(16 * count);
    /** @type {Buffer[]} */
    const blobs = [];
    let offset = 6 + 16 * count;
    for (let i = 0; i < count; i += 1) {
        const { png, size } = images[i];
        const o = i * 16;
        entries.writeUInt8(size >= 256 ? 0 : size, o);
        entries.writeUInt8(size >= 256 ? 0 : size, o + 1);
        entries.writeUInt8(0, o + 2);
        entries.writeUInt8(0, o + 3);
        entries.writeUInt16LE(1, o + 4);
        entries.writeUInt16LE(32, o + 6);
        entries.writeUInt32LE(png.length, o + 8);
        entries.writeUInt32LE(offset, o + 12);
        blobs.push(png);
        offset += png.length;
    }
    return Buffer.concat([header, entries, ...blobs]);
}
