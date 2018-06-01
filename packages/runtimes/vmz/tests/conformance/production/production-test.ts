/**
 * A4 Production Test — scenario pack + deterministic CI profile.
 * verify id: production-test
 *
 * Runs real vmz-test / serve-host / release-pack paths; quarantines UI/locale/theme/mount
 * explicitly (never counted as passed). No Vitest/Jest/Playwright.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    assertNoForbiddenRunners,
    browserProductionCiProfile,
    browserProductionScenarioPack,
    buildProductionTestReport,
    ciProfileDigest,
    emitProductionTestArtifacts,
    normalizeScenarioPack,
    packRelease,
    productionTestReportDigest,
    publishRelease,
    readPointer,
    rollbackRelease,
    scenarioPackDigest,
} from 'vmz';
import { repoRoot } from '../_lib/repo-root.ts';
import { addLimitation, readProof, runVmzBuild, runVmzTest, upsertCheck, writeProof } from '../_lib/production-proof.ts';

const root = repoRoot(import.meta.url);
const ROUTER = 'packages/examples/production-router';
const PORT = 18781;

function fail(msg: string): never {
    console.error(`production-test FAIL: ${msg}`);
    process.exit(1);
}

type ScenarioResult = {
    scenarioId: string;
    status: string;
    detail?: string;
    reason?: string;
    artifacts?: Record<string, string> | null;
    attempts?: number;
    flaky?: boolean;
};

console.log('production-test: normalize scenario pack + CI profile…');
const rawPack = browserProductionScenarioPack();
const norm = normalizeScenarioPack(rawPack);
if (!norm.ok) fail(`pack normalize: ${JSON.stringify(norm.diagnostics)}`);
const pack = norm.pack;
const profile = browserProductionCiProfile();

// Determinism: two normalize passes → same digest.
const packDigestA = scenarioPackDigest(pack);
const norm2 = normalizeScenarioPack(rawPack);
if (!norm2.ok) fail('second normalize failed');
const packDigestB = scenarioPackDigest(norm2.pack);
if (packDigestA !== packDigestB) fail('scenario pack digest not stable across normalize');
const profileDigest = ciProfileDigest(profile);
if (profile.workers !== 1) fail('CI profile must be serial (workers=1)');
if (profile.retry.enabled) fail('CI profile retry must default off');
if (profile.retry.promoteFlakyPass) fail('CI must never promote flaky pass');
if (!profile.quarantine.neverCountAsPassed) fail('quarantine must never count as passed');

const forbidden = assertNoForbiddenRunners(profile, ['vitest', 'playwright']);
if (forbidden.length !== 2) fail(`forbidden runner detection broken: ${forbidden.join(',')}`);
const okForbidden = assertNoForbiddenRunners(profile, ['vmz-test', 'serve-host']);
if (okForbidden.length) fail(`false positive forbidden: ${okForbidden.join(',')}`);

// Reject quarantine-as-passed authoring.
const badPack = normalizeScenarioPack({
    ...rawPack,
    scenarios: [
        ...((rawPack as { scenarios: unknown[] }).scenarios || []).slice(0, 1),
        {
            scenarioId: 'production.ui.field.submit',
            category: 'field',
            quarantine: true,
            status: 'passed',
            modes: ['browser'],
            runner: 'quarantine',
        },
    ],
});
if (badPack.ok) fail('pack must reject quarantine authored as passed');

const results: ScenarioResult[] = [];

function record(r: ScenarioResult): void {
    results.push(r);
}

/** Collect vmz-test results for required scenarioIds under a fixture. */
function runVmzTestGroup(fixture: string, scenarioIds: string[], modes: string, reportName: string): void {
    console.log(`production-test: vmz test ${fixture} (${modes})…`);
    const filter = `^(${scenarioIds.map((id) => id.replace(/\./g, '\\.')).join('|')})$`;
    const test = runVmzTest(fixture, ['--mode', modes, '--filter', filter], root, {
        reportName: path.join('production-test', reportName),
    });
    const report = test.report as {
        status?: string;
        tests?: Array<{ testId: string; status: string }>;
    } | null;
    for (const id of scenarioIds) {
        const hit = report?.tests?.find((t) => t.testId === id);
        record({
            scenarioId: id,
            status: hit?.status === 'passed' ? 'passed' : hit?.status || 'missing',
            detail: test.reportPath,
            artifacts: { report: test.reportPath },
            attempts: 1,
        });
    }
}

runVmzTestGroup(
    'packages/examples/production-catalog',
    [
        'production.catalog.compile.list',
        'production.catalog.logic.list',
        'production.catalog.ssr.list',
        'production.catalog.resume.chip',
        'production.catalog.browser.select',
    ],
    'compile,logic,ssr,resume,browser',
    'catalog.json',
);

runVmzTestGroup(
    'packages/examples/island',
    ['resume.resume.island', 'resume.event.entry', 't3.deployment.island.resume'],
    'resume,deployment',
    'island.json',
);

runVmzTestGroup('packages/examples/fullstack', ['t3.deployment.usercard.isolation'], 'deployment', 'fullstack.json');

console.log('production-test: build production-router for access/action/rollback…');
const build = runVmzBuild(ROUTER, root);
if (build.status !== 0) {
    for (const id of [
        'production.router.access',
        'production.router.action',
        'production.router.loader-cancel',
        'production.release.rollback',
    ]) {
        record({
            scenarioId: id,
            status: 'failed',
            detail: (build.stderr || build.stdout).slice(0, 1500),
            attempts: 1,
        });
    }
} else {
    const dist = build.dist;

    // --- serve-host: access + action ---
    console.log('production-test: serve-host access/action…');
    const hostJs = path.join(dist, 'vmz-serve-host.mjs');
    if (!fs.existsSync(hostJs)) fail(`missing serve-host: ${hostJs}`);
    let child: ReturnType<typeof spawn> | null = null;
    const killChild = () => {
        if (child && !child.killed) {
            try {
                child.kill('SIGTERM');
            } catch {
                /* ignore */
            }
            child = null;
        }
    };
    try {
        child = spawn(process.execPath, [hostJs], {
            cwd: dist,
            env: { ...process.env, VMZ_DIST: dist, VMZ_HOST: '127.0.0.1', VMZ_PORT: String(PORT) },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        await new Promise<void>((resolve, reject) => {
            const t = setTimeout(() => reject(new Error('serve-host start timeout')), 8000);
            const onData = (buf: Buffer) => {
                if (String(buf).includes('vmz serve http://')) {
                    clearTimeout(t);
                    child!.stdout!.off('data', onData);
                    resolve();
                }
            };
            child!.stdout!.on('data', onData);
            child!.stderr!.on('data', (b) => process.stderr.write(b));
            child!.on('exit', (code) => {
                clearTimeout(t);
                reject(new Error(`serve-host exited early ${code}`));
            });
        });

        const blocked = await get(`http://127.0.0.1:${PORT}/products/blocked`);
        const secret = await get(`http://127.0.0.1:${PORT}/products/secret`);
        const elsewhere = await get(`http://127.0.0.1:${PORT}/products/elsewhere`);
        const ok = await get(`http://127.0.0.1:${PORT}/products/sku-1`);

        const accessErrors: string[] = [];
        if (blocked.status !== 404 || !blocked.body.includes('route-access-not-found')) {
            accessErrors.push(`not-found got ${blocked.status}`);
        }
        if (secret.status !== 403 || !secret.body.includes('route-access-deny')) {
            accessErrors.push(`deny got ${secret.status}`);
        }
        if (elsewhere.status !== 302 || String(elsewhere.headers.location || '') !== '/about') {
            accessErrors.push(`redirect got ${elsewhere.status} ${elsewhere.headers.location}`);
        }
        if (ok.status !== 200 || !ok.body.includes('route-product')) {
            accessErrors.push(`allow got ${ok.status}`);
        }
        record({
            scenarioId: 'production.router.access',
            status: accessErrors.length ? 'failed' : 'passed',
            detail: accessErrors.length ? accessErrors.join('; ') : 'access allow/deny/not-found/redirect',
            attempts: 1,
        });

        const actionOk = await postJson(`http://127.0.0.1:${PORT}/products/sku-1`, { note: 'from-action' });
        const actionRedirect = await postJson(`http://127.0.0.1:${PORT}/products/bounce`, { note: 'x' });
        const actionErrors: string[] = [];
        if (actionOk.status !== 200 || !actionOk.body.includes('action-note:from-action')) {
            actionErrors.push(`action body ${actionOk.status}`);
        }
        if (actionRedirect.status !== 302 || String(actionRedirect.headers.location || '') !== '/about') {
            actionErrors.push(`action redirect ${actionRedirect.status}`);
        }
        record({
            scenarioId: 'production.router.action',
            status: actionErrors.length ? 'failed' : 'passed',
            detail: actionErrors.length ? actionErrors.join('; ') : 'Page.action POST + redirect',
            attempts: 1,
        });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        record({ scenarioId: 'production.router.access', status: 'failed', detail: msg, attempts: 1 });
        record({ scenarioId: 'production.router.action', status: 'failed', detail: msg, attempts: 1 });
    } finally {
        killChild();
    }

    // --- loader cancel / stale generation ---
    console.log('production-test: loader cancel + stale generation…');
    try {
        const detail = await proveLoaderCancel(dist);
        record({
            scenarioId: 'production.router.loader-cancel',
            status: 'passed',
            detail,
            attempts: 1,
        });
    } catch (e) {
        record({
            scenarioId: 'production.router.loader-cancel',
            status: 'failed',
            detail: e instanceof Error ? e.message : String(e),
            attempts: 1,
        });
    }

    // --- release rollback ---
    console.log('production-test: release pack rollback…');
    try {
        const detail = proveRollback(dist);
        record({
            scenarioId: 'production.release.rollback',
            status: 'passed',
            detail,
            attempts: 1,
        });
    } catch (e) {
        record({
            scenarioId: 'production.release.rollback',
            status: 'failed',
            detail: e instanceof Error ? e.message : String(e),
            attempts: 1,
        });
    }
}

// Quarantine scenarios — explicit status, never passed.
for (const s of pack.scenarios as Array<{ scenarioId: string; quarantine?: boolean; reason?: string }>) {
    if (!s.quarantine) continue;
    record({
        scenarioId: s.scenarioId,
        status: 'quarantined',
        reason: s.reason || undefined,
        attempts: 0,
    });
}

const report = buildProductionTestReport({
    pack,
    profile,
    results,
    artifactsDir: profile.artifacts.dir,
});
const emitted = emitProductionTestArtifacts(root, report, pack, profile);
const reportDigest = productionTestReportDigest(report);

// Prove flaky-pass rejection in report builder.
const flakyProbe = buildProductionTestReport({
    pack: {
        ...pack,
        scenarios: [
            {
                scenarioId: 'production.catalog.compile.list',
                category: 'compile',
                required: true,
                quarantine: false,
            },
        ],
    },
    profile,
    results: [
        {
            scenarioId: 'production.catalog.compile.list',
            status: 'passed',
            attempts: 2,
            flaky: true,
        },
    ],
});
if (flakyProbe.status === 'passed') fail('flaky pass must fail the production report');

const proof = readProof(root);
proof.testManifestDigest = packDigestA;
proof.testReportDigest = reportDigest;
proof.hostProfile = proof.hostProfile ?? 'browser-web-surface';
proof.deliveryProfile = proof.deliveryProfile ?? 'browser-ssr-direct-resume';

upsertCheck(proof, {
    id: 'production-test.scenario-pack',
    status: report.status === 'passed' ? 'passed' : 'failed',
    detail: `pack=${pack.id} digest=${packDigestA.slice(0, 12)} scenarios=${(pack.scenarios as unknown[]).length}`,
});
upsertCheck(proof, {
    id: 'production-test.ci-profile',
    status: 'passed',
    detail: `seed=${profile.seed} workers=1 retry=off quarantine=explicit digest=${profileDigest.slice(0, 12)}`,
});
upsertCheck(proof, {
    id: 'production-test',
    status: report.status === 'passed' ? 'passed' : 'failed',
    detail: emitted.reportPath,
});

const gaps = [
    'A4: Field / Dialog UI scenarios still quarantined (need @vmz/ui UI1)',
    'A4: locale switch / RTL / theme missing-token still quarantined',
    'A4: ApplicationMount child failure still quarantined',
    'A4: failure screenshot / network.json capture not yet wired (report+trace+manifest retained)',
];
for (const g of gaps) addLimitation(proof, g);
proof.knownLimitations = proof.knownLimitations.filter(
    (l) => !l.includes('A4: production scenario pack') && !l.includes('A4: deterministic CI profile'),
);

writeProof(proof, root);

if (report.status !== 'passed') {
    fail(`report failed\n${(report.errors as string[]).join('\n')}\nsee ${emitted.reportPath}`);
}

console.log(
    `production-test PASS: pack=${pack.id} required=${(pack.scenarios as Array<{ required: boolean }>).filter((s) => s.required).length} quarantined=${(pack.scenarios as Array<{ quarantine: boolean }>).filter((s) => s.quarantine).length}`,
);
console.log('production-test NOTE: Field/Dialog/locale/theme/mount still quarantined');

async function proveLoaderCancel(distDir: string): Promise<string> {
    const ProductPage = (await import(pathToFileURL(path.join(distDir, 'pages', 'products', '[id].client.js')).href)).default;
    const ac = new AbortController();
    const p = ProductPage.load({
        params: { id: 'sku-1' },
        signal: ac.signal,
        searchParams: new URLSearchParams('slow=1'),
    });
    await new Promise((r) => setTimeout(r, 15));
    ac.abort();
    const loaded = await p;
    if (!ac.signal.aborted) throw new Error('expected aborted signal');
    if (loaded?.title === 'Widget sku-1') {
        throw new Error('cancelled slow load must not return success title');
    }
    const ac1 = new AbortController();
    const ac2 = new AbortController();
    const slow1 = ProductPage.load({
        params: { id: 'old' },
        signal: ac1.signal,
        searchParams: new URLSearchParams('slow=1'),
    });
    await new Promise((r) => setTimeout(r, 10));
    ac1.abort();
    const slow2 = ProductPage.load({
        params: { id: 'new' },
        signal: ac2.signal,
        searchParams: new URLSearchParams(),
    });
    const [r1, r2] = await Promise.all([slow1, slow2]);
    if (r2?.title !== 'Widget new') throw new Error(`newer load want Widget new, got ${r2?.title}`);
    if (r1?.title === 'Widget old') throw new Error('older cancelled load must not succeed as Widget old');
    return 'AbortSignal cancel + generation supersede';
}

function proveRollback(distDir: string): string {
    const releasesRoot = path.join(distDir, 'releases-production-test');
    fs.rmSync(releasesRoot, { recursive: true, force: true });
    const envA = packRelease(distDir, { applicationId: 'production-router' });
    publishRelease(releasesRoot, distDir, envA);
    const indexClient = path.join(distDir, 'pages', 'index.client.js');
    const original = fs.readFileSync(indexClient, 'utf8');
    fs.writeFileSync(indexClient, `${original}\n/* production-test mutate */\n`, 'utf8');
    const envB = packRelease(distDir, { applicationId: 'production-router' });
    if (envB.artifactDigest === envA.artifactDigest) throw new Error('mutated digest must change');
    publishRelease(releasesRoot, distDir, envB);
    const rb = rollbackRelease(releasesRoot);
    if (rb.restored !== envA.artifactDigest) throw new Error(`rollback restored ${rb.restored}`);
    if (readPointer(path.join(releasesRoot, 'CURRENT')) !== envA.artifactDigest) {
        throw new Error('CURRENT not restored to A');
    }
    // restore mutated file so later drivers see clean dist
    fs.writeFileSync(indexClient, original, 'utf8');
    return `rollback ${envB.artifactDigest.slice(0, 8)}→${envA.artifactDigest.slice(0, 8)}`;
}

function get(url: string): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
    return new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
            const parts: Buffer[] = [];
            res.on('data', (c) => parts.push(c));
            res.on('end', () =>
                resolve({
                    status: res.statusCode || 0,
                    body: Buffer.concat(parts).toString('utf8'),
                    headers: res.headers,
                }),
            );
        });
        req.on('error', reject);
    });
}

function postJson(url: string, body: unknown): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const u = new URL(url);
        const req = http.request(
            {
                hostname: u.hostname,
                port: u.port,
                path: u.pathname + u.search,
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'content-length': Buffer.byteLength(payload),
                },
            },
            (res) => {
                const parts: Buffer[] = [];
                res.on('data', (c) => parts.push(c));
                res.on('end', () =>
                    resolve({
                        status: res.statusCode || 0,
                        body: Buffer.concat(parts).toString('utf8'),
                        headers: res.headers,
                    }),
                );
            },
        );
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}
