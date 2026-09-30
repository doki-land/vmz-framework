/**
 * Load packages/runtimes/vmz/delivery-runtime-files.json — sole browser/SSR delivery copy list.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type DeliveryRuntimeFileEntry = {
    src: string;
    out: string;
};

export type DeliveryRuntimeFilesManifest = {
    schema: string;
    flatBarrels: DeliveryRuntimeFileEntry[];
    nested: DeliveryRuntimeFileEntry[];
};

const MANIFEST_BASENAME = 'delivery-runtime-files.json';

function manifestPathFromHere(): string {
    const here = dirname(fileURLToPath(import.meta.url));
    return join(here, '..', '..', MANIFEST_BASENAME);
}

let cached: DeliveryRuntimeFilesManifest | null = null;

export function loadDeliveryRuntimeFilesManifest(pathOverride?: string): DeliveryRuntimeFilesManifest {
    if (!pathOverride && cached) return cached;
    const p = pathOverride || manifestPathFromHere();
    const raw = JSON.parse(readFileSync(p, 'utf8')) as DeliveryRuntimeFilesManifest;
    if (raw.schema !== 'vmz.delivery-runtime-files.v0') {
        throw new Error(`delivery-runtime-files: unexpected schema ${raw.schema}`);
    }
    if (!Array.isArray(raw.flatBarrels) || !raw.flatBarrels.length) {
        throw new Error('delivery-runtime-files: flatBarrels empty');
    }
    if (!Array.isArray(raw.nested) || !raw.nested.length) {
        throw new Error('delivery-runtime-files: nested empty');
    }
    if (!pathOverride) cached = raw;
    return raw;
}

/** All [src, out] pairs for materialize / pack. */
export function deliveryRuntimeFilePairs(manifest = loadDeliveryRuntimeFilesManifest()): ReadonlyArray<readonly [string, string]> {
    return [...manifest.flatBarrels, ...manifest.nested].map((f) => [f.src, f.out] as const);
}
