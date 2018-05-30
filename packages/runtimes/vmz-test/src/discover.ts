/**
 * Discover VMZ native test manifests .
 */

import fs from 'node:fs';
import path from 'node:path';
import { validateManifest } from './protocol.js';

const MANIFEST_RE = /\.vmz\.(test|spec)\.json$/i;

export function listManifestFiles(root: string): string[] {
    const abs = path.resolve(root);
    const out: string[] = [];
    walk(abs, out);
    out.sort();
    return out;
}

function walk(dir: string, out: string[]) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const ent of entries) {
        const name = ent.name;
        if (name === 'node_modules' || name === 'dist' || name === '.git' || name === 'target') {
            continue;
        }
        const full = path.join(dir, name);
        if (ent.isDirectory()) {
            walk(full, out);
            continue;
        }
        if (ent.isFile() && MANIFEST_RE.test(name)) {
            out.push(full);
        }
    }
}

export type DiscoveredManifest = Record<string, unknown> & {
    file: string;
    absoluteFile: string;
};

export function discoverTestManifests(projectRoot: string): {
    manifests: DiscoveredManifest[];
    errors: string[];
} {
    const root = path.resolve(projectRoot);
    const manifests: DiscoveredManifest[] = [];
    const errors: string[] = [];
    for (const file of listManifestFiles(root)) {
        let raw: unknown;
        try {
            raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch (e) {
            errors.push(`${file}: ${e instanceof Error ? e.message : String(e)}`);
            continue;
        }
        const v = validateManifest(raw, file);
        if (!v.ok) {
            errors.push(v.error);
            continue;
        }
        manifests.push({
            ...v.manifest,
            file: path.relative(root, file).split(path.sep).join('/'),
            absoluteFile: file,
        });
    }
    return { manifests, errors };
}
