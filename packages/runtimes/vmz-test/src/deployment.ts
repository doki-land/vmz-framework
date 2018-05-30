/**
 * Deployment host for `vmz test --mode deployment` .
 * Proves deployment IR + server capability isolation (client stubs vs #server body).
 */

import fs from 'node:fs';
import path from 'node:path';

type Diag = { severity: string; message: string; [k: string]: unknown };

export type DeploymentResult = {
    status: 'passed' | 'failed' | 'error';
    diagnostics: Diag[];
    planId: string | null;
    programId: string | null;
};

function readJson(p: string): Record<string, unknown> | null {
    try {
        return JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
    } catch {
        return null;
    }
}

function resolveServerArtifact(outDir: string, moduleId: string): string | null {
    // moduleId like "#server/components/UserCard"
    const rel = moduleId.replace(/^#server\//, '').replace(/^\/+/, '');
    const candidates = [
        path.join(outDir, '#server', `${rel}.js`),
        path.join(outDir, '_vmz_server', `${rel}.js`),
        path.join(outDir, 'src', path.dirname(rel), `${path.basename(rel)}Server.server.js`),
        path.join(outDir, 'src', `${rel}.server.js`),
    ];
    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }
    return null;
}

export function runDeploymentManifest(manifest: Record<string, unknown>, ctx: { outDir: string }): DeploymentResult {
    const diagnostics: Diag[] = [];
    const fail = (message: string, extra: Record<string, unknown> = {}) => {
        diagnostics.push({ severity: 'error', message, ...extra });
    };

    const program = manifest.program && typeof manifest.program === 'object' ? (manifest.program as Record<string, unknown>) : {};
    const chunkId = String(program.chunkId || '');
    const programId = chunkId || null;
    const plan = manifest.plan && typeof manifest.plan === 'object' ? (manifest.plan as Record<string, unknown>) : {};
    const planId = plan.ref ? String(plan.ref) : plan.schema ? String(plan.schema) : null;

    const depPath = path.join(ctx.outDir, 'vmz-deployment.json');
    if (!fs.existsSync(depPath)) {
        fail('missing vmz-deployment.json');
        return { status: 'failed', diagnostics, planId, programId };
    }
    const deploy = readJson(depPath);
    if (!deploy) {
        fail('unreadable vmz-deployment.json');
        return { status: 'error', diagnostics, planId, programId };
    }

    const units = (deploy.units as Array<Record<string, unknown>>) || [];
    const unit =
        (chunkId && units.find((u) => String(u.chunkId || '') === chunkId)) ||
        (chunkId && units.find((u) => String(u.chunkId || '').includes(chunkId))) ||
        null;

    const assertions = Array.isArray(manifest.assertions) ? manifest.assertions : [];
    for (const raw of assertions) {
        const a = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
        const kind = String(a.kind || '');
        const expect = (a.expect && typeof a.expect === 'object' ? (a.expect as Record<string, unknown>) : {}) || {};

        if (kind === 'deploymentFile' || kind === 'deployment') {
            if (expect.schema != null && deploy.schema !== expect.schema) {
                fail(`deployment schema want ${expect.schema}, got ${deploy.schema}`);
            }
            if (expect.deploymentFileSchema != null && deploy.schema !== expect.deploymentFileSchema) {
                fail(`deployment schema want ${expect.deploymentFileSchema}, got ${deploy.schema}`);
            }
            if (expect.resumeComponent != null) {
                const name = String(expect.resumeComponent);
                const resumes =
                    (unit?.resumeEntries as Array<Record<string, unknown>>) || (unit?.resume_entries as Array<Record<string, unknown>>) || [];
                const hit = resumes.find((e) => (e.component || e.Component) === name);
                if (!hit) {
                    // also search all units
                    const any = units.some((u) => {
                        const rs = (u.resumeEntries as Array<Record<string, unknown>>) || [];
                        return rs.some((e) => e.component === name);
                    });
                    if (!any) fail(`resumeEntries missing ${name}`);
                } else if (expect.strategy != null && String(hit.strategy || '') !== String(expect.strategy)) {
                    fail(`resume strategy want ${expect.strategy}, got ${hit.strategy}`);
                }
            }
            continue;
        }

        if (kind === 'serverCapability') {
            const targetChunk = String(expect.chunkId || chunkId || '');
            const u = units.find((x) => String(x.chunkId || '') === targetChunk);
            if (!u) {
                fail(`deployment unit missing ${targetChunk}`);
                continue;
            }
            const moduleId = u.serverModuleId != null ? String(u.serverModuleId) : '';
            if (expect.serverModuleId != null && moduleId !== String(expect.serverModuleId)) {
                fail(`serverModuleId want ${expect.serverModuleId}, got ${moduleId || 'null'}`);
            }
            if (!moduleId) {
                fail(`unit ${targetChunk} has no serverModuleId`);
                continue;
            }
            const caps = (u.capabilities as string[]) || [];
            const wantCaps = Array.isArray(expect.capabilities) ? expect.capabilities.map(String) : [];
            for (const c of wantCaps) {
                if (!caps.includes(c)) fail(`capability missing ${c}: ${JSON.stringify(caps)}`);
            }
            continue;
        }

        if (kind === 'serverIsolation') {
            const targetChunk = String(expect.chunkId || chunkId || '');
            const u = units.find((x) => String(x.chunkId || '') === targetChunk);
            if (!u) {
                fail(`deployment unit missing ${targetChunk}`);
                continue;
            }
            const moduleId = u.serverModuleId != null ? String(u.serverModuleId) : '';
            if (!moduleId) {
                fail(`unit ${targetChunk} has no serverModuleId for isolation check`);
                continue;
            }
            const serverPath = resolveServerArtifact(ctx.outDir, moduleId);
            if (!serverPath) {
                fail(`server artifact missing for ${moduleId}`);
                continue;
            }
            const serverSrc = fs.readFileSync(serverPath, 'utf8');
            const clientEntry = u.clientEntry != null ? String(u.clientEntry) : `${targetChunk}.client.js`;
            const clientPath = path.join(ctx.outDir, clientEntry);
            if (!fs.existsSync(clientPath)) {
                fail(`client entry missing ${clientEntry}`);
                continue;
            }
            const clientSrc = fs.readFileSync(clientPath, 'utf8');

            // Server body must exist as a real module (not only a callServer stub file).
            if (!/export\s+(default\s+)?class\s+\w+/.test(serverSrc) && !/export\s+\{/.test(serverSrc)) {
                fail(`server artifact looks empty: ${path.relative(ctx.outDir, serverPath)}`);
            }

            // Client must route through callServer for declared capabilities (stub isolation).
            const caps = Array.isArray(expect.capabilities)
                ? expect.capabilities.map(String)
                : ((u.capabilities as string[]) || []).map(String);
            for (const c of caps) {
                if (!clientSrc.includes('callServer')) {
                    fail(`client entry missing callServer stub (${clientEntry})`);
                    break;
                }
                if (!clientSrc.includes(JSON.stringify(c)) && !clientSrc.includes(`"${c}"`) && !clientSrc.includes(`'${c}'`)) {
                    fail(`client stub missing capability name ${c}`);
                }
            }

            // Client must not embed the full server file content (naive leak check).
            const serverBodyMarker = serverSrc
                .split('\n')
                .map((l) => l.trim())
                .find((l) => l.startsWith('return ') || l.includes('Ada') || l.includes('profile'));
            if (serverBodyMarker && serverBodyMarker.length > 12 && clientSrc.includes(serverBodyMarker)) {
                fail(`client appears to embed server body marker: ${serverBodyMarker.slice(0, 80)}`);
            }
            continue;
        }

        if (kind === 'graph' || kind === 'plan' || kind === 'diagnostic') {
            continue;
        }

        fail(`unknown deployment assertion ${JSON.stringify(kind)}`);
    }

    // Optional actions are reserved (no runtime schedule for deployment IR checks).
    const actions = Array.isArray(manifest.actions) ? manifest.actions : [];
    for (const raw of actions) {
        const a = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
        const kind = String(a.kind || '');
        if (kind === 'noop' || kind === '') continue;
        fail(`unknown deployment action ${JSON.stringify(kind)}`);
    }

    const failed = diagnostics.some((d) => d.severity === 'error');
    return {
        status: failed ? 'failed' : 'passed',
        diagnostics,
        planId,
        programId,
    };
}
