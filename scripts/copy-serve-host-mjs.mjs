import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, '../packages/runtimes/vmz-runtime/dist');
const src = path.join(dist, 'serve-host.js');
const dst = path.join(dist, 'serve-host.mjs');
if (fs.existsSync(src)) fs.copyFileSync(src, dst);
