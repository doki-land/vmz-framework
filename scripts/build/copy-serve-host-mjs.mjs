/**
 * `@vmz/core` build: host/serve-host.js → host/serve-host.mjs (drop .js twin).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, '../../packages/runtimes/vmz-runtime/dist');
const src = path.join(dist, 'host', 'serve-host.js');
const dst = path.join(dist, 'host', 'serve-host.mjs');
if (!fs.existsSync(src)) {
    console.error(`copy-serve-host-mjs: missing ${src}`);
    process.exit(1);
}
fs.copyFileSync(src, dst);
fs.unlinkSync(src);
console.log(`copy-serve-host-mjs: host/serve-host.mjs (removed serve-host.js twin)`);
