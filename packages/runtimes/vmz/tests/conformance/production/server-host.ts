/**
 * server-host — ServerArtifact emit + Fetch/Node parity + public/internal isolation
 * + worker-shaped Fetch subprocess live thin proof.
 * verify id: server-host
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { repoRoot } from '../_lib/repo-root.ts';
import { addLimitation, readProof, runVmzBuild, upsertCheck, writeProof } from '../_lib/production-proof.ts';

const root = repoRoot(import.meta.url);
const FIXTURE = 'packages/examples/fullstack';
const PORT_WORKER_LIVE = 18793;
const WORKER_HOST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '_lib', 'worker-fetch-host.mjs');

function fail(msg: string): never {
    console.error(`server-host FAIL: ${msg}`);
    process.exit(1);
}

function readJson(file: string): any {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function installServerResolver(setServerModuleResolver: (fn: (id: string) => string) => void, dist: string) {
    setServerModuleResolver((moduleId: string) => {
        const rel = moduleId.replace(/^#server\//, '');
        const candidates = [
            path.join(dist, '#server', `${rel}.js`),
            path.join(dist, '_vmz_server', `${rel}.js`),
        ];
        for (const c of candidates) {
            if (fs.existsSync(c)) return pathToFileURL(c).href;
        }
        throw new Error(`server module missing for ${moduleId}`);
    });
}

console.log('server-host: vmz build (fullstack web-ssr)…');
const build = runVmzBuild(FIXTURE, root);
if (build.status !== 0) {
    fail(`build failed:\n${build.stdout}\n${build.stderr}`);
}

const packPath = path.join(build.dist, '_vmz', 'pack-manifest.json');
const assemblePath = path.join(build.dist, '_vmz', 'assemble-manifest.json');
const proofPath = path.join(build.dist, '_vmz', 'build-proof.json');
const artifactPath = path.join(build.dist, '_vmz', 'server-artifact.json');
const workerAdapterPath = path.join(build.dist, '_vmz', 'adapters', 'worker', 'adapter.json');
const rustAdapterPath = path.join(build.dist, '_vmz', 'adapters', 'rust-host', 'adapter.json');

if (!fs.existsSync(packPath)) fail(`missing ${packPath}`);
if (!fs.existsSync(assemblePath)) fail(`missing ${assemblePath}`);
if (!fs.existsSync(proofPath)) fail(`missing ${proofPath}`);
if (!fs.existsSync(artifactPath)) fail(`missing ServerArtifact ${artifactPath}`);
if (!fs.existsSync(workerAdapterPath)) fail(`missing worker adapter projection`);
if (!fs.existsSync(rustAdapterPath)) fail(`missing rust-host adapter projection`);

const pack = readJson(packPath);
const assemble = readJson(assemblePath);
const buildProof = readJson(proofPath);
const artifact = readJson(artifactPath);
const workerAdapter = readJson(workerAdapterPath);
const rustAdapter = readJson(rustAdapterPath);
const routes = readJson(path.join(build.dist, 'vmz-routes.json'));

if (pack.schema !== 'vmz.pack.manifest.v0') fail(`bad pack schema ${pack.schema}`);
if (pack.bundler !== 'vmz-pack') fail('pack must use vmz-pack (not external Rollup)');
if (pack.treeShakeBasis !== 'vpg-deployment-ir') fail('treeShakeBasis must be vpg-deployment-ir');

if (assemble.assembly !== 'server-host') fail(`expected assembly server-host got ${assemble.assembly}`);
const serverStep = (assemble.steps || []).find((s: any) => s.kind === 'server-host');
if (!serverStep || serverStep.status !== 'emitted') fail('assemble must emit server-host ServerArtifact step');
if (!assemble.serverArtifact?.digest) fail('assemble.serverArtifact.digest missing');

if (buildProof.schema !== 'vmz.build.proof.v0') fail(`bad build-proof schema ${buildProof.schema}`);
if (!buildProof.semanticIds?.includes('server-host')) fail('build-proof missing server-host semantic id');
if (buildProof.slots?.['server-host']?.status !== 'emitted') {
    fail(`server-host slot status=${buildProof.slots?.['server-host']?.status}`);
}
if (buildProof.productionReadyClaim === true) fail('must not claim production-ready');

if (artifact.schema !== 'vmz.server.artifact.v0') fail(`bad ServerArtifact schema ${artifact.schema}`);
if (artifact.entry?.kind !== 'fetch') fail('ServerArtifact entry must be fetch');
if (!artifact.httpContract?.digest) fail('HttpContract digest missing');
if (artifact.artifactDigest !== assemble.serverArtifact.digest) {
    fail('ServerArtifact digest mismatch vs assemble');
}
if (!Array.isArray(artifact.publicRoutes) || artifact.publicRoutes.length < 1) {
    fail('expected public ServerRoute from fullstack @Get');
}
if (!Array.isArray(routes) || routes.length < 1) fail('vmz-routes.json empty');

const publicMe = artifact.publicRoutes.find(
    (r: any) => r.path === '/api/users/me' && String(r.verb).toUpperCase() === 'GET',
);
if (!publicMe) fail('public route GET /api/users/me missing');
if (publicMe.visibility !== 'public') fail('ServerRoute must be visibility=public');

const internalFetch = (artifact.internalCapabilities || []).find(
    (c: any) => c.method === 'fetchUser' && c.moduleId === '#server/components/UserCard',
);
if (!internalFetch) fail('internal capability fetchUser missing (public/internal isolation)');
if (internalFetch.visibility !== 'internal') fail('fetchUser must remain internal');
if ((artifact.publicRoutes || []).some((r: any) => r.method === 'fetchUser')) {
    fail('internal capability must not appear as public ServerRoute');
}

if (workerAdapter.schema !== 'vmz.server.runtime_adapter.v0') fail('worker adapter schema');
if (workerAdapter.invoke !== 'handleFetchRequest') fail('worker adapter must invoke handleFetchRequest');
if (workerAdapter.spaFallback !== false) fail('worker adapter spaFallback must be false');
if (workerAdapter.status !== 'runtime') fail('worker adapter must be runtime (live thin)');
if (!String(workerAdapter.note || '').includes('subprocess')) {
    fail(`worker adapter note must claim subprocess live thin, got ${workerAdapter.note}`);
}
if (rustAdapter.invoke !== 'fetch') fail('rust-host adapter projection entry');
if (rustAdapter.status !== 'projected') fail('rust-host must stay projected until live binary parity');
if (!Array.isArray(artifact.middlewareUnits) || artifact.middlewareUnits.length !== 0) {
    fail('middlewareUnits must be authoritative empty until contribution IR ships');
}

console.log('server-host: Node + Fetch (worker-shaped) route/error parity…');
const runtimeUrl = pathToFileURL(path.join(build.dist, 'vmz-runtime.js')).href;
const runtime = await import(runtimeUrl);
const { setServerModuleResolver, setRoutes, handleNodeRequest, handleFetchRequest } = runtime;
if (typeof handleFetchRequest !== 'function') fail('dist runtime missing handleFetchRequest');
installServerResolver(setServerModuleResolver, build.dist);
setRoutes(routes);

async function fetchViaNode(pathname: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
    const server = http.createServer((req, res) => {
        handleNodeRequest(req, res).catch((err: unknown) => {
            console.error(err);
            if (!res.headersSent) res.writeHead(500).end();
        });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const { port } = server.address() as { port: number };
    try {
        const res = await fetch(`http://127.0.0.1:${port}${pathname}`, init);
        const text = await res.text();
        let body: any = text;
        try {
            body = JSON.parse(text);
        } catch {
            /* keep text */
        }
        return { status: res.status, body };
    } finally {
        server.close();
    }
}

async function fetchViaWorker(pathname: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
    const request = new Request(`http://server-host.vmz.test${pathname}`, init);
    const response = await handleFetchRequest(request);
    const text = await response.text();
    let body: any = text;
    try {
        body = JSON.parse(text);
    } catch {
        /* keep text */
    }
    return { status: response.status, body };
}

const nodeOk = await fetchViaNode('/api/users/me');
const workerOk = await fetchViaWorker('/api/users/me');
if (nodeOk.status !== 200 || !nodeOk.body?.name) fail(`Node public route failed: ${JSON.stringify(nodeOk)}`);
if (workerOk.status !== 200 || !workerOk.body?.name) fail(`Fetch host public route failed: ${JSON.stringify(workerOk)}`);
if (nodeOk.body.name !== workerOk.body.name) {
    fail(`Node/Fetch parity mismatch: ${nodeOk.body.name} vs ${workerOk.body.name}`);
}

const nodeMiss = await fetchViaNode('/api/does-not-exist');
const workerMiss = await fetchViaWorker('/api/does-not-exist');
if (nodeMiss.status !== 404 || workerMiss.status !== 404) {
    fail(`404 parity failed node=${nodeMiss.status} worker=${workerMiss.status}`);
}
if (nodeMiss.body?.error !== 'not found' || workerMiss.body?.error !== 'not found') {
    fail('404 body parity failed');
}

const nodeRpc = await fetchViaNode('/__vmz/rpc', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
        moduleId: '#server/components/UserCard',
        method: 'fetchUser',
        args: [],
    }),
});
const workerRpc = await fetchViaWorker('/__vmz/rpc', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
        moduleId: '#server/components/UserCard',
        method: 'fetchUser',
        args: [],
    }),
});
if (nodeRpc.status !== 200 || workerRpc.status !== 200) fail('RPC parity status failed');
if (!nodeRpc.body?.name || nodeRpc.body.name !== workerRpc.body.name) fail('RPC body parity failed');

console.log('server-host: worker-shaped Fetch subprocess live thin…');
if (!fs.existsSync(WORKER_HOST)) fail(`missing ${WORKER_HOST}`);
const liveChild = spawn(process.execPath, [WORKER_HOST], {
    cwd: build.dist,
    env: { ...process.env, VMZ_DIST: build.dist, VMZ_PORT: String(PORT_WORKER_LIVE) },
    stdio: ['ignore', 'pipe', 'pipe'],
});
let liveDetail = '';
try {
    await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('worker-fetch-host start timeout')), 8000);
        const onData = (buf: Buffer) => {
            const s = String(buf);
            if (s.includes('vmz worker-fetch-host http://')) {
                clearTimeout(t);
                liveChild.stdout.off('data', onData);
                resolve();
            }
        };
        liveChild.stdout.on('data', onData);
        liveChild.stderr.on('data', (b) => process.stderr.write(b));
        liveChild.on('exit', (code) => {
            clearTimeout(t);
            reject(new Error(`worker-fetch-host exited early ${code}`));
        });
    });

    const liveOk = await getJson(`http://127.0.0.1:${PORT_WORKER_LIVE}/api/users/me`);
    const liveMiss = await getJson(`http://127.0.0.1:${PORT_WORKER_LIVE}/api/does-not-exist`);
    const liveRpc = await postJson(`http://127.0.0.1:${PORT_WORKER_LIVE}/__vmz/rpc`, {
        moduleId: '#server/components/UserCard',
        method: 'fetchUser',
        args: [],
    });
    if (liveOk.status !== 200 || liveOk.body?.name !== workerOk.body.name) {
        fail(`live worker public route failed: ${JSON.stringify(liveOk)}`);
    }
    if (liveMiss.status !== 404 || liveMiss.body?.error !== 'not found') {
        fail(`live worker 404 failed: ${JSON.stringify(liveMiss)}`);
    }
    if (liveRpc.status !== 200 || liveRpc.body?.name !== workerRpc.body.name) {
        fail(`live worker RPC failed: ${JSON.stringify(liveRpc)}`);
    }
    liveDetail = `subprocess Fetch host :${PORT_WORKER_LIVE} route/RPC/404 ≡ in-process`;
} finally {
    try {
        liveChild.kill('SIGTERM');
    } catch {
        /* ignore */
    }
}

const proof = readProof(root);
upsertCheck(proof, {
    id: 'server-host',
    status: 'passed',
    detail: `profile=${buildProof.profileId} artifact=${String(artifact.artifactDigest).slice(0, 12)}`,
});
upsertCheck(proof, {
    id: 'server-host.pack',
    status: 'passed',
    detail: `units=${pack.unitCount}`,
});
upsertCheck(proof, {
    id: 'server-host.artifact',
    status: 'passed',
    detail: `public=${artifact.publicRoutes.length} internal=${artifact.internalCapabilities.length} http=${String(artifact.httpContract.digest).slice(0, 12)}`,
});
upsertCheck(proof, {
    id: 'server-host.runtime-parity',
    status: 'passed',
    detail: 'Node handleNodeRequest ≡ Fetch handleFetchRequest on route/RPC/404',
});
upsertCheck(proof, {
    id: 'server-host.isolation',
    status: 'passed',
    detail: 'GET /api/users/me public; fetchUser internal-only',
});
upsertCheck(proof, {
    id: 'server-host.worker-live',
    status: 'passed',
    detail: liveDetail,
});
upsertCheck(proof, {
    id: 'server-host.middleware-boundary',
    status: 'passed',
    detail: 'middlewareUnits=[] authoritative; contribution IR deferred for this profile',
});

proof.knownLimitations = proof.knownLimitations.filter(
    (l) =>
        !l.includes('ServerArtifact / multi-runtime host parity still deepening') &&
        !l.includes('server-host: ServerArtifact') &&
        !l.includes('server-host: live Deno/Bun/Cloudflare Worker runtimes not covered (in-process Fetch parity only)') &&
        !l.includes('server-host: middleware contribution / CORS-CSRF-cache matrix not covered'),
);
addLimitation(
    proof,
    'server-host: Deno/Bun/Cloudflare workerd binary hosts still projected (Node + worker-shaped Fetch subprocess live thin covered)',
);
addLimitation(
    proof,
    'server-host: middleware contribution IR / CORS-CSRF-cache matrix deferred (middlewareUnits=[] is authoritative empty for this profile)',
);
addLimitation(proof, 'server-host: live Rust host binary parity not covered (contract projection only)');
writeProof(proof, root);

console.log(
    `server-host PASS: ServerArtifact + isolation + Node/Fetch parity + worker subprocess live (digest=${String(artifact.artifactDigest).slice(0, 12)})`,
);

async function getJson(url: string): Promise<{ status: number; body: any }> {
    const res = await fetch(url);
    const text = await res.text();
    let body: any = text;
    try {
        body = JSON.parse(text);
    } catch {
        /* keep */
    }
    return { status: res.status, body };
}

async function postJson(url: string, payload: unknown): Promise<{ status: number; body: any }> {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const text = await res.text();
    let body: any = text;
    try {
        body = JSON.parse(text);
    } catch {
        /* keep */
    }
    return { status: res.status, body };
}
