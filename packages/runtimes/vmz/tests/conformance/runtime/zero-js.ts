/**
 * resume EventEntry zero-framework JS shell gate.
 * Initial HTML must not eagerly import vmz-dom / hydrate; framework loads on event.
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const example = path.join(root, 'packages', 'examples', 'event-shell');
const vmzBin = path.join(root, 'packages', 'runtimes', 'vmz', 'bin', 'vmz.js');

function fail(msg) {
    console.error(`resume-ZEROJS GATE FAIL: ${msg}`);
    process.exit(1);
}

console.log('resume-zerojs: build event-shell…');
const build = spawnSync(process.execPath, [vmzBin, 'build', example], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
});
if (build.status !== 0) fail(`build failed\n${build.stdout}\n${build.stderr}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-zjs-'));
const reportPath = path.join(tmp, 'report.json');
console.log('resume-zerojs: compile manifest…');
const test = spawnSync(process.execPath, [vmzBin, 'test', example, '--mode', 'compile', '--filter', 'l5\\.zerojs', '--json', reportPath], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
});
if (test.status !== 0) fail(`vmz test exited ${test.status}\n${test.stdout}\n${test.stderr}`);
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
if (report.status !== 'passed') {
    fail(`report ${report.status}: ${JSON.stringify(report.tests, null, 2)}`);
}

const dist = path.join(example, 'dist');
const hostJs = path.join(dist, 'vmz-serve-host.mjs');
if (!fs.existsSync(hostJs)) fail(`missing ${hostJs}`);

const port = 18766;
const child = spawn(process.execPath, [hostJs], {
    cwd: dist,
    env: { ...process.env, VMZ_DIST: dist, VMZ_HOST: '127.0.0.1', VMZ_PORT: String(port) },
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
            if (String(buf).includes('vmz serve http://')) {
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

    const body = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${port}/`, (res) => {
            const parts = [];
            res.on('data', (c) => parts.push(c));
            res.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
        }).on('error', reject);
    });

    if (!body.includes('data-vmz-entry="event"') && !body.includes('data-vmz-client="event"')) {
        fail(`HTML missing EventEntry markers: ${body.slice(0, 300)}`);
    }
    if (body.includes('entry-client.js')) {
        fail('event-only shell must not reference entry-client.js');
    }
    if (!body.includes('entry-event.js')) {
        fail('event-only shell must reference entry-event.js');
    }

    const entryEvent = fs.readFileSync(path.join(dist, 'entry-event.js'), 'utf8');
    if (/from\s+['"].*vmz-dom/.test(entryEvent) || entryEvent.includes('hydrate(')) {
        fail('entry-event.js must not statically import vmz-dom or call hydrate');
    }
    if (!entryEvent.includes('import(') || !entryEvent.includes('resume')) {
        fail('entry-event.js must dynamic-import and resume on event');
    }

    const entryClient = fs.readFileSync(path.join(dist, 'entry-client.js'), 'utf8');
    if (!entryClient.includes('hydrate(')) {
        fail('entry-client.js should still exist for mixed/idle pages');
    }

    console.log('resume-ZEROJS GATE PASS');
    console.log(' HTML → entry-event.js only; vmz-dom deferred until EventEntry');
} finally {
    killChild();
}
