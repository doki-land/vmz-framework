/**
 * Remove package dist/ before tsc so moved sources do not leave stale flat outputs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const target = process.argv[2];
if (!target) {
    console.error('clean-package-dist: missing dist path argument');
    process.exit(1);
}
const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '../..', target);
if (fs.existsSync(dist)) {
    fs.rmSync(dist, { recursive: true, force: true });
}
fs.mkdirSync(dist, { recursive: true });
console.log(`clean-package-dist: ${path.relative(path.join(here, '../..'), dist)}`);
