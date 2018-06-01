/**
 * A5 Production Observability — trace facets, redaction, CSP/security,
 * budgets, health/readiness + graceful shutdown policy.
 * verify id: production-observability
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {
    applySecurityHeadersToCdnPolicy,
    browserProductionObservability,
    buildCdnPolicyManifest,
    checkCapabilityClosure,
    checkProductionBudgets,
    emitProductionObservability,
    listenLocalStaticHost,
    measureDistBudgets,
    observabilityDigest,
    redactSensitive,
    REQUIRED_TRACE_FACETS,
    validateProductionTrace,
} from 'vmz';
import { repoRoot } from '../_lib/repo-root.ts';
import { addLimitation, readProof, runVmzBuild, upsertCheck, writeProof } from '../_lib/production-proof.ts';

const root = repoRoot(import.meta.url);
const EXAMPLE = 'packages/examples/production-router';
const PORT = 18791;
const STATIC_PORT = 18792;

function fail(msg: string): never {
    console.error(`production-observability FAIL: ${msg}`);
    process.exit(1);
}

const errors: string[] = [];

console.log('production-observability: normalize contract…');
const contract = browserProductionObservability();
if (contract.schema !== 'vmz.production.observability.v0') errors.push('bad observability schema');
const facets = (contract.trace as { requiredFacets: string[] }).requiredFacets;
for (const f of REQUIRED_TRACE_FACETS) {
    if (!facets.includes(f)) errors.push(`missing required facet ${f}`);
}
const digestA = observabilityDigest(contract);
const digestB = observabilityDigest(browserProductionObservability());
if (digestA !== digestB) errors.push('observability digest not stable');

console.log('production-observability: redaction…');
const leaky = {
    user: 'ada',
    password: 'hunter2',
    nested: { api_key: 'sk-live-xxx', note: 'ok' },
    authorization: 'Bearer abc.def.ghi',
};
const redacted = redactSensitive(leaky, contract.redaction as Record<string, unknown>) as Record<string, unknown>;
const redactedText = JSON.stringify(redacted);
if (redactedText.includes('hunter2') || redactedText.includes('sk-live') || redactedText.includes('abc.def')) {
    errors.push(`redaction leaked secrets: ${redactedText}`);
}
if (redacted.password !== '[REDACTED]') errors.push('password not redacted');
const stillLeaky = validateProductionTrace({
    schema: 'vmz.production.trace.v0',
    events: [
        {
            facet: 'capability',
            payload: { secret: 'raw-secret' },
            redacted: false,
        },
    ],
});
if (stillLeaky.ok) errors.push('trace must reject unredacted sensitive payload');

console.log('production-observability: build production-router…');
const build = runVmzBuild(EXAMPLE, root);
if (build.status !== 0) {
    fail(`vmz build exited ${build.status}\n${build.stdout}\n${build.stderr}`);
}
const dist = build.dist;

console.log('production-observability: emit contract + covering trace…');
const emitted = emitProductionObservability(dist, {}, { applicationId: 'production-router', artifactDigest: digestA });
const traceCheck = validateProductionTrace(emitted.trace, REQUIRED_TRACE_FACETS as unknown as string[]);
if (!traceCheck.ok) errors.push(`covering trace: ${traceCheck.errors.join('; ')}`);
if (!fs.existsSync(emitted.contractPath)) errors.push('missing production-observability.json');

console.log('production-observability: budgets…');
const measured = measureDistBudgets(dist);
const budget = checkProductionBudgets(measured, contract.budgets as Record<string, unknown>);
if (!budget.ok) errors.push(`budget: ${budget.violations.join('; ')}`);
// Degeneration must be visible: artificial oversize fails.
const over = checkProductionBudgets({ ...measured, irrelevantBindingWork: 1 }, contract.budgets as Record<string, unknown>);
if (over.ok) errors.push('budget gate must fail on irrelevantBindingWork>0');

console.log('production-observability: capability closure…');
const capOk = checkCapabilityClosure(
    {
        allowlist: ['fetchUser'],
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object' },
        timeoutMs: 1000,
        cancelSupported: true,
        secrets: [],
    },
    contract.capability as Record<string, unknown>,
);
if (!capOk.ok) errors.push(`capability ok case: ${capOk.errors.join('; ')}`);
const capBad = checkCapabilityClosure(
    {
        allowlist: ['fetchUser'],
        inputSchema: { type: 'object' },
        outputSchema: { type: 'object' },
        timeoutMs: 1000,
        cancelSupported: true,
        secrets: ['DATABASE_URL=postgres://x'],
    },
    contract.capability as Record<string, unknown>,
);
if (capBad.ok) errors.push('capability must reject client-visible secrets');

console.log('production-observability: CSP via CDN local-static…');
const staticManifestPath = path.join(dist, '_vmz', 'static-delivery-manifest.json');
let cspOk = false;
let cspDetail = '';
if (fs.existsSync(staticManifestPath)) {
    const staticManifest = JSON.parse(fs.readFileSync(staticManifestPath, 'utf8'));
    const basePolicy = buildCdnPolicyManifest(staticManifest);
    const secured = applySecurityHeadersToCdnPolicy(basePolicy, contract.security as Record<string, unknown>);
    const host = await listenLocalStaticHost(dist, secured, { host: '127.0.0.1', port: STATIC_PORT });
    try {
        const home = await get(`http://127.0.0.1:${STATIC_PORT}/`);
        const csp = String(home.headers['content-security-policy'] || '');
        if (home.status !== 200) {
            cspDetail = `status ${home.status}`;
        } else if (!csp.includes("default-src 'self'")) {
            cspDetail = `missing CSP: ${csp.slice(0, 120)}`;
        } else {
            cspOk = true;
            cspDetail = 'CSP on HTML via CDN policy';
        }
    } finally {
        await host.close();
    }
} else {
    // Fallback: build a minimal policy against existing index.html if static profile not present.
    const indexHtml = path.join(dist, 'index.html');
    if (!fs.existsSync(indexHtml)) {
        // materialize a tiny index for header proof
        fs.writeFileSync(indexHtml, '<!doctype html><title>obs</title>\n', 'utf8');
    }
    const secured = applySecurityHeadersToCdnPolicy(
        {
            schema: 'vmz.cdn.policy_manifest.v0',
            spaFallback: false,
            headers: [{ match: '**/*.html', headers: { 'cache-control': 'public, max-age=0, must-revalidate' } }],
            redirects: [],
            errorDocuments: [],
        },
        contract.security as Record<string, unknown>,
    );
    const host = await listenLocalStaticHost(dist, secured, { host: '127.0.0.1', port: STATIC_PORT });
    try {
        const home = await get(`http://127.0.0.1:${STATIC_PORT}/`);
        const csp = String(home.headers['content-security-policy'] || '');
        if (home.status === 200 && csp.includes("default-src 'self'")) {
            cspOk = true;
            cspDetail = 'CSP on HTML (fallback policy)';
        } else {
            cspDetail = `fallback CSP fail status=${home.status} csp=${csp.slice(0, 80)}`;
        }
    } finally {
        await host.close();
    }
}
if (!cspOk) errors.push(`CSP: ${cspDetail}`);

console.log('production-observability: health/ready on serve-host…');
const hostJs = path.join(dist, 'vmz-serve-host.mjs');
if (!fs.existsSync(hostJs)) fail(`missing serve-host ${hostJs}`);
const child = spawn(process.execPath, [hostJs], {
    cwd: dist,
    env: { ...process.env, VMZ_DIST: dist, VMZ_HOST: '127.0.0.1', VMZ_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
});
let healthOk = false;
let healthDetail = '';
try {
    await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('serve-host start timeout')), 8000);
        const onData = (buf: Buffer) => {
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

    const livePath = (contract.health as { livePath: string }).livePath;
    const readyPath = (contract.health as { readyPath: string }).readyPath;
    const live = await get(`http://127.0.0.1:${PORT}${livePath}`);
    const ready = await get(`http://127.0.0.1:${PORT}${readyPath}`);
    const liveBody = JSON.parse(live.body || '{}');
    const readyBody = JSON.parse(ready.body || '{}');
    if (live.status !== 200 || liveBody.status !== 'ok') {
        healthDetail = `health ${live.status} ${live.body.slice(0, 120)}`;
    } else if (ready.status !== 200 || readyBody.status !== 'ready') {
        healthDetail = `ready ${ready.status} ${ready.body.slice(0, 120)}`;
    } else {
        healthOk = true;
        healthDetail = `live+ready ok; shutdown policy timeoutMs=${
            (contract.health as { gracefulShutdown: { timeoutMs: number } }).gracefulShutdown.timeoutMs
        }`;
    }
} catch (e) {
    healthDetail = e instanceof Error ? e.message : String(e);
} finally {
    try {
        child.kill('SIGTERM');
    } catch {
        /* ignore */
    }
}
if (!healthOk) errors.push(`health: ${healthDetail}`);

const proof = readProof(root);
proof.performanceBudgets = {
    ...(contract.budgets as object),
    measured,
    digest: digestA,
};
proof.securityChecks = [
    {
        id: 'csp',
        status: cspOk ? 'passed' : 'failed',
        detail: cspDetail,
    },
    {
        id: 'redaction',
        status: redactedText.includes('hunter2') ? 'failed' : 'passed',
        detail: 'sensitive keys + Bearer tokens',
    },
    {
        id: 'capability-secret-closure',
        status: !capBad.ok && capOk.ok ? 'passed' : 'failed',
        detail: 'allowlist + schema + timeout + no client secrets',
    },
];

upsertCheck(proof, {
    id: 'production-observability.trace',
    status: traceCheck.ok ? 'passed' : 'failed',
    detail: `facets=${REQUIRED_TRACE_FACETS.length} covered`,
});
upsertCheck(proof, {
    id: 'production-observability.redaction',
    status: redactedText.includes('hunter2') ? 'failed' : 'passed',
    detail: 'deny-by-default sensitive keys',
});
upsertCheck(proof, {
    id: 'production-observability.security',
    status: cspOk ? 'passed' : 'failed',
    detail: cspDetail,
});
upsertCheck(proof, {
    id: 'production-observability.budget',
    status: budget.ok && !over.ok ? 'passed' : 'failed',
    detail: `artifactBytes=${measured.artifactBytes}`,
});
upsertCheck(proof, {
    id: 'production-observability.health',
    status: healthOk ? 'passed' : 'failed',
    detail: healthDetail,
});
upsertCheck(proof, {
    id: 'production-observability',
    status: errors.length ? 'failed' : 'passed',
    detail: emitted.contractPath,
});

const gaps = [
    'A5: dogfood staging fault injection (server error / slow / reload / stale artifact / locale chunk) not covered',
    'A5: live error-rate / latency dashboards + diagnostic sampling pipeline not covered',
    'A5: browser-enforced cookie/session namespace + nonce runtime binding not covered',
];
for (const g of gaps) addLimitation(proof, g);
proof.knownLimitations = proof.knownLimitations.filter(
    (l) => !l.includes('A5: production trace schema') && !l.includes('A5: sensitive-data redaction + performance budgets not gated'),
);

writeProof(proof, root);
if (errors.length) fail(errors.join('\n'));

console.log(`production-observability PASS: digest=${digestA.slice(0, 12)} budgets+CSP+health+redaction+trace facets`);
console.log('production-observability NOTE: dogfood staging fault injection / sampling dashboards still open');

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
