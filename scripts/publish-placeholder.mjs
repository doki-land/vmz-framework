/**
 * npm 占坑工具（stubs @ 0.0.0；不发 monorepo 真包）
 *
 * 并列子命令：
 *
 *   pnpm placeholder
 *     → 查版本（实时）+ Trusted Publisher（优先读 JSON 缓存）
 *
 *   pnpm placeholder publish
 *     → 发占坑 stub；成功/已存在写入 JSON 缓存，重试 cache 命中直接 skip（--refresh 强制 live view）
 *
 *   pnpm placeholder trust
 *     → 先 list 再决定 skip/create；结果写入 JSON 缓存
 *       缓存路径：.placeholder-npm-cache.json
 *       OTP ~30s 不够扫完全部包时：已 list 的写入缓存，下次带新 --otp 继续
 *
 * 固定 Trusted Publisher：
 *   repo=doki-land/vmz-framework  file=release-npm.yml  env=NPM_PUBLISH
 *   permissions=publish + stage publish
 *
 * CLI 包：@vmz/vmz（裸名 vmz 被 similarity 拦截）
 * Native：@vmz/vmz-{os}-{cpu}（不区分 msvc/gnu）
 *
 * 常用：
 *   pnpm placeholder
 *   pnpm placeholder:trust -- --otp <code>
 *   pnpm placeholder:trust -- --otp <code> --refresh   # 忽略缓存强制重 list
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @typedef {{ name: string, os?: string[], cpu?: string[], description?: string }} StubSpec */
/** @typedef {{ listedAt: string, configs: any[], matches: boolean, matchKind: string }} TrustCacheEntry */
/** @typedef {{ version?: string|null, versionAt?: string, trust?: TrustCacheEntry }} PkgCache */
/** @typedef {{ version: number, trustExpect: typeof TRUST, packages: Record<string, PkgCache> }} CacheFile */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_PATH = path.join(ROOT, '.placeholder-npm-cache.json');

const JS_STUBS = [
    '@vmz/vmz',
    '@vmz/core',
    '@vmz/test',
    '@vmz/protocol',
    '@vmz/plugin',
    '@vmz/plugin-katex',
    '@vmz/plugin-mathjax',
    '@vmz/plugin-shiki',
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

const VERSION = '0.0.0';

const TRUST = {
    repo: 'doki-land/vmz-framework',
    file: 'release-npm.yml',
    env: 'NPM_PUBLISH',
};

const argv = process.argv.slice(2);
const positionals = argv.filter((a) => !a.startsWith('-'));
const command = positionals[0] ?? 'status';
const rest = argv.filter((a) => a !== command);

function fail(msg) {
    console.error(`placeholder: ${msg}`);
    process.exit(1);
}

/** @param {string[]} args @param {string} flag */
function takeFlag(args, flag) {
    const i = args.indexOf(flag);
    if (i >= 0 && args[i + 1] && !args[i + 1].startsWith('-')) return args[i + 1];
    const eq = args.find((a) => a.startsWith(`${flag}=`));
    if (eq) return eq.slice(flag.length + 1);
    return undefined;
}

const dryRun = rest.includes('--dry-run');
const refresh = rest.includes('--refresh');
const token = takeFlag(rest, '--token') ?? process.env.NPM_TOKEN;
const otp = takeFlag(rest, '--otp');

if (rest.includes('--opt') || rest.some((a) => a.startsWith('--opt='))) {
    fail('--opt removed. Use --token for Access Token; --otp for 2FA code.');
}
if (rest.includes('--publish') || rest.includes('--trust')) {
    fail('flags --publish/--trust removed. Use subcommands: `publish` | `trust` | (default status).');
}

/** @type {StubSpec[]} */
const STUBS = [
    ...JS_STUBS.map((name) => ({ name })),
    ...NATIVE_STUBS.map((s) => ({
        ...s,
        description: `Optional native binary for @vmz/vmz (${s.name.replace(/^@vmz\/vmz-/, '')}). Placeholder only.`,
    })),
];

/** @returns {CacheFile} */
function loadCache() {
    try {
        const raw = fs.readFileSync(CACHE_PATH, 'utf8');
        const data = JSON.parse(raw);
        if (!data || typeof data !== 'object') throw new Error('bad cache');
        const expect = data.trustExpect;
        const expectOk = expect && expect.repo === TRUST.repo && expect.file === TRUST.file && expect.env === TRUST.env;
        if (!expectOk) {
            return { version: 1, trustExpect: { ...TRUST }, packages: {} };
        }
        return {
            version: 1,
            trustExpect: { ...TRUST },
            packages: data.packages && typeof data.packages === 'object' ? data.packages : {},
        };
    } catch {
        return { version: 1, trustExpect: { ...TRUST }, packages: {} };
    }
}

/** @param {CacheFile} cache */
function saveCache(cache) {
    cache.trustExpect = { ...TRUST };
    cache.version = 1;
    fs.writeFileSync(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`);
}

/**
 * @param {string[]} args
 * @param {{ cwd?: string, silent?: boolean, inherit?: boolean }} [opts]
 */
function runNpm(args, opts = {}) {
    const r = spawnSync('npm', args, {
        cwd: opts.cwd,
        encoding: 'utf8',
        shell: process.platform === 'win32',
        stdio: opts.inherit ? 'inherit' : 'pipe',
        env: process.env,
    });
    if (r.error && !opts.silent) fail(r.error.message);
    return {
        status: r.status ?? 1,
        stdout: opts.inherit ? '' : String(r.stdout ?? '').trim(),
        stderr: opts.inherit ? '' : String(r.stderr ?? '').trim(),
    };
}

function sleep(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        /* rate-limit */
    }
}

function viewVersion(name) {
    const r = runNpm(['view', name, 'version'], { silent: true });
    if (r.status === 0 && r.stdout) return r.stdout;
    // 刚 publish 后 registry 副本常短暂 404；再试一次
    sleep(400);
    const r2 = runNpm(['view', name, 'version'], { silent: true });
    if (r2.status === 0 && r2.stdout) return r2.stdout;
    return null;
}

/**
 * live view 优先；失败则信 publish 写入的 cache。
 * @param {CacheFile} cache
 * @param {string} name
 * @returns {{ version: string|null, source: 'live'|'cache'|'none', liveMiss: boolean }}
 */
function resolvePublishedVersion(cache, name) {
    const live = viewVersion(name);
    if (live) {
        if (!cache.packages[name]) cache.packages[name] = {};
        cache.packages[name].version = live;
        cache.packages[name].versionAt = new Date().toISOString();
        return { version: live, source: 'live', liveMiss: false };
    }
    const cached = cache.packages[name]?.version;
    if (cached) {
        return { version: cached, source: 'cache', liveMiss: true };
    }
    return { version: null, source: 'none', liveMiss: true };
}

/** npm view 短暂 miss 时的统一提示（不假装“从未发布”） */
function warnLiveViewMiss(name, detail) {
    console.log(`  ! ${name}  npm view miss (registry lag / CDN) — ${detail}`);
    console.log('      if npmjs.com already shows the package: wait ~1–2min then retry; do not treat as unpublished');
}

/**
 * npm trust list --json 顶层字段：repository / file / environment / permissions
 * （旧形态可能包在 claims / workflow_ref 里）
 * @param {any} cfg
 */
function trustFields(cfg) {
    const claims = cfg?.claims ?? {};
    return {
        repo: cfg?.repository ?? claims.repository ?? claims.repo ?? '',
        file: cfg?.file ?? claims.workflow_ref?.file ?? claims.workflowFile ?? claims.file ?? claims.workflow ?? '',
        env: cfg?.environment ?? claims.environment ?? claims.env ?? '',
    };
}

/**
 * @param {any} cfg
 */
function trustMatches(cfg) {
    if (cfg?.raw && typeof cfg.raw === 'string') {
        return cfg.raw.includes(TRUST.repo) && cfg.raw.includes(TRUST.file) && (cfg.raw.includes(TRUST.env) || cfg.raw.includes('NPM_PUBLISH'));
    }
    const { repo, file, env } = trustFields(cfg);
    const perms = new Set(cfg?.permissions ?? []);
    const allowPublish = perms.size === 0 || perms.has('createPackage') || perms.has('publish') || perms.has('npm publish');
    const allowStage = perms.size === 0 || perms.has('createStagedPackage') || perms.has('stage') || perms.has('npm stage publish');
    return repo === TRUST.repo && file === TRUST.file && (env === TRUST.env || env === '') && allowPublish && allowStage;
}

/** @param {any} cfg */
function trustExact(cfg) {
    if (cfg?.raw && typeof cfg.raw === 'string') {
        return trustMatches(cfg) && cfg.raw.includes(TRUST.env);
    }
    const { env } = trustFields(cfg);
    return trustMatches(cfg) && env === TRUST.env;
}

/**
 * @param {any[]} configs
 * @returns {{ matches: boolean, matchKind: string }}
 */
function classifyConfigs(configs) {
    if (configs.find(trustExact)) return { matches: true, matchKind: 'exact' };
    if (configs.find(trustMatches)) return { matches: true, matchKind: 'loose' };
    if (configs.length === 0) return { matches: false, matchKind: 'none' };
    return { matches: false, matchKind: 'mismatch' };
}

/**
 * Live `npm trust list`（不走缓存）.
 * @param {string} name
 */
function listTrustLive(name) {
    const args = ['trust', 'list', name, '--json'];
    if (otp) args.push(`--otp=${otp}`);
    const r = runNpm(args, { silent: true });
    const blob = `${r.stdout}\n${r.stderr}`;
    if (/EOTP|one-time password|auth\/cli/i.test(blob)) {
        return { configs: [], authRequired: true, error: 'EOTP' };
    }
    if (r.status !== 0) {
        return { configs: [], error: blob.slice(0, 200) || `exit ${r.status}` };
    }
    try {
        const data = JSON.parse(r.stdout || '[]');
        if (Array.isArray(data)) return { configs: data };
        if (Array.isArray(data?.configurations)) return { configs: data.configurations };
        if (Array.isArray(data?.items)) return { configs: data.items };
        if (data && typeof data === 'object' && (data.type || data.claims)) {
            return { configs: [data] };
        }
        return { configs: [] };
    } catch {
        if (/github|trusted|repository/i.test(r.stdout)) {
            return { configs: [{ raw: r.stdout }] };
        }
        return { configs: [], error: 'unparseable trust list' };
    }
}

/**
 * @param {CacheFile} cache
 * @param {string} name
 * @param {any[]} configs
 */
function writeTrustCache(cache, name, configs) {
    const { matches, matchKind } = classifyConfigs(configs);
    if (!cache.packages[name]) cache.packages[name] = {};
    cache.packages[name].trust = {
        listedAt: new Date().toISOString(),
        configs,
        matches,
        matchKind,
    };
    saveCache(cache);
    return cache.packages[name].trust;
}

/**
 * @param {CacheFile} cache
 * @param {string} name
 * @param {{ preferLive?: boolean }} [opts]
 * @returns {{ source: 'live'|'cache'|'none', trust?: TrustCacheEntry, authRequired?: boolean, error?: string }}
 */
function resolveTrust(cache, name, opts = {}) {
    const cached = cache.packages[name]?.trust;
    if (cached?.configs && Array.isArray(cached.configs)) {
        const recl = classifyConfigs(cached.configs);
        cached.matches = recl.matches;
        cached.matchKind = recl.matchKind;
    }
    const wantLive = opts.preferLive || refresh || Boolean(otp);

    if (wantLive) {
        if (!otp && refresh) {
            return {
                source: cached ? 'cache' : 'none',
                trust: cached,
                error: '--refresh needs --otp to re-list',
            };
        }
        if (!otp) {
            return { source: cached ? 'cache' : 'none', trust: cached };
        }
        const live = listTrustLive(name);
        if (live.authRequired) {
            return { source: cached ? 'cache' : 'none', trust: cached, authRequired: true };
        }
        if (live.error) {
            return { source: cached ? 'cache' : 'none', trust: cached, error: live.error };
        }
        const entry = writeTrustCache(cache, name, live.configs);
        return { source: 'live', trust: entry };
    }

    if (cached) return { source: 'cache', trust: cached };
    return { source: 'none' };
}

function checkStatus() {
    const cache = loadCache();
    console.log('placeholder: status\n');
    console.log(`  Trusted Publisher expect: ${TRUST.repo}  ${TRUST.file}  env=${TRUST.env}  [publish + stage]`);
    console.log(`  cache: ${CACHE_PATH}`);
    if (!otp) {
        console.log('  tip: trust 列优先读缓存；带 `--otp` 可刷新 list 并写回缓存\n');
    } else {
        console.log('  mode: live trust list + write cache\n');
    }

    let missingPkg = 0;
    let badTrust = 0;
    let unknownTrust = 0;
    let ok = 0;

    for (const spec of STUBS) {
        const resolvedVer = resolvePublishedVersion(cache, spec.name);
        if (!cache.packages[spec.name]) cache.packages[spec.name] = {};
        const ver = resolvedVer.version;

        if (!ver) {
            warnLiveViewMiss(spec.name, 'no live version and no local cache');
            console.log(`  ✗ ${spec.name}  package unknown (cannot confirm published)`);
            missingPkg += 1;
            continue;
        }
        if (resolvedVer.liveMiss) {
            warnLiveViewMiss(spec.name, `using cache ${ver} @ ${cache.packages[spec.name].versionAt ?? '?'}`);
        }
        const verMark = ver === VERSION ? VERSION : `${ver} (!= ${VERSION})`;
        const verSrc = resolvedVer.source === 'cache' ? 'cache; live miss' : resolvedVer.source;
        const resolved = resolveTrust(cache, spec.name, { preferLive: Boolean(otp) });

        if (resolved.authRequired && !resolved.trust) {
            console.log(`  ? ${spec.name}@${verMark}  trust unknown (EOTP; use cache or fresh --otp) [${verSrc}]`);
            unknownTrust += 1;
            continue;
        }
        if (!resolved.trust) {
            console.log(`  ? ${spec.name}@${verMark}  trust unknown (no cache; run trust --otp) [${verSrc}]`);
            unknownTrust += 1;
            continue;
        }

        const src = resolved.source === 'cache' ? 'cache' : 'live';
        const t = resolved.trust;
        if (t.matches) {
            console.log(`  ✓ ${spec.name}@${verMark}  trust ok [trust=${src}; pkg=${verSrc}]`);
            ok += 1;
        } else if (t.matchKind === 'none') {
            console.log(`  ~ ${spec.name}@${verMark}  trust missing [trust=${src}; pkg=${verSrc}]`);
            badTrust += 1;
        } else {
            console.log(`  ~ ${spec.name}@${verMark}  trust mismatch [trust=${src}; pkg=${verSrc}]`);
            badTrust += 1;
        }
    }

    saveCache(cache);
    console.log(`\nplaceholder: ${ok} ok, ${missingPkg} package missing, ${badTrust} trust missing/mismatch, ${unknownTrust} trust unknown`);
    console.log('  next: pnpm placeholder:publish   or   pnpm placeholder:trust -- --otp <code>');
    process.exit(missingPkg + badTrust > 0 ? 1 : 0);
}

/**
 * @param {StubSpec} spec
 * @param {string} dir
 * @param {string | undefined} authToken
 */
function writeStub(spec, dir, authToken) {
    fs.mkdirSync(dir, { recursive: true });
    const pkg = {
        name: spec.name,
        version: VERSION,
        description: spec.description ?? 'VMZ placeholder — not for production use.',
        license: 'MIT',
        private: false,
        files: ['README.md'],
    };
    if (spec.os) pkg.os = spec.os;
    if (spec.cpu) pkg.cpu = spec.cpu;
    fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
    fs.writeFileSync(path.join(dir, 'README.md'), `# ${spec.name}\n\nPlaceholder package (${VERSION}). Reserved for the VMZ project.\n`);
    if (authToken) {
        fs.writeFileSync(path.join(dir, '.npmrc'), `//registry.npmjs.org/:_authToken=${authToken}\n`, {
            mode: 0o600,
        });
    }
}

function cmdPublish() {
    const cache = loadCache();
    if (!token) {
        console.warn('placeholder publish: no --token; interactive login may ask OTP (2FA). Tip: --token <npm_access_token> or --otp <code>');
    }

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-npm-stubs-'));
    console.log(`placeholder publish: stubs → ${root}`);
    console.log(dryRun ? 'placeholder publish: DRY-RUN' : 'placeholder publish: LIVE');
    console.log(`  cache: ${CACHE_PATH}`);
    console.log('  rule: cache version===0.0.0 → skip; --refresh forces live npm view. Partial retry OK.\n');

    let published = 0;
    let skipped = 0;

    for (const spec of STUBS) {
        if (!cache.packages[spec.name]) cache.packages[spec.name] = {};
        const cachedVer = cache.packages[spec.name].version;

        if (!refresh && !dryRun && cachedVer === VERSION) {
            console.log(`  ✓ ${spec.name}@${VERSION}  already published — skip [cache ${cache.packages[spec.name].versionAt ?? ''}]`);
            skipped += 1;
            continue;
        }

        const existing = viewVersion(spec.name);
        if (existing) {
            cache.packages[spec.name].version = existing;
            cache.packages[spec.name].versionAt = new Date().toISOString();
            saveCache(cache);
        }

        if (existing === VERSION && !dryRun) {
            console.log(`  ✓ ${spec.name}@${VERSION}  already published — skip [live]`);
            skipped += 1;
            continue;
        }

        // live 短暂 404，但 cache 已是目标版 → 当已发布（并明示）
        if (!existing && cachedVer === VERSION && !dryRun && !refresh) {
            warnLiveViewMiss(spec.name, `skip publish using cache ${VERSION}`);
            console.log(`  ✓ ${spec.name}@${VERSION}  already published — skip [cache; live miss]`);
            skipped += 1;
            continue;
        }

        if (!existing && !cachedVer) {
            // fall through to publish
        } else if (!existing && cachedVer && cachedVer !== VERSION) {
            warnLiveViewMiss(spec.name, `cache has ${cachedVer}; live unknown — will attempt publish`);
        }

        const safe = spec.name.replace(/^@/, '').replace(/\//g, '-');
        const dir = path.join(root, safe);
        writeStub(spec, dir, token);

        const args = ['publish'];
        if (spec.name.startsWith('@')) args.push('--access', 'public');
        if (dryRun) args.push('--dry-run');
        if (otp) args.push(`--otp=${otp}`);

        console.log(`\n=== ${spec.name}  npm ${args.join(' ')} ===`);
        const r = runNpm(args, { cwd: dir, silent: true });
        if (r.stdout) process.stdout.write(r.stdout + (r.stdout.endsWith('\n') ? '' : '\n'));
        if (r.stderr) process.stderr.write(r.stderr + (r.stderr.endsWith('\n') ? '' : '\n'));

        if (r.status === 0) {
            published += 1;
            cache.packages[spec.name].version = VERSION;
            cache.packages[spec.name].versionAt = new Date().toISOString();
            saveCache(cache);
            console.log(`  ✓ ${spec.name}@${VERSION}  published + cached`);
            continue;
        }

        const blob = `${r.stdout}\n${r.stderr}`;
        if (/previously published|cannot publish over/i.test(blob)) {
            console.log(`  ✓ ${spec.name}@${VERSION}  already on registry — skip + cache`);
            skipped += 1;
            cache.packages[spec.name].version = VERSION;
            cache.packages[spec.name].versionAt = new Date().toISOString();
            saveCache(cache);
            continue;
        }

        saveCache(cache);
        fail(`publish failed: ${spec.name} (cache saved — re-run continues from cached 0.0.0 skips)`);
    }

    saveCache(cache);
    console.log(`\nplaceholder publish: done (published ${published}, skipped ${skipped}).  pnpm placeholder`);
}

function cmdTrust() {
    const cache = loadCache();
    console.log('placeholder trust: Trusted Publisher');
    console.log(`  repo=${TRUST.repo}`);
    console.log(`  file=${TRUST.file}`);
    console.log(`  env=${TRUST.env}`);
    console.log('  permissions: npm publish + npm stage publish');
    console.log(`  cache: ${CACHE_PATH}`);
    console.log('  rule: skip only when trust list (or cache from a prior list) says already matches\n');

    let configured = 0;
    let skipped = 0;
    let listedThisRun = 0;

    for (const spec of STUBS) {
        if (!cache.packages[spec.name]) cache.packages[spec.name] = {};

        // 先看 trust cache：命中则立刻 skip，禁止 npm view / sleep
        const cached = !refresh ? cache.packages[spec.name]?.trust : undefined;
        if (cached?.configs && Array.isArray(cached.configs)) {
            const recl = classifyConfigs(cached.configs);
            cached.matches = recl.matches;
            cached.matchKind = recl.matchKind;
            cache.packages[spec.name].trust = cached;
        }
        if (cached?.matches) {
            console.log(`  ✓ ${spec.name}  already configured — skip [cache ${cached.listedAt}]`);
            skipped += 1;
            continue;
        }

        const resolvedVer = resolvePublishedVersion(cache, spec.name);
        const ver = resolvedVer.version;

        if (!ver) {
            warnLiveViewMiss(spec.name, 'no live version and no local cache — skip trust');
            continue;
        }
        if (resolvedVer.liveMiss) {
            warnLiveViewMiss(spec.name, `proceeding with cache ${ver}; will still try trust list`);
        }

        // Need a live list (OTP window). Cache miss / non-match / --refresh.
        if (!otp) {
            saveCache(cache);
            fail(`need --otp to list ${spec.name} (no matching cache). Progress saved. Re-run: pnpm placeholder:trust -- --otp <code>`);
        }

        const live = listTrustLive(spec.name);
        if (live.authRequired) {
            saveCache(cache);
            fail(`EOTP while listing ${spec.name} after ${listedThisRun} list(s) this run. Cache saved — get a fresh OTP and continue.`);
        }
        if (live.error) {
            saveCache(cache);
            fail(`trust list failed for ${spec.name}: ${live.error}`);
        }

        listedThisRun += 1;
        const entry = writeTrustCache(cache, spec.name, live.configs);
        console.log(`  list ${spec.name} → ${entry.matchKind} (cached)`);

        if (entry.matches) {
            console.log(`  ✓ ${spec.name}  already configured — skip [live]`);
            skipped += 1;
            continue;
        }

        if (entry.matchKind === 'mismatch') {
            console.log(`  ! ${spec.name}  has trusted publisher that does not match expect:`);
            console.log(`    ${JSON.stringify(live.configs, null, 2).split('\n').join('\n    ')}`);
            fail(`${spec.name}: refuse to create over existing trust. Fix expect or revoke manually, then --refresh.`);
        }

        // matchKind === 'none' → create
        const args = [
            'trust',
            'github',
            spec.name,
            `--file=${TRUST.file}`,
            `--repo=${TRUST.repo}`,
            `--env=${TRUST.env}`,
            '--allow-publish',
            '--allow-stage-publish',
            '--yes',
            `--otp=${otp}`,
        ];
        if (dryRun) {
            console.log(`  dry-run would: npm ${args.join(' ')}`);
            continue;
        }

        console.log(`\n=== ${spec.name}  npm trust github ===`);
        const r = runNpm(args, { silent: true });
        if (r.stdout) process.stdout.write(r.stdout + (r.stdout.endsWith('\n') ? '' : '\n'));
        if (r.stderr) process.stderr.write(r.stderr + (r.stderr.endsWith('\n') ? '' : '\n'));

        if (r.status !== 0) {
            saveCache(cache);
            fail(`trust create failed: ${spec.name} (cache kept; fix and retry — do not assume E409 means ok)`);
        }

        // Confirm via list and cache.
        const again = listTrustLive(spec.name);
        if (!again.authRequired && !again.error) {
            writeTrustCache(cache, spec.name, again.configs);
        } else {
            // Create succeeded; record expected match without second list if OTP died.
            writeTrustCache(cache, spec.name, [
                {
                    type: 'github',
                    claims: {
                        repository: TRUST.repo,
                        workflow_ref: { file: TRUST.file },
                        environment: TRUST.env,
                    },
                    permissions: ['createPackage', 'createStagedPackage'],
                },
            ]);
        }

        configured += 1;
        console.log(`  ✓ ${spec.name}  configured + cached`);
        sleep(2000);
    }

    saveCache(cache);
    console.log(`\nplaceholder trust: done (configured ${configured}, skipped ${skipped}, listed ${listedThisRun}).`);
}

switch (command) {
    case 'status':
    case 'check':
        checkStatus();
        break;
    case 'publish':
        cmdPublish();
        break;
    case 'trust':
        cmdTrust();
        break;
    default:
        fail(`unknown command \`${command}\`. Use: (default status) | publish | trust`);
}
