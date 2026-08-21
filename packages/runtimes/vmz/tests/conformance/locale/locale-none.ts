/**
 * v0.1.8: routing.strategy `none` Host preference negotiate + boot + prefix regression.
 *
 * - cookie `vmz.locale=zh-hans` → SSR `data-locale="zh-hans"` (before body)
 * - head includes locale boot (localStorage → attr/hint/cookie)
 * - prefix fixture: URL locale still wins over stale cookie
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { repoRoot } from '../_lib/repo-root.ts';
import { serveHostChildEnv } from '../_lib/serve-host-env.ts';

const root = repoRoot(import.meta.url);
const noneExample = path.join(root, 'packages', 'examples', 'locales-none-fixture');
const prefixExample = path.join(root, 'packages', 'examples', 'locales-fixture');
const vmzBin = path.join(root, 'packages', 'runtimes', 'vmz', 'bin', 'vmz.js');

function fail(msg) {
    console.error(`LOCALE-NONE GATE FAIL: ${msg}`);
    process.exit(1);
}

function runVmz(args, cwd = root) {
    return spawnSync(process.execPath, [vmzBin, ...args], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}

function fetchText(port, pathname, opts = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request(
            {
                hostname: '127.0.0.1',
                port,
                path: pathname,
                method: 'GET',
                headers: opts.cookie ? { Cookie: opts.cookie } : {},
            },
            (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    resolve({
                        status: res.statusCode || 0,
                        body: Buffer.concat(chunks).toString('utf8'),
                    });
                });
            },
        );
        req.on('error', reject);
        req.end();
    });
}

async function withServe(dist, port, fn) {
    const hostJs = path.join(dist, 'vmz-serve-host.mjs');
    if (!fs.existsSync(hostJs)) fail(`missing ${hostJs}`);
    const child = spawn(process.execPath, [hostJs], {
        cwd: dist,
        env: serveHostChildEnv({
            VMZ_DIST: dist,
            VMZ_HOST: '127.0.0.1',
            VMZ_PORT: String(port),
        }),
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const killChild = () => {
        try {
            child.kill('SIGTERM');
        } catch {
            /* ignore */
        }
    };
    try {
        await new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error(`serve-host start timeout port=${port}`)), 12000);
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
        await fn();
    } finally {
        killChild();
    }
}

console.log('locale-none: build none fixture…');
const builtNone = runVmz(['build', noneExample]);
if (builtNone.status !== 0) fail(`build none failed\n${builtNone.stdout}\n${builtNone.stderr}`);

const noneDist = path.join(noneExample, 'dist');
const commonPath = path.join(noneDist, 'locales', 'common.js');
if (!fs.existsSync(commonPath)) fail(`missing ${commonPath} after vmz build`);
const commonJs = fs.readFileSync(commonPath, 'utf8');
if (!commonJs.includes('__vmzLocaleId') || !commonJs.includes('vmz.locale')) {
    fail('generated locale runtime missing __vmzLocaleId / vmz.locale');
}
if (!commonJs.includes('none') || !commonJs.includes('localStorage')) {
    fail('generated locale runtime missing none/localStorage preference branch');
}
const storeIdx = commonJs.indexOf('vmz.locale');
const dataIdx = commonJs.indexOf('data-locale');
if (storeIdx < 0 || dataIdx < 0 || !(storeIdx < dataIdx)) {
    fail('__vmzLocaleId must prefer vmz.locale before data-locale for none (emit order)');
}

console.log('locale-none: serve none fixture…');
await withServe(noneDist, 18781, async () => {
    const bare = await fetchText(18781, '/');
    if (bare.status !== 200) fail(`GET / status=${bare.status}`);
    if (!/<html[^>]*\sdata-locale="en-us"/.test(bare.body) && !/<html[^>]*\slang="en-us"/.test(bare.body)) {
        fail(`default SSR must be en-us: ${bare.body.slice(0, 400)}`);
    }
    if (!bare.body.includes('vmz.locale') || !bare.body.includes('localStorage')) {
        fail('head must include locale boot for strategy none');
    }

    const pref = await fetchText(18781, '/', { cookie: 'vmz.locale=zh-hans' });
    if (pref.status !== 200) fail(`cookie GET status=${pref.status}`);
    if (!/<html[^>]*\sdata-locale="zh-hans"/.test(pref.body) && !/<html[^>]*\slang="zh-hans"/.test(pref.body)) {
        fail(`cookie preference must negotiate SSR locale zh-hans: ${pref.body.slice(0, 500)}`);
    }
    if (/data-locale="en-us"/.test(pref.body) && !/data-locale="zh-hans"/.test(pref.body)) {
        fail('SSR still en-us despite preference cookie');
    }
});

console.log('locale-none: prefix regression (URL beats stale cookie)…');
const builtPrefix = runVmz(['build', prefixExample]);
if (builtPrefix.status !== 0) fail(`build prefix failed\n${builtPrefix.stdout}\n${builtPrefix.stderr}`);

const prefixDist = path.join(prefixExample, 'dist');
await withServe(prefixDist, 18782, async () => {
    const en = await fetchText(18782, '/en-us/', { cookie: 'vmz.locale=zh-hans' });
    if (en.status !== 200) fail(`prefix GET status=${en.status}`);
    if (!/<html[^>]*\s(data-locale|lang)="en-us"/.test(en.body)) {
        fail(`prefix URL must win over stale vmz.locale cookie: ${en.body.slice(0, 500)}`);
    }
    if (/data-locale="zh-hans"/.test(en.body)) {
        fail('prefix must not apply Host preference cookie over URL locale');
    }
});

console.log('LOCALE-NONE GATE PASS');
