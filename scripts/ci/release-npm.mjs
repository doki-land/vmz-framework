/**
 * Official npm release via Trusted Publisher (OIDC). No NPM_TOKEN.
 *
 * - Requires provenance / OIDC-capable npm
 * - Tag vX.Y.Z must match package version X.Y.Z
 * - Does not publish over an existing version (OIDC cannot overwrite)
 * - Uses placeholder trust config where applicable
 *
 * Usage:
 *   node scripts/ci/release-npm.mjs
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Keep in sync with scripts/ci/publish-placeholder.mjs. */
const JS_STUBS = [
    '@vmz/vmz',
    '@vmz/core',
    '@vmz/test',
    '@vmz/protocol',
    '@vmz/ui',
    '@vmz/plugin',
    '@vmz/plugin-katex',
    '@vmz/plugin-mathjax',
    '@vmz/plugin-shiki',
    '@vmz/plugin-markdown-it',
    '@vmz/plugin-monaco',
    '@vmz/plugin-codemirror',
    '@vmz/plugin-mermaid',
    '@vmz/plugin-echarts',
    '@vmz/plugin-iconify',
];

const NATIVE_STUBS = [
    { name: '@vmz/vmz-win32-x64', os: ['win32'], cpu: ['x64'] },
    { name: '@vmz/vmz-win32-arm64', os: ['win32'], cpu: ['arm64'] },
    { name: '@vmz/vmz-darwin-x64', os: ['darwin'], cpu: ['x64'] },
    { name: '@vmz/vmz-darwin-arm64', os: ['darwin'], cpu: ['arm64'] },
    { name: '@vmz/vmz-linux-x64', os: ['linux'], cpu: ['x64'] },
    { name: '@vmz/vmz-linux-arm64', os: ['linux'], cpu: ['arm64'] },
];

/** @type {{ name: string, os?: string[], cpu?: string[], description?: string }[]} */
const STUBS = [
    ...JS_STUBS.map((name) => ({ name })),
    ...NATIVE_STUBS.map((s) => ({
        ...s,
        description: `Optional native binary for @vmz/vmz (${s.name.replace(/^@vmz\/vmz-/, '')}). Placeholder only.`,
    })),
];

function fail(msg) {
    console.error(`ci-release-npm: ${msg}`);
    process.exit(1);
}

function run(cmd, args, opts = {}) {
    const r = spawnSync(cmd, args, {
        cwd: opts.cwd,
        encoding: 'utf8',
        shell: process.platform === 'win32',
        env: opts.env ?? process.env,
    });
    return {
        status: r.status ?? 1,
        stdout: String(r.stdout ?? '').trim(),
        stderr: String(r.stderr ?? '').trim(),
    };
}

function resolveVersion() {
    const fromArg = process.argv.find((a) => a.startsWith('--version='))?.slice('--version='.length);
    if (fromArg) return fromArg.replace(/^v/, '');
    const ref = process.env.GITHUB_REF ?? '';
    // v0.0.2 | placeholder-v0.0.0
    const m = ref.match(/^refs\/tags\/(?:placeholder-)?v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/);
    if (m) return m[1];
    fail('need --version=X.Y.Z or GITHUB_REF=refs/tags/vX.Y.Z (or placeholder-vX.Y.Z)');
}

function viewVersion(name) {
    const r = run('npm', ['view', name, 'version']);
    if (r.status === 0 && r.stdout) return r.stdout;
    return null;
}

function writeStub(spec, dir, version) {
    fs.mkdirSync(dir, { recursive: true });
    const pkg = {
        name: spec.name,
        version,
        description: spec.description ?? 'VMZ placeholder ?not for production use.',
        license: 'MIT',
        private: false,
        files: ['README.md'],
        repository: {
            type: 'git',
            url: 'git+https://github.com/doki-land/vmz-framework.git',
        },
    };
    if (spec.os) pkg.os = spec.os;
    if (spec.cpu) pkg.cpu = spec.cpu;
    fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
    fs.writeFileSync(path.join(dir, 'README.md'), `# ${spec.name}\n\nPlaceholder package (${version}). Reserved for the VMZ project.\n`);
}

function isAlreadyPublished(blob) {
    return /cannot publish over existing version|EPUBLISHCONFLICT|previously published versions/i.test(blob);
}

function isAuthFailure(blob) {
    return /ENEEDAUTH|Unable to authenticate|not authorized|403 Forbidden/i.test(blob);
}

/**
 * @returns {'published'|'exists'|'auth'|'other'}
 */
function attemptPublish(spec, version) {
    const safe = spec.name.replace(/^@/, '').replace(/\//g, '-');
    const dir = path.join(root, safe);
    writeStub(spec, dir, version);
    const args = ['publish'];
    if (spec.name.startsWith('@')) args.push('--access', 'public');
    console.log(`\n=== ${spec.name}@${version}  npm ${args.join(' ')} ===`);
    const r = run('npm', args, { cwd: dir });
    if (r.stdout) process.stdout.write(`${r.stdout}\n`);
    if (r.stderr) process.stderr.write(`${r.stderr}\n`);
    const blob = `${r.stdout}\n${r.stderr}`;
    if (r.status === 0) return 'published';
    if (isAlreadyPublished(blob)) return 'exists';
    if (isAuthFailure(blob)) return 'auth';
    console.error(blob.slice(0, 800));
    return 'other';
}

const version = resolveVersion();
console.log(`ci-release-npm: version=${version}`);
console.log(`  GITHUB_REF=${process.env.GITHUB_REF ?? '(none)'}`);
console.log('  Trusted Publisher contract: release-npm.yml + env NPM_PUBLISH\n');

delete process.env.NODE_AUTH_TOKEN;
delete process.env.NPM_TOKEN;

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-ci-release-'));

let published = 0;
let skipped = 0;
let oidcProved = false;

for (const spec of STUBS) {
    const existing = viewVersion(spec.name);

    if (existing === version) {
        if (!oidcProved) {
            const outcome = attemptPublish(spec, version);
            if (outcome === 'published' || outcome === 'exists') {
                oidcProved = true;
                skipped += 1;
                console.log(`  ?OIDC ok (${outcome === 'exists' ? 'already published conflict' : 'published'})`);
            } else if (outcome === 'auth') {
                fail(
                    `OIDC/auth failed for ${spec.name}. Check Trusted Publisher (file=release-npm.yml, env=NPM_PUBLISH) and GitHub Environment NPM_PUBLISH.`,
                );
            } else {
                fail(`publish failed for ${spec.name}`);
            }
        } else {
            console.log(`  ?${spec.name}@${version}  already on registry ?skip`);
            skipped += 1;
        }
        continue;
    }

    const outcome = attemptPublish(spec, version);
    if (outcome === 'published') {
        published += 1;
        oidcProved = true;
        console.log('  ?published');
    } else if (outcome === 'exists') {
        skipped += 1;
        oidcProved = true;
        console.log('  ?already exists ?OK');
    } else if (outcome === 'auth') {
        fail(`OIDC/auth failed for ${spec.name}. Check Trusted Publisher (file=release-npm.yml, env=NPM_PUBLISH).`);
    } else {
        fail(`publish failed for ${spec.name}`);
    }
}

if (!oidcProved) {
    fail('never proved OIDC (no package publish/conflict succeeded)');
}

console.log(`\nci-release-npm: done (published ${published}, skipped ${skipped}, oidc=ok)`);
