/**
 * dev-output-write-suppression — generation write-set paths filtered from author dirty.
 * verify id: dev-output-write-suppression
 */

import { filterGenerationIgnore, registerWrittenOutputsIgnore } from '../../../dist/dev-incremental.js';

function fail(msg: string) {
    console.error(`dev-output-write-suppression FAIL: ${msg}`);
    process.exit(1);
}

const ignore = new Set<string>();
registerWrittenOutputsIgnore(['pages/index.client.js', 'vmz-deployment.json'], '/dist', '/proj', ignore);
const changed = ['/dist/pages/index.client.js', '/proj/src/pages/index.vmz'];
const filtered = filterGenerationIgnore(changed, ignore);
if (filtered.length !== 1 || !filtered[0].includes('index.vmz')) {
    fail(`expected only author vmz path, got ${JSON.stringify(filtered)}`);
}

console.log('dev-output-write-suppression PASS');
process.exit(0);
