/**
 * Build `@vmz/ui-charts` library artifacts.
 *
 * Two inputs, one output tree:
 *   1. `vmz lib` compiles every `.vmz` in `exports` into `dist/<Entry>.js`
 *      (+ `dist/<Entry>.css`), keeping bare specifiers intact.
 *   2. The hand-written `types/<Entry>.d.ts` contracts are copied next to the
 *      modules they describe.
 *
 * The result is what `scripts/ci/verify-ui-charts-pack.mjs` packs and asserts.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PACKAGE_DIR = path.join(ROOT, 'packages/ui/vmz-ui-charts');
const TYPES_DIR = path.join(PACKAGE_DIR, 'types');
const DIST_DIR = path.join(PACKAGE_DIR, 'dist');

function fail(message) {
    console.error(`build-ui-charts: ${message}`);
    process.exit(1);
}

const result = spawnSync(
    process.execPath,
    [path.join(ROOT, 'packages/runtimes/vmz/bin/vmz.js'), 'lib', PACKAGE_DIR, '--release'],
    { cwd: ROOT, stdio: 'inherit' },
);
if ((result.status ?? 1) !== 0) fail('vmz lib failed');

const contracts = fs.readdirSync(TYPES_DIR).filter((name) => name.endsWith('.d.ts'));
if (contracts.length === 0) fail(`no .d.ts contracts under ${TYPES_DIR}`);
for (const name of contracts) {
    fs.copyFileSync(path.join(TYPES_DIR, name), path.join(DIST_DIR, name));
}

for (const name of ['Chart.js', 'Chart.css', 'Chart.d.ts', 'Diagram.js', 'Diagram.css', 'Diagram.d.ts']) {
    if (!fs.existsSync(path.join(DIST_DIR, name))) fail(`missing dist/${name}`);
}
console.log(`build-ui-charts: dist ready (${contracts.length} contracts)`);
