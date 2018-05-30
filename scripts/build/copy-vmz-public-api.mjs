import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, '../packages/runtimes/vmz/src/public-api.d.ts');
const dst = path.join(here, '../packages/runtimes/vmz/dist/index.d.ts');
if (fs.existsSync(src)) fs.copyFileSync(src, dst);
