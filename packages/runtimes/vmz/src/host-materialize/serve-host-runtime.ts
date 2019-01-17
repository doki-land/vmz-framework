/**
 * Copy `@vmz/core` host companions into delivery `_vmz/host/` per host-runtime-files.json.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadHostRuntimeFilesManifest, serveHostRuntimeFilePairs } from './host-runtime-files.js';
import { resolveCoreRuntimeDist } from '../workspace/runtime-dist.js';

export { serveHostRuntimeFilePairs };

/** Runtime companions required by dist/_vmz/host/vmz-serve-host.mjs relative imports. */
export const SERVE_HOST_RUNTIME_FILES: ReadonlyArray<readonly [string, string]> = serveHostRuntimeFilePairs();

/** Copy serve-host + registry bootstrap modules from `@vmz/core` into `_vmz/host/`. */
export function materializeServeHostRuntime(outDir: string, coreDist: string | null = resolveCoreRuntimeDist()): void {
    if (!coreDist) {
        throw new Error('materializeServeHostRuntime: @vmz/core dist not found');
    }
    const manifest = loadHostRuntimeFilesManifest();
    for (const entry of manifest.files) {
        const src = path.join(coreDist, entry.src);
        const dst = path.join(outDir, entry.out);
        if (!existsSync(src)) {
            throw new Error(`materializeServeHostRuntime: missing ${src}`);
        }
        mkdirSync(path.dirname(dst), { recursive: true });
        if (entry.rewriteVmzRuntimeImport) {
            const text = readFileSync(src, 'utf8')
                .replace(/from\s+(['"])\.\/vmz-runtime\.js\1/g, 'from $1../../vmz-runtime.js$1')
                .replace(/from\s+(['"])\.\.\/faces\/vmz-runtime\.js\1/g, 'from $1../../vmz-runtime.js$1')
                .replace(/from\s+(['"])\.\.\/faces\/server\.js\1/g, 'from $1../../vmz-runtime.js$1');
            writeFileSync(dst, text, 'utf8');
        } else {
            copyFileSync(src, dst);
        }
    }
    const stub = path.join(outDir, manifest.launcherStub.out);
    writeFileSync(stub, manifest.launcherStub.body, 'utf8');
}
