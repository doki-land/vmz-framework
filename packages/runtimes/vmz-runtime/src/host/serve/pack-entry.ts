import fs from 'node:fs';
import path from 'node:path';

const PACK_MANIFEST_REL = ['_vmz', 'pack-manifest.json'];
const PACK_OUTPUT_DIR_REL = ['_vmz', 'pack'];
const DEFAULT_PUBLIC_BASE = '/';

/**
 * Resolve the browser URL of a packed bootstrap entry from
 * `_vmz/pack-manifest.json`.
 *
 * The manifest is the only logical → physical map for browser delivery. A
 * missing manifest or a missing logical name is an explicit error: serving the
 * unpacked root module would hand the browser bare package specifiers that only
 * `vmz-pack` rewrites.
 */
export function packEntryHref(distDir: string, logical: string): string {
    const manifestPath = path.join(distDir, ...PACK_MANIFEST_REL);
    if (!fs.existsSync(manifestPath)) {
        throw new Error(`packEntryHref: missing ${manifestPath} — run vmz build (pack) first`);
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
        publicBase?: string;
        entryFiles?: Array<{ logical?: string; file?: string }>;
    };
    const hit = (manifest.entryFiles || []).find((entry) => entry && entry.logical === logical);
    if (!hit || typeof hit.file !== 'string' || !hit.file) {
        throw new Error(`packEntryHref: pack manifest has no entry file for "${logical}"`);
    }
    const base = String(manifest.publicBase || DEFAULT_PUBLIC_BASE).replace(/\/$/, '');
    return `${base}/${PACK_OUTPUT_DIR_REL.join('/')}/${hit.file}`;
}
