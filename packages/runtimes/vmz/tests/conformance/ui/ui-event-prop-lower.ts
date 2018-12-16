/**
 * ui-event-prop-lower — component `@click` lowers to `onClick` in Direct client emit.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);

function fail(msg) {
    console.error(`ui-event-prop-lower GATE FAIL: ${msg}`);
    process.exit(1);
}

console.log('ui-event-prop-lower: pipeline_emit component event props…');
const run = spawnSync('cargo', ['test', '-p', 'vmz-compiler', 'maps_component_at_click_to_on_click_wire_prop', '--quiet'], {
    cwd: path.join(root, 'packages', 'compilers', 'vmz-compiler'),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
});
if (run.status !== 0) {
    fail(`cargo test failed\n${run.stdout}\n${run.stderr}`);
}

console.log('ui-event-prop-lower GATE PASS: @click → onClick wire prop');
