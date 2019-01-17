/**
 * Load packages/runtimes/vmz/host-runtime-files.json — sole host companion copy list.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type HostRuntimeFileEntry = {
    src: string;
    out: string;
    rewriteVmzRuntimeImport?: boolean;
};

export type HostRuntimeFilesManifest = {
    schema: string;
    files: HostRuntimeFileEntry[];
    launcherStub: { out: string; body: string };
};

const MANIFEST_BASENAME = 'host-runtime-files.json';

function manifestPathFromHere(): string {
    const here = dirname(fileURLToPath(import.meta.url));
    // src/host-materialize or dist/host-materialize → package root
    return join(here, '..', '..', MANIFEST_BASENAME);
}

let cached: HostRuntimeFilesManifest | null = null;

export function loadHostRuntimeFilesManifest(pathOverride?: string): HostRuntimeFilesManifest {
    if (!pathOverride && cached) return cached;
    const p = pathOverride || manifestPathFromHere();
    const raw = JSON.parse(readFileSync(p, 'utf8')) as HostRuntimeFilesManifest;
    if (raw.schema !== 'vmz.host-runtime-files.v0') {
        throw new Error(`host-runtime-files: unexpected schema ${raw.schema}`);
    }
    if (!Array.isArray(raw.files) || !raw.files.length) {
        throw new Error('host-runtime-files: files empty');
    }
    if (!raw.launcherStub?.out || typeof raw.launcherStub.body !== 'string') {
        throw new Error('host-runtime-files: launcherStub missing');
    }
    if (!pathOverride) cached = raw;
    return raw;
}

/** Flat [src, out] pairs for materialize / export compatibility. */
export function serveHostRuntimeFilePairs(manifest = loadHostRuntimeFilesManifest()): ReadonlyArray<readonly [string, string]> {
    return manifest.files.map((f) => [f.src, f.out] as const);
}
