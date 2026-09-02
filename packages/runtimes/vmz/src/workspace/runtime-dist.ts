/**
 * Resolve `@vmz/core` dist for runtime JS copies into app outDir.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pkgRoot = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));

export function resolveCoreRuntimeDist(): string | null {
    try {
        const serverJs = require.resolve('@vmz/core/server');
        // `@vmz/core/server` → dist/faces/server.js — dist root is one level above `faces/`.
        const distRoot = path.resolve(path.dirname(serverJs), '..');
        if (existsSync(path.join(distRoot, 'faces', 'server.js'))) return distRoot;
    } catch {
        /* not installed / not linked beside this host */
    }
    const nested = path.join(pkgRoot, 'node_modules', '@vmz', 'core', 'dist');
    const facesServer = path.join(nested, 'faces', 'server.js');
    if (existsSync(facesServer)) return nested;
    return null;
}
