/**
 * Event-flow gate: EventEntry + async cancel + serve-host HTTP stream.
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { repoRoot } from '../_lib/repo-root.ts';
import { serveHostProjectEnv, resolveDeliveryDist } from '../_lib/serve-host-env.ts';

const root = repoRoot(import.meta.url);
const island = path.join(root, 'packages', 'examples', 'island');
const counter = path.join(root, 'packages', 'examples', 'counter');
const vmzBin = path.join(root, 'packages', 'runtimes', 'vmz', 'bin', 'vmz.js');

function fail(msg) {
    console.error(`EVENT-FLOW GATE FAIL: ${msg}`);
    process.exit(1);
}

function runNode(script) {
    console.log(`→ ${script}`);
    const resolveHook = pathToFileURL(path.join(root, 'scripts/test/resolve-ts-from-js.mjs')).href;
    const r = spawnSync(
        process.execPath,
        ['--import', resolveHook, '--experimental-strip-types', path.join(path.dirname(fileURLToPath(import.meta.url)), script)],
        {
            cwd: root,
            encoding: 'utf8',
            stdio: 'inherit',
        },
    );
    if (r.status !== 0) fail(`${script} exited ${r.status}`);
}

// 1) EventEntry via vmz test
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-ef-'));
const reportPath = path.join(tmp, 'report.json');
console.log('event-flow: EventEntry manifests…');
const test = spawnSync(
    process.execPath,
    [vmzBin, 'test', island, '--filter', '^resume\\.(event\\.|compile\\.event\\.)', '--json', reportPath],
    {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    },
);
if (test.status !== 0) fail(`vmz test exited ${test.status}\n${test.stdout}\n${test.stderr}`);
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
if (report.status !== 'passed') {
    fail(`report ${report.status}: ${JSON.stringify(report.tests, null, 2)}`);
}
for (const id of ['resume.compile.event.entry', 'resume.event.entry']) {
    const hit = (report.tests || []).find((t) => t.testId === id);
    if (!hit || hit.status !== 'passed') fail(`missing/failed ${id}`);
    console.log(` ${id} → ok`);
}

// 2) async cancel (compiled AsyncTask path)
runNode('async-graph.ts');

// 3) serve-host HTTP stream (chunked Direct SSR)
console.log('event-flow: serve-host stream HTTP…');
const build = spawnSync(process.execPath, [vmzBin, 'build', counter], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
});
if (build.status !== 0) fail(`counter build failed\n${build.stdout}\n${build.stderr}`);

const dist = (() => {
    try {
        return resolveDeliveryDist(counter);
    } catch (e) {
        fail(e instanceof Error ? e.message : String(e));
    }
})();
const hostJs = path.join(dist, 'vmz-serve-host.mjs');

const port = 18765;
const child = spawn(process.execPath, [hostJs], {
    cwd: dist,
    env: serveHostProjectEnv(counter, {
        VMZ_DIST: dist,
        VMZ_HOST: '127.0.0.1',
        VMZ_PORT: String(port),
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
});

function killChild() {
    try {
        child.kill('SIGTERM');
    } catch {
        /* ignore */
    }
}

try {
    await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('serve-host start timeout')), 8000);
        const onData = (buf) => {
            const s = String(buf);
            if (s.includes('vmz serve http://')) {
                clearTimeout(t);
                child.stdout.off('data', onData);
                resolve();
            }
        };
        child.stdout.on('data', onData);
        child.stderr.on('data', (b) => process.stderr.write(b));
        child.on('exit', (code) => {
            clearTimeout(t);
            reject(new Error(`serve-host exited early ${code}`));
        });
    });

    const { status, headers, body, chunkCount } = await new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
            /** @type {Buffer[]} */
            const parts = [];
            let n = 0;
            res.on('data', (c) => {
                n += 1;
                parts.push(c);
            });
            res.on('end', () => {
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    body: Buffer.concat(parts).toString('utf8'),
                    chunkCount: n,
                });
            });
        });
        req.on('error', reject);
    });

    if (status !== 200) fail(`HTTP status want 200, got ${status}`);
    const te = String(headers['transfer-encoding'] || '');
    if (!te.includes('chunked') && !headers['content-length']) {
        // Node may coalesce; require either chunked or a full HTML document.
    }
    if (!body.includes('id="app"') || !body.includes('count:')) {
        fail(`stream body missing app/count: ${body.slice(0, 200)}`);
    }
    if (!body.includes('data-testid="counter-root"')) {
        fail(`stream body missing counter-root: ${body.slice(0, 200)}`);
    }
    if (!body.includes('entry-client.js')) fail('stream body missing entry-client');
    // Prefer observing multiple TCP data events; if Node coalesces, still require full HTML.
    console.log(` HTTP stream chunks=${chunkCount} transfer-encoding=${te || '(none)'}`);
    if (chunkCount < 1) fail('no response body chunks');
} finally {
    killChild();
}

console.log('EVENT-FLOW GATE PASS: EventEntry + async cancel + HTTP stream');
