/**
 * Write barrier emission: rewritten expressions must stay parsable JavaScript.
 *
 * A concise arrow body such as `xhr.onabort = () => resolve({ aborted: true })`
 * is a statement whose Oak span includes the trailing `;`. Copying that slice
 * into the barrier call emitted `__vmzWritePath(this, "_xhr", ["onabort"], () =>
 * resolve({...});)` — a `;` inside the argument list and a missing `)`.
 *
 * The fixture also keeps a module-level `function xhrSend(xhr)` next to a class
 * method that aliases `xhr = this._xhr`. A function-scoped alias leak rewrote
 * the module function through `this.constructor`, which throws at runtime.
 *
 * Usage: pnpm --filter vmz run verify -- write-barrier-emit-syntax
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { repoRoot, vmzBin } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const example = path.join(root, 'packages', 'examples', 'fullstack');

function fail(msg) {
    console.error(`-WB-EMIT GATE FAIL: ${msg}`);
    process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-wb-emit-'));
const dist = path.join(tmp, 'dist');

console.log('-WB-EMIT gate: building fullstack…');
const build = spawnSync(process.execPath, [vmzBin(root), 'build', example, '--out-dir', dist], {
    cwd: root,
    stdio: 'inherit',
});
if (build.status !== 0) fail(`build exited ${build.status}`);

const profileDir = path.join(dist, 'web-ssr');
const clientPath = path.join(profileDir, 'components', 'WriteBarrierEmit.client.js');
if (!fs.existsSync(clientPath)) fail('WriteBarrierEmit.client.js missing');

/** Parse the emitted file as a real JavaScript module, not as a string match. */
function assertParses(file, label) {
    const probe = path.join(tmp, `${label}.mjs`);
    fs.copyFileSync(file, probe);
    const parsed = spawnSync(process.execPath, ['--check', probe], { encoding: 'utf8' });
    if (parsed.status !== 0) fail(`${label} is not valid JavaScript:\n${parsed.stderr}`);
}

assertParses(clientPath, 'client');
for (const sub of ['_vmz/pack', '_vmz/pack-node']) {
    const dir = path.join(profileDir, sub);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
        if (!name.includes('WriteBarrierEmit') || !name.endsWith('.js')) continue;
        assertParses(path.join(dir, name), `${sub.replaceAll('/', '-')}-${name}`);
    }
}

const clientJs = fs.readFileSync(clientPath, 'utf8');

const arrowCall = 'this.constructor.__vmzWritePath(this, "_xhr", ["onabort"], () =>';
if (!clientJs.includes(arrowCall)) {
    fail(`concise arrow RHS must stay on the barrier call:\n${clientJs}`);
}
if (!clientJs.includes('}));')) {
    fail(`concise arrow RHS must keep its own call parentheses:\n${clientJs}`);
}
const objectCall = 'this.constructor.__vmzWritePath(this, "state", ["handler"], { tag: "abort", status: 0 })';
if (!clientJs.includes(objectCall)) {
    fail(`object literal RHS must stay on the barrier call:\n${clientJs}`);
}
const conditionalCall = 'this.constructor.__vmzWritePath(this, "state", ["mode"], this.state.mode === "idle" ? "on" : "off")';
if (!clientJs.includes(conditionalCall)) {
    fail(`conditional RHS must stay on the barrier call:\n${clientJs}`);
}

const classWrites = clientJs.match(/__vmzWritePath\(this, "_xhr"/g) ?? [];
if (classWrites.length !== 1) {
    fail(`module-level xhrSend(xhr) must not rewrite through the barrier, got ${classWrites.length} _xhr writes`);
}
if (!clientJs.includes('xhr.onabort = () =>')) {
    fail(`module-level xhrSend body must keep its plain assignment:\n${clientJs}`);
}

console.log('-WB-EMIT GATE PASS: barrier emission parses and scopes aliases per function');
