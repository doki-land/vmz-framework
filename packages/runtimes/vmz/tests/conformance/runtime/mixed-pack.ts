/**
 * resume mixed idle+event fine packaging gate.
 * Idle islands stay static imports; EventEntry islands load via __vmzLoadComponent.
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { repoRoot } from '../_lib/repo-root.ts';
import { serveHostProjectEnv, resolveDeliveryDist } from '../_lib/serve-host-env.ts';

const root = repoRoot(import.meta.url);
const example = path.join(root, 'packages', 'examples', 'island');
const vmzBin = path.join(root, 'packages', 'runtimes', 'vmz', 'bin', 'vmz.js');

function fail(msg) {
    console.error(`resume-MIXED-PACK GATE FAIL: ${msg}`);
    process.exit(1);
}

console.log('resume-mixed-pack: build island…');
const build = spawnSync(process.execPath, [vmzBin, 'build', example], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
});
if (build.status !== 0) fail(`build failed\n${build.stdout}\n${build.stderr}`);

const dist = (() => {
    try {
        return resolveDeliveryDist(example);
    } catch (e) {
        fail(e instanceof Error ? e.message : String(e));
    }
})();
const hostJs = path.join(dist, 'vmz-serve-host.mjs');

const port = 18767;
const child = spawn(process.execPath, [hostJs], {
    cwd: dist,
    env: serveHostProjectEnv(example, {
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

    if (body.includes('entry-event.js') && !body.includes('entry-client.js')) {
        fail('mixed page must use entry-client.js, not event-only shell');
    }
    if (!body.includes('entry-client.js')) {
        fail('mixed page HTML must reference entry-client.js');
    }

    const entryClient = fs.readFileSync(path.join(dist, 'entry-client.js'), 'utf8');
    if (/EventButton\.client\.js/.test(entryClient) && /import\s+EventButton\s+from/.test(entryClient)) {
        fail('entry-client.js must not statically import EventButton.client.js');
    }
    if (!/import\s+LikeButton\s+from/.test(entryClient)) {
        fail('entry-client.js must statically import LikeButton (idle)');
    }
    if (!entryClient.includes('__vmzLoadComponent')) {
        fail('entry-client.js must set __vmzLoadComponent for event islands');
    }
    if (!/\bhydrate(?:Route|RoutePage)?\b/.test(entryClient)) {
        fail('entry-client.js must hydrate for idle/mixed shell');
    }

    console.log('resume-MIXED-PACK GATE PASS');
    console.log(' idle static + event lazy (__vmzLoadComponent)');
} finally {
    killChild();
}
