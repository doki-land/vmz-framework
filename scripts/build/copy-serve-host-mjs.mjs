/**
 * Publish `@vmz/core` with a single serve-host entry (`serve-host.mjs`).
 * tsc emits `serve-host.js`; we rename to `.mjs` and drop the twin so npm
 * packages / app copies do not ship identical content twice.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, '../../packages/runtimes/vmz-runtime/dist');
const src = path.join(dist, 'serve-host.js');
const dst = path.join(dist, 'serve-host.mjs');
if (!fs.existsSync(src)) {
    console.error(`copy-serve-host-mjs: missing ${src}`);
    process.exit(1);
}
fs.copyFileSync(src, dst);
fs.unlinkSync(src);
console.log(`copy-serve-host-mjs: ${path.basename(dst)} (removed serve-host.js twin)`);
