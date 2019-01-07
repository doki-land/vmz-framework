/**
 * component-event-wire — component `@event` subscribes via onComponentEvent,
 * never lowers to onXxx prop. Orthogonal to `:on-submit` prop wire.
 * Bare class methods resolve to `this.method` at compile time when scope confirms.
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
    const run = spawnSync('cargo', ['test', '-p', 'vmz-compiler', '--test', 'pipeline_emit_unit', filter, '--quiet'], {
        cwd: root,
        encoding: 'utf8',
        shell: true,
    });
    if (run.status !== 0) {
        console.error(run.stdout || '');
        console.error(run.stderr || '');
        fail(`cargo test ${filter}`);
    }
}

console.log('component-event-wire: pipeline_emit component event subscribe + orthogonal prop…');
cargoFilter('maps_component');
console.log('component-event-wire: bare class method resolves to this.method…');
cargoFilter('resolves_bare_class_method');
console.log('component-event-wire: unresolved bare handler fails at compile time…');
cargoFilter('rejects_unresolved_bare_handler');
console.log('component-event-wire: explicit this.method prop wrap…');
cargoFilter('wraps_explicit_this_method');

console.log('component-event-wire GATE PASS: @submit → onComponentEvent, bare method resolves, :on-submit stays prop');
