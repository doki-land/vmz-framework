/**
 * component-event-wire — component `@event` subscribes via onComponentEvent,
 * never lowers to onXxx prop. Orthogonal to `:on-submit` prop wire.
 * Bare idents are not silently guessed as `this.method`.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../../../..');

function fail(msg: string): never {
    console.error(`component-event-wire GATE FAIL: ${msg}`);
    process.exit(1);
}

function cargoFilter(filter: string) {
    const run = spawnSync(
        'cargo',
        ['test', '-p', 'vmz-compiler', '--test', 'pipeline_emit_unit', filter, '--quiet'],
        { cwd: root, encoding: 'utf8', shell: true },
    );
    if (run.status !== 0) {
        console.error(run.stdout || '');
        console.error(run.stderr || '');
        fail(`cargo test ${filter}`);
    }
}

console.log('component-event-wire: pipeline_emit component event subscribe + orthogonal prop…');
cargoFilter('maps_component');
console.log('component-event-wire: bare ident must not become this.method…');
cargoFilter('does_not_guess_bare_ident');
console.log('component-event-wire: explicit this.method prop wrap…');
cargoFilter('wraps_explicit_this_method');

console.log('component-event-wire GATE PASS: @click → onComponentEvent, :on-submit stays prop, no bare guess');
