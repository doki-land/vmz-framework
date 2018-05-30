/**
 * Style Theme gate — designs/theme + diagnostics + explain style.
 *
 * Asserts:
 * - StyleEmitter entry / layers / prefers-color-scheme / TW var projection
 * - deployment styleTheme + styleBundleHash + incremental CSS skip
 * - unknown design token (var + style:tw)
 * - unused design token warning
 * - unreferenced global style warning
 * - explain style causal chain (utility → token → CSS)
 * - serve-host theme activation
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const example = path.join(root, 'packages', 'examples', 'vmz-style-tailwind');
const dist = path.join(example, 'dist');
const cargo = process.env.CARGO || 'cargo';
const DIAG_UNKNOWN = 'vmz::style::unknown_design_token';
const DIAG_UNUSED = 'vmz::style::unused_design_token';
const DIAG_UNREF = 'vmz::style::unreferenced_global_style';

function fail(msg) {
    console.error(`STYLE-THEME GATE FAIL: ${msg}`);
    process.exit(1);
}

function runBuild(projectDir) {
    const r = spawnSync(cargo, ['run', '-p', 'vmz-tools', '--quiet', '--', 'build', projectDir], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: r.status ?? 1, out: `${r.stdout || ''}\n${r.stderr || ''}` };
}

function read(rel) {
    const p = path.join(dist, rel);
    if (!fs.existsSync(p)) fail(`missing ${rel}`);
    return fs.readFileSync(p, 'utf8');
}

function copyProject(src, dest) {
    const skip = new Set(['node_modules', 'dist', '.git']);
    fs.mkdirSync(dest, { recursive: true });
    for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
        if (skip.has(ent.name)) continue;
        const from = path.join(src, ent.name);
        const to = path.join(dest, ent.name);
        if (ent.isDirectory()) copyProject(from, to);
        else fs.copyFileSync(from, to);
    }
}

function fetchText(urlPath, opts = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request(
            {
                hostname: '127.0.0.1',
                port,
                path: urlPath,
                method: 'GET',
                headers: opts.cookie ? { cookie: opts.cookie } : {},
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
        req.setTimeout(8000, () => req.destroy(new Error('request timeout')));
        req.end();
    });
}

console.log('style-theme: unit…');
{
    const t = spawnSync(cargo, ['test', '-p', 'vmz-compiler', '--quiet', 'style_', '--', '--nocapture'], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (t.status !== 0) fail(`style_ tests failed\n${t.stdout}\n${t.stderr}`);
}

console.log('style-theme: build…');
{
    const r = runBuild(example);
    if (r.status !== 0) fail(`vmz build failed\n${r.out}`);
    if (r.out.includes(DIAG_UNUSED) || r.out.includes(DIAG_UNREF)) {
        fail(`happy path must not warn unused/unref:\n${r.out}`);
    }
}

const entry = read('vmz.css');
if (!entry.includes('@import "./vmz-designs.css"')) fail('vmz.css missing designs import');
if (!entry.includes('@import "./vmz-style.css"')) fail('vmz.css missing style import');
if (!entry.includes('@import "./vmz-tw.css"')) fail('vmz.css missing tw import');

const designsCss = read('vmz-designs.css');
if (!designsCss.includes('@media (prefers-color-scheme: dark)')) fail('missing prefers media');
if (!designsCss.includes('[data-theme="default"]')) fail('missing default activation');

const tw = read('vmz-tw.css');
if (!tw.includes('var(--vmz-colors-action)')) fail('tw must project Style Theme vars');

const dep = JSON.parse(read('vmz-deployment.json'));
if (!dep.styleTheme?.prefersColorScheme?.dark) fail('prefersColorScheme');
if (!dep.styleBundleHash) fail('styleBundleHash');

const hash1 = dep.styleBundleHash;
const mtime1 = fs.statSync(path.join(dist, 'vmz-designs.css')).mtimeMs;
console.log('style-theme: rebuild (expect CSS skip)…');
{
    const r = runBuild(example);
    if (r.status !== 0) fail(`rebuild failed\n${r.out}`);
}
if (JSON.parse(read('vmz-deployment.json')).styleBundleHash !== hash1) {
    fail('styleBundleHash changed on no-op rebuild');
}
if (fs.statSync(path.join(dist, 'vmz-designs.css')).mtimeMs !== mtime1) {
    fail('vmz-designs.css rewritten despite unchanged fingerprint');
}

console.log('style-theme: unknown var fixture…');
{
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-style-var-'));
    copyProject(example, tmp);
    fs.appendFileSync(path.join(tmp, 'designs', 'styles', 'index.scss'), '\n.broken { color: var(--vmz-colors-nope); }\n', 'utf8');
    const bad = runBuild(tmp);
    if (bad.status === 0) fail('expected fail on unknown CSS var');
    if (!bad.out.includes(DIAG_UNKNOWN) || !bad.out.includes('--vmz-colors-nope')) {
        fail(`want ${DIAG_UNKNOWN}:\n${bad.out}`);
    }
    fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('style-theme: unknown style:tw fixture…');
{
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-style-tw-'));
    copyProject(example, tmp);
    const page = path.join(tmp, 'src', 'pages', 'index.vmz');
    let src = fs.readFileSync(page, 'utf8');
    if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);
    src = src.replace('style:tw="px-4 py-2 rounded bg-action"', 'style:tw="px-4 py-2 rounded bg-action bg-nope"', 1);
    fs.writeFileSync(page, src, 'utf8');
    const bad = runBuild(tmp);
    if (bad.status === 0) fail('expected fail on unknown style:tw');
    if (!bad.out.includes(DIAG_UNKNOWN) || !bad.out.includes('bg-nope')) {
        fail(`want ${DIAG_UNKNOWN} bg-nope:\n${bad.out}`);
    }
    fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('style-theme: unused token fixture…');
{
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-style-unused-'));
    copyProject(example, tmp);
    const tokensPath = path.join(tmp, 'designs', 'tokens', 'colors-spacing.json');
    const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
    tokens.colors.orphan = '#112233';
    fs.writeFileSync(tokensPath, `${JSON.stringify(tokens, null, 2)}\n`, 'utf8');
    const warn = runBuild(tmp);
    if (warn.status !== 0) fail(`unused should warn only:\n${warn.out}`);
    if (!warn.out.includes(DIAG_UNUSED) || !warn.out.includes('colors.orphan')) {
        fail(`want ${DIAG_UNUSED}:\n${warn.out}`);
    }
    fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('style-theme: unreferenced global style fixture…');
{
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-style-unref-'));
    copyProject(example, tmp);
    fs.writeFileSync(path.join(tmp, 'designs', 'styles', 'orphan.scss'), '.orphan { color: #f00; }\n', 'utf8');
    const warn = runBuild(tmp);
    if (warn.status !== 0) fail(`unref should warn only:\n${warn.out}`);
    if (!warn.out.includes(DIAG_UNREF) || !warn.out.includes('orphan')) {
        fail(`want ${DIAG_UNREF}:\n${warn.out}`);
    }
    fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('style-theme: explain style chain…');
{
    // Use a one-shot Rust bin via cargo test filter already covered; also probe Workspace via tools.
    const probe = `
use vmz_compiler::{Workspace, WorkspaceOptions};
fn main() {
    let root = std::env::args().nth(1).expect("root");
    let out = std::path::PathBuf::from(&root).join("dist");
    let ws = Workspace::create(WorkspaceOptions { root: root.into(), out_dir: out, tw: None, scss: None });
    let raw = ws.explain("style:bg-action");
    let v: serde_json::Value = serde_json::from_str(&raw).expect("json");
    assert_eq!(v["kind"], "style");
    let chain = v["chain"].as_array().expect("chain");
    assert!(chain.len() >= 2, "{raw}");
    let joined = chain.iter().map(|e| e["reason"].as_str().unwrap_or("")).collect::<Vec<_>>().join("|");
    assert!(joined.contains("Style Theme") || joined.contains("style:tw") || joined.contains("utility"), "{raw}");
    println!("EXPLAIN_STYLE_OK");
}
`;
    // Prefer unit tests already run; additionally call explain via existing workspace in a tiny inline is heavy.
    // Re-run focused explain tests:
    const t = spawnSync(cargo, ['test', '-p', 'vmz-compiler', '--quiet', 'explain_document_kind_style', '--', '--nocapture'], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (t.status !== 0) fail(`explain_document_kind_style failed\n${t.stdout}\n${t.stderr}`);
    void probe;
}

const hostJs = path.join(dist, 'vmz-serve-host.mjs');
if (!fs.existsSync(hostJs)) fail('missing vmz-serve-host.mjs');

const port = 18771;
console.log('style-theme: serve-host…');
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

    const bare = await fetchText('/');
    if (bare.status !== 200) fail(`GET / status=${bare.status}`);
    if (!bare.body.includes('/vmz.css')) fail('HTML missing css link');
    if (/<html[^>]*data-theme=/.test(bare.body)) fail('bare HTML must not set data-theme');

    const qDark = await fetchText('/?theme=dark');
    if (!/<html[^>]*\sdata-theme="dark"/.test(qDark.body)) fail('?theme=dark');

    const cDefault = await fetchText('/', { cookie: 'vmz-theme=default' });
    if (!/<html[^>]*\sdata-theme="default"/.test(cDefault.body)) fail('cookie default');
} catch (err) {
    killChild();
    fail(String(err && err.message ? err.message : err));
}

killChild();
console.log('STYLE-THEME GATE OK');
