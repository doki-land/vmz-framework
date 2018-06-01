/**
 * GitHub Actions：发布 monorepo 真包（非占坑 stub）。
 *
 * - tag vX.Y.Z → version X.Y.Z
 * - 幂等：目标版本已在 registry 则 skip（成功），支持中断后重试；禁止因「已发布」失败
 * - 不使用 NPM_TOKEN；OIDC Trusted Publisher（permissions.id-token: write）
 * - 工作流合同：file=publish-npm.yml env=NPM_PUBLISH repo=doki-land/vmz-framework
 *   （npm Trusted Publisher 每包只能配一个；本仓唯一可信文件即 publish-npm.yml）
 *
 * 前置：JS 已 build；native 产物在 dist/<short>/ 下（见 publish-npm.yml → VMZ_NATIVE_ARTIFACTS）。
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** short platform id used on npm (@vmz/vmz-win32-x64) ↔ cargo triple */
const NATIVE_PLATFORMS = [
    { short: 'win32-x64', triple: 'win32-x64-msvc', os: ['win32'], cpu: ['x64'] },
    { short: 'win32-arm64', triple: 'win32-arm64-msvc', os: ['win32'], cpu: ['arm64'] },
    { short: 'darwin-x64', triple: 'darwin-x64', os: ['darwin'], cpu: ['x64'] },
    { short: 'darwin-arm64', triple: 'darwin-arm64', os: ['darwin'], cpu: ['arm64'] },
    { short: 'linux-x64', triple: 'linux-x64-gnu', os: ['linux'], cpu: ['x64'] },
    { short: 'linux-arm64', triple: 'linux-arm64-gnu', os: ['linux'], cpu: ['arm64'] },
];

/**
 * Publish order: leaves first. `publishName` overrides package.json name when set
 * (CLI package is `@vmz/vmz`; native optional packages are `@vmz/vmz-<platform>`).
 * @type {{ dir: string, publishName?: string }[]}
 */
const JS_PACKAGES = [
    { dir: 'packages/runtimes/vmz-protocol' },
    { dir: 'packages/runtimes/vmz-runtime' },
    { dir: 'packages/runtimes/vmz-test' },
    { dir: 'packages/plugins/vmz-plugin' },
    { dir: 'packages/plugins/vmz-plugin-katex' },
    { dir: 'packages/plugins/vmz-plugin-mathjax' },
    { dir: 'packages/plugins/vmz-plugin-shiki' },
    { dir: 'packages/plugins/vmz-plugin-markdown-it' },
    { dir: 'packages/plugins/vmz-plugin-monaco' },
    { dir: 'packages/plugins/vmz-plugin-codemirror' },
    { dir: 'packages/plugins/vmz-plugin-mermaid' },
    { dir: 'packages/plugins/vmz-plugin-echarts' },
    { dir: 'packages/plugins/vmz-plugin-iconify' },
    { dir: 'packages/ui/vmz-ui' },
    { dir: 'packages/runtimes/vmz', publishName: '@vmz/vmz' },
];

function fail(msg) {
    console.error(`ci-publish-npm: ${msg}`);
    process.exit(1);
}

function run(cmd, args, opts = {}) {
    const r = spawnSync(cmd, args, {
        cwd: opts.cwd ?? ROOT,
        encoding: 'utf8',
        shell: process.platform === 'win32',
        env: opts.env ?? process.env,
        stdio: opts.stdio ?? 'pipe',
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
    const m = ref.match(/^refs\/tags\/(?:placeholder-)?v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/);
    if (m) return m[1];
    fail('need --version=X.Y.Z or GITHUB_REF=refs/tags/vX.Y.Z');
}

function readJson(p) {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJson(p, obj) {
    fs.writeFileSync(p, `${JSON.stringify(obj, null, 2)}\n`);
}

function copyTree(src, dest, filter) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
        if (name === 'node_modules' || name === '.git') continue;
        const from = path.join(src, name);
        const to = path.join(dest, name);
        const st = fs.statSync(from);
        if (st.isDirectory()) {
            if (filter && !filter(from, true)) continue;
            copyTree(from, to, filter);
        } else {
            if (filter && !filter(from, false)) continue;
            fs.copyFileSync(from, to);
        }
    }
}

/**
 * @param {Record<string, string>} deps
 * @param {string} version
 */
function rewriteWorkspaceDeps(deps, version) {
    if (!deps) return deps;
    /** @type {Record<string, string>} */
    const out = {};
    for (const [k, v] of Object.entries(deps)) {
        if (typeof v === 'string' && (v.startsWith('workspace:') || v === '*')) {
            let key = k;
            if (k === 'vmz' || k === '@vmz/vmz') key = '@vmz/vmz';
            else if (k.startsWith('@vmz/vmz-')) key = `@vmz/vmz-${k.slice('@vmz/vmz-'.length)}`;
            out[key] = version;
        } else {
            out[k] = v;
        }
    }
    return out;
}

function rewriteDepsField(pkg, version) {
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
        if (pkg[field]) pkg[field] = rewriteWorkspaceDeps(pkg[field], version);
    }
    // published packages must not carry workspace-only optional local paths
    return pkg;
}

function isAlreadyPublished(blob) {
    // npm 对「同版本已存在」常回 403，文案多变；宁可宽匹配，再用 versionExists 兜底。
    return /cannot publish over existing|EPUBLISHCONFLICT|previously published versions|version already exists|cannot publish.*same version|you cannot publish over/i.test(
        blob,
    );
}

function isAuthFailure(blob) {
    // 勿把「403 + already published」当 auth；先走 isAlreadyPublished / versionExists。
    // npm Trusted Publisher 未握手时常伪装成 E404 PUT（包其实已存在）。
    return /ENEEDAUTH|Unable to authenticate|not authorized|OIDC|trusted publisher|two-factor|need to be logged|login|identity token|do not have permission to access it|Access token expired or revoked/i.test(
        blob,
    );
}

function isMissingPackage(blob) {
    // 真缺包；勿把「404 + permission」OIDC 失败算进这里。
    if (isAuthFailure(blob)) return false;
    return /Package not found|does not exist on the registry|cannot publish.*before creating|This package has not been created|is not in this registry/i.test(
        blob,
    );
}

/** Exact version on registry? (not `latest`) — required for idempotent retries. */
function versionExists(name, version) {
    const r = run('npm', ['view', `${name}@${version}`, 'version']);
    return r.status === 0 && r.stdout === version;
}

/**
 * @param {string} stagingDir
 * @param {string} name
 * @param {string} version
 * @returns {'published'|'exists'|'auth'|'missing'|'other'}
 */
function npmPublish(stagingDir, name, version) {
    const args = ['publish', '--access', 'public'];
    console.log(`\n=== ${name}@${version} npm ${args.join(' ')} ===`);
    const r = run('npm', args, { cwd: stagingDir });
    if (r.stdout) process.stdout.write(`${r.stdout}\n`);
    if (r.stderr) process.stderr.write(`${r.stderr}\n`);
    const blob = `${r.stdout}\n${r.stderr}`;
    if (r.status === 0) return 'published';
    // 幂等兜底：无论 npm 文案如何，目标版本已在 registry 就算成功 skip
    if (isAlreadyPublished(blob) || versionExists(name, version)) return 'exists';
    if (isAuthFailure(blob)) return 'auth';
    if (isMissingPackage(blob)) return 'missing';
    // 二次确认：偶发网络/文案下仍可能已写入
    if (versionExists(name, version)) return 'exists';
    console.error(blob.slice(0, 1200));
    return 'other';
}

/**
 * @param {string} version
 * @param {string} artifactsRoot
 */
function publishNative(version, artifactsRoot) {
    let published = 0;
    let skipped = 0;
    for (const plat of NATIVE_PLATFORMS) {
        const name = `@vmz/vmz-${plat.short}`;
        const artDir = path.join(artifactsRoot, plat.short);
        if (!fs.existsSync(artDir)) {
            console.log(` · ${name} no artifact (${plat.short}) — skip`);
            skipped += 1;
            continue;
        }
        if (versionExists(name, version)) {
            console.log(` ✓ ${name}@${version} already on registry — skip`);
            skipped += 1;
            continue;
        }
        const stage = path.join(os.tmpdir(), `vmz-pub-native-${plat.short}-${version}`);
        fs.rmSync(stage, { recursive: true, force: true });
        fs.mkdirSync(stage, { recursive: true });
        for (const f of fs.readdirSync(artDir)) {
            fs.copyFileSync(path.join(artDir, f), path.join(stage, f));
        }
        writeJson(path.join(stage, 'package.json'), {
            name,
            version,
            description: `VMZ native N-API addon (${plat.short})`,
            license: 'MIT',
            private: false,
            os: plat.os,
            cpu: plat.cpu,
            main: `vmz.${plat.triple}.node`,
            files: [`vmz.${plat.triple}.node`, 'README.md'],
            publishConfig: { access: 'public' },
            repository: {
                type: 'git',
                url: 'git+https://github.com/doki-land/vmz-framework.git',
            },
        });
        const want = `vmz.${plat.triple}.node`;
        // Keep only the platform-named binary (drop legacy plain `vmz.node` if present).
        for (const f of fs.readdirSync(stage)) {
            if (f.endsWith('.node') && f !== want) fs.unlinkSync(path.join(stage, f));
        }
        if (!fs.existsSync(path.join(stage, want))) {
            // Accept a lone plain twin from older artifacts and rename.
            const plain = path.join(stage, 'vmz.node');
            if (fs.existsSync(plain)) fs.renameSync(plain, path.join(stage, want));
        }
        if (!fs.existsSync(path.join(stage, want))) {
            fail(`${name}: staged artifact missing ${want}`);
        }
        fs.writeFileSync(
            path.join(stage, 'README.md'),
            `# ${name}\n\nOptional native binary for \`@vmz/vmz\` (${plat.short} / ${plat.triple}).\n`,
        );
        const outcome = npmPublish(stage, name, version);
        if (outcome === 'published') published += 1;
        else if (outcome === 'exists') {
            console.log(` ✓ ${name}@${version} already on registry — skip`);
            skipped += 1;
        } else if (outcome === 'auth') {
            fail(`OIDC/auth failed for ${name}. Add Trusted Publisher: file=publish-npm.yml env=NPM_PUBLISH repo=doki-land/vmz-framework`);
        } else fail(`publish failed for ${name}`);
    }
    return { published, skipped };
}

/**
 * @param {string} version
 */
function publishJs(version) {
    let published = 0;
    let skipped = 0;

    const optionalNatives = Object.fromEntries(NATIVE_PLATFORMS.map((p) => [`@vmz/vmz-${p.short}`, version]));

    for (const spec of JS_PACKAGES) {
        const abs = path.join(ROOT, spec.dir);
        if (!fs.existsSync(abs)) fail(`missing package dir ${spec.dir}`);
        const raw = readJson(path.join(abs, 'package.json'));
        const name = spec.publishName ?? raw.name;
        if (!name) fail(`no name for ${spec.dir}`);

        if (versionExists(name, version)) {
            console.log(` ✓ ${name}@${version} already on registry — skip`);
            skipped += 1;
            continue;
        }

        const stage = path.join(os.tmpdir(), `vmz-pub-js-${name.replace(/[/@]/g, '-')}-${version}`);
        fs.rmSync(stage, { recursive: true, force: true });

        // Prefer package.json "files"; else copy common publish roots.
        const files = Array.isArray(raw.files) && raw.files.length ? raw.files : null;
        fs.mkdirSync(stage, { recursive: true });
        if (files) {
            for (const f of files) {
                const from = path.join(abs, f);
                if (!fs.existsSync(from)) continue;
                const st = fs.statSync(from);
                const to = path.join(stage, f);
                if (st.isDirectory()) copyTree(from, to);
                else {
                    fs.mkdirSync(path.dirname(to), { recursive: true });
                    fs.copyFileSync(from, to);
                }
            }
            // Always include package entry bits that files may omit via globs
            for (const extra of ['package.json', 'README.md', 'LICENSE', 'bin']) {
                const from = path.join(abs, extra);
                if (!fs.existsSync(from)) continue;
                const to = path.join(stage, extra);
                if (fs.statSync(from).isDirectory()) copyTree(from, to);
                else fs.copyFileSync(from, to);
            }
        } else {
            copyTree(abs, stage, (p) => {
                const rel = path.relative(abs, p);
                if (rel.includes('node_modules') || rel.includes('tests') || rel.endsWith('.node')) return false;
                return true;
            });
        }

        // Strip accidental native binaries from the JS CLI package (they ship in platform pkgs).
        if (name === '@vmz/vmz') {
            for (const f of fs.readdirSync(stage)) {
                if (f.endsWith('.node')) fs.unlinkSync(path.join(stage, f));
            }
        }

        const pkg = rewriteDepsField({ ...raw }, version);
        pkg.name = name;
        pkg.version = version;
        delete pkg.private;
        pkg.publishConfig = { ...(pkg.publishConfig ?? {}), access: 'public' };
        if (!pkg.repository) {
            pkg.repository = {
                type: 'git',
                url: 'git+https://github.com/doki-land/vmz-framework.git',
            };
        }
        if (name === '@vmz/vmz') {
            pkg.optionalDependencies = { ...(pkg.optionalDependencies ?? {}), ...optionalNatives };
            // Drop monorepo-only platform package name
            delete pkg.optionalDependencies['vmz-win32-x64-msvc'];
        }
        // Drop workspace-only / private tooling deps from published manifest
        delete pkg.devDependencies;
        writeJson(path.join(stage, 'package.json'), pkg);

        if (!fs.existsSync(path.join(stage, 'README.md'))) {
            fs.writeFileSync(path.join(stage, 'README.md'), `# ${name}\n\nVMZ package ${version}.\n`);
        }

        const outcome = npmPublish(stage, name, version);
        if (outcome === 'published') published += 1;
        else if (outcome === 'exists') {
            console.log(` ✓ ${name}@${version} already on registry — skip`);
            skipped += 1;
        } else if (outcome === 'auth') {
            fail(`OIDC/auth failed for ${name}. Add Trusted Publisher: file=publish-npm.yml env=NPM_PUBLISH repo=doki-land/vmz-framework`);
        } else if (outcome === 'missing') {
            fail(
                `${name} is not on the registry yet. Create the name first via placeholder stubs (tag placeholder-v0.0.0 / pnpm placeholder:publish), then retry real publish.`,
            );
        } else fail(`publish failed for ${name}`);
    }
    return { published, skipped };
}

const version = resolveVersion();
console.log(`ci-publish-npm: version=${version}`);
console.log(` GITHUB_REF=${process.env.GITHUB_REF ?? '(none)'}`);
console.log(' Trusted Publisher contract: publish-npm.yml + env NPM_PUBLISH\n');

delete process.env.NODE_AUTH_TOKEN;
delete process.env.NPM_TOKEN;

const artifactsRoot = process.env.VMZ_NATIVE_ARTIFACTS || path.join(ROOT, 'dist');

const native = publishNative(version, artifactsRoot);
const js = publishJs(version);

console.log(
    `\nci-publish-npm: done (native published=${native.published} skipped=${native.skipped}; js published=${js.published} skipped=${js.skipped})`,
);
