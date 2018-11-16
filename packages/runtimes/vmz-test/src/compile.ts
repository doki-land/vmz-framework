/**
 * Compile-mode host for `vmz test` / `@vmz/test` (+).
 * Builds the project and checks graph/plan/view assertions against dist artifacts.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveDeliveryServeRoot } from './delivery-serve-root.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRootGuess = path.resolve(packageRoot, '../../..');

export type CreateWorkspaceFn = (opts: { root: string; outDir: string }) => {
    build: (clean: boolean) => { diagnostics?: Array<{ severity?: string; level?: string }> };
    dispose: () => void;
};

export type BuildOptions = {
    createWorkspace?: CreateWorkspaceFn;
    repoRoot?: string;
    /** Hint for nested `profiles.*.name` when resolving the serve/artifact root. */
    deliveryName?: string | null;
};

export type BuildResult =
    | { ok: true; outDir: string; diagnostics: unknown[] }
    | { ok: false; outDir: string; diagnostics: unknown[]; error: string };

function finishBuildOutDir(dist: string, deliveryName?: string | null): string {
    return resolveDeliveryServeRoot(dist, deliveryName);
}

/** Build project for compile/logic evidence. Prefers N-API `createWorkspace`, else Node `@vmz/vmz`. */
export function buildForCompile(project: string, outDir?: string, options: BuildOptions = {}): BuildResult {
    const dist = outDir || fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-test-compile-'));
    if (!fs.existsSync(dist)) fs.mkdirSync(dist, { recursive: true });

    const repoRoot = options.repoRoot || repoRootGuess;
    const vmzJs = path.join(repoRoot, 'packages', 'runtimes', 'vmz', 'bin', 'vmz.js');

    if (options.createWorkspace) {
        try {
            const ws = options.createWorkspace({ root: project, outDir: dist });
            try {
                const report = ws.build(false);
                const diags = report.diagnostics ?? [];
                const errors = diags.filter((d) => d && (d.severity === 'error' || d.level === 'error'));
                if (errors.length) {
                    return {
                        ok: false,
                        outDir: dist,
                        diagnostics: diags,
                        error: 'workspace build reported errors',
                    };
                }
                return { ok: true, outDir: finishBuildOutDir(dist, options.deliveryName), diagnostics: diags };
            } finally {
                ws.dispose();
            }
        } catch (e) {
            return {
                ok: false,
                outDir: dist,
                diagnostics: [],
                error: `build failed: ${e instanceof Error ? e.message : String(e)}`,
            };
        }
    }

    if (fs.existsSync(vmzJs)) {
        const run = spawnSync(process.execPath, [vmzJs, 'build', project, '--out-dir', dist], {
            cwd: repoRoot,
            encoding: 'utf8',
        });
        if (run.status === 0) {
            return { ok: true, outDir: finishBuildOutDir(dist, options.deliveryName), diagnostics: [] };
        }
        return {
            ok: false,
            outDir: dist,
            diagnostics: [],
            error: `build failed via @vmz/vmz (exit ${run.status}): ${run.stderr || run.stdout || ''}`.trim(),
        };
    }

    return {
        ok: false,
        outDir: dist,
        diagnostics: [],
        error: 'build failed: no createWorkspace provided and packages/runtimes/vmz/bin/vmz.js missing',
    };
}

export function resolveChunkArtifacts(dist: string, chunkId: string) {
    const rel = chunkId.replace(/\\/g, '/');
    const programPath = path.join(dist, `${rel}.program.json`);
    const clientPath = path.join(dist, `${rel}.client.js`);
    return {
        programPath: fs.existsSync(programPath) ? programPath : null,
        clientPath: fs.existsSync(clientPath) ? clientPath : null,
    };
}

type Diag = { severity: string; kind?: string; message: string; expect?: unknown };

function collectViewKinds(nodes: unknown[] | undefined, kinds: Set<string>, flags: { each: boolean }) {
    for (const raw of nodes ?? []) {
        if (!raw || typeof raw !== 'object') continue;
        const n = raw as Record<string, unknown>;
        if (typeof n.kind === 'string') kinds.add(n.kind);
        if (n.each) flags.each = true;
        if (Array.isArray(n.children)) collectViewKinds(n.children as unknown[], kinds, flags);
        if (Array.isArray(n.branches)) {
            for (const b of n.branches as Array<Record<string, unknown>>) {
                if (b?.body) collectViewKinds([b.body], kinds, flags);
            }
        }
    }
}

export type CompileResult = {
    status: 'passed' | 'failed' | 'error';
    diagnostics: Diag[];
    planId: string | null;
    programId: string | null;
};

export function runCompileManifest(manifest: Record<string, unknown>, ctx: { outDir: string }): CompileResult {
    const diagnostics: Diag[] = [];
    const program = manifest.program && typeof manifest.program === 'object' ? (manifest.program as Record<string, unknown>) : {};
    const chunkId = String(program.chunkId || '');
    const programId = chunkId || null;

    if (!chunkId) {
        return {
            status: 'error',
            diagnostics: [{ severity: 'error', message: 'program.chunkId missing' }],
            planId: null,
            programId: null,
        };
    }

    const arts = resolveChunkArtifacts(ctx.outDir, chunkId);
    if (!arts.programPath) {
        return {
            status: 'failed',
            diagnostics: [
                {
                    severity: 'error',
                    message: `missing ${chunkId}.program.json under ${ctx.outDir}`,
                },
            ],
            planId: null,
            programId,
        };
    }

    let prog: Record<string, unknown>;
    try {
        prog = JSON.parse(fs.readFileSync(arts.programPath, 'utf8'));
    } catch (e) {
        return {
            status: 'error',
            diagnostics: [
                {
                    severity: 'error',
                    message: `parse program.json: ${e instanceof Error ? e.message : String(e)}`,
                },
            ],
            planId: null,
            programId,
        };
    }

    const units = (prog.units as Array<Record<string, unknown>>) || [];
    const unit =
        units.find((u) => u && (u.name === program.unitName || u.chunkId === chunkId || String(u.chunk_id || '') === chunkId)) || units[0];

    if (!unit) {
        diagnostics.push({ severity: 'error', message: 'program.json has no units' });
        return { status: 'failed', diagnostics, planId: null, programId };
    }

    const plan = (unit.plan as Record<string, unknown> | null) || null;
    const planId = plan?.schema ? String(plan.schema) : null;
    const clientJs = arts.clientPath ? fs.readFileSync(arts.clientPath, 'utf8') : '';
    const view = (unit.view as Record<string, unknown> | null) || null;

    const assertions = Array.isArray(manifest.assertions) ? manifest.assertions : [];
    for (const raw of assertions) {
        const a = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
        const kind = String(a.kind || '');
        const expect = a.expect && typeof a.expect === 'object' ? (a.expect as Record<string, unknown>) : {};
        const fail = (message: string) => {
            diagnostics.push({ severity: 'error', kind, message, expect });
        };

        if (kind === 'plan') {
            if (expect.schema != null) {
                if (!plan || plan.schema !== expect.schema) {
                    fail(`plan.schema want ${expect.schema}, got ${plan?.schema}`);
                }
            }
            if (expect.status != null) {
                if (!plan || plan.status !== expect.status) {
                    fail(`plan.status want ${expect.status}, got ${plan?.status}`);
                }
            }
            if (expect.nonEmpty === true) {
                if (!plan || !Array.isArray(plan.nodes) || plan.nodes.length === 0) {
                    fail('plan.nodes empty');
                }
                if (!plan || !Array.isArray(plan.root_ids) || plan.root_ids.length === 0) {
                    fail('plan.root_ids empty');
                }
            }
            if (Array.isArray(expect.kinds)) {
                const have = new Set(
                    (
                        (plan?.nodes as Array<{
                            kind?: string;
                        }>) || []
                    ).map((n) => String(n.kind || '')),
                );
                for (const k of expect.kinds) {
                    if (!have.has(String(k))) fail(`plan.nodes missing kind ${k}: ${[...have]}`);
                }
            }
            if (expect.anyStructuralKind === true) {
                const have = new Set(
                    (
                        (plan?.nodes as Array<{
                            kind?: string;
                        }>) || []
                    ).map((n) => String(n.kind || '')),
                );
                if (!have.has('element') && !have.has('interp') && !have.has('text')) {
                    fail(`plan missing structural kinds: ${[...have]}`);
                }
            }
            if (expect.nodeIdsInClient === true || typeof expect.nodeIdsInClient === 'number') {
                if (!arts.clientPath) {
                    fail(`missing ${chunkId}.client.js`);
                } else {
                    const nodes = (plan?.nodes as Array<{ id?: number | string }>) || [];
                    const n = typeof expect.nodeIdsInClient === 'number' ? expect.nodeIdsInClient : Math.min(3, nodes.length);
                    for (const node of nodes.slice(0, n)) {
                        const id = node.id;
                        if (id == null || !clientJs.includes(`id:${id}`)) {
                            fail(`__vmzPlan missing node id ${id}`);
                        }
                    }
                }
            }
            continue;
        }

        if (kind === 'view') {
            if (expect.status != null) {
                if (!view || view.status !== expect.status) {
                    fail(`view.status want ${expect.status}, got ${view?.status}`);
                }
            }
            if (expect.nonEmptyRoots === true) {
                if (!view || !Array.isArray(view.roots) || view.roots.length === 0) {
                    fail('view.roots empty');
                }
            }
            const kinds = new Set<string>();
            const flags = { each: false };
            collectViewKinds(view?.roots as unknown[] | undefined, kinds, flags);
            if (Array.isArray(expect.kinds)) {
                for (const k of expect.kinds) {
                    if (!kinds.has(String(k))) fail(`view missing kind=${k}: ${[...kinds]}`);
                }
            }
            if (expect.hasEach === true && !flags.each) {
                fail('view missing each on element');
            }
            continue;
        }

        if (kind === 'graph') {
            const unitGraph = (unit.graph as Record<string, unknown> | null) || null;
            const needsClient =
                expect.direct ||
                expect.create ||
                expect.plan ||
                expect.serialize ||
                expect.noRender ||
                expect.noRenderFallback ||
                expect.includes ||
                expect.includesAll ||
                expect.includesAny;
            if (needsClient && !arts.clientPath) {
                fail(`missing ${chunkId}.client.js`);
                continue;
            }
            if (arts.clientPath) {
                if (expect.direct === true && !clientJs.includes('__vmzDirect = true')) {
                    fail('missing __vmzDirect = true');
                }
                if (expect.create === true && !clientJs.includes('__vmzCreate')) {
                    fail('missing __vmzCreate');
                }
                if (expect.plan === true) {
                    // Plan identity is *.program.json; client `__vmzPlan` embed is opt-in (VMZ_EMIT_PLAN).
                    const hasClientPlan = clientJs.includes('__vmzPlan');
                    const hasProgramPlan = typeof prog.schema === 'string' || Boolean(arts.programPath) || Boolean(plan);
                    if (!hasClientPlan && !hasProgramPlan) {
                        fail('missing plan (client __vmzPlan or *.program.json)');
                    }
                }
                if (expect.serialize === true && !clientJs.includes('__vmzSerialize')) {
                    fail('missing __vmzSerialize');
                }
                if (expect.noRender === true || expect.noRenderFallback === true) {
                    if (clientJs.includes('prototype.render')) {
                        fail('production client must not emit prototype.render (production Direct emit)');
                    }
                }
                if (typeof expect.includes === 'string' && !clientJs.includes(expect.includes)) {
                    fail(`client.js missing substring ${JSON.stringify(expect.includes)}`);
                }
                if (Array.isArray(expect.includesAll)) {
                    for (const s of expect.includesAll) {
                        if (!clientJs.includes(String(s))) {
                            fail(`client.js missing substring ${JSON.stringify(s)}`);
                        }
                    }
                }
                if (Array.isArray(expect.includesAny)) {
                    const ok = expect.includesAny.some((s) => clientJs.includes(String(s)));
                    if (!ok) fail(`client.js missing any of ${JSON.stringify(expect.includesAny)}`);
                }
            }
            if (expect.ownsUnitToRegion === true) {
                const edges = (unitGraph?.edges as Array<Record<string, unknown>>) || [];
                const owns = edges.filter((e) => e.kind === 'owns');
                const hit = owns.some((e) => String(e.from).startsWith('unit:') && String(e.to).startsWith('region:'));
                if (!hit) fail(`missing owns unit→region edges: ${JSON.stringify(owns)}`);
            }
            if (expect.disposesMin != null) {
                const edges = (unitGraph?.edges as Array<Record<string, unknown>>) || [];
                const n = edges.filter((e) => e.kind === 'disposes').length;
                if (n < Number(expect.disposesMin)) {
                    fail(`disposes edges want >= ${expect.disposesMin}, got ${n}`);
                }
            }
            if (typeof expect.unknownsVia === 'string') {
                const unknowns = (unitGraph?.unknowns as Array<Record<string, unknown>>) || [];
                const via = String(expect.unknownsVia);
                const hits = unknowns.filter((u) => u.via === via);
                if (!hits.length) fail(`graph.unknowns missing via ${via}`);
                if (expect.unknownReason != null) {
                    if (!hits.some((u) => u.reason === expect.unknownReason)) {
                        fail(`unknown reason want ${expect.unknownReason}: ${JSON.stringify(hits)}`);
                    }
                }
                if (expect.unknownReasonNot === true || expect.unknownReasonNot === 'ir_unknown') {
                    if (!hits.every((u) => u.reason && u.reason !== 'ir_unknown')) {
                        fail(`opaque reasons must be specific: ${JSON.stringify(hits)}`);
                    }
                }
            }
            continue;
        }

        if (kind === 'analysis') {
            const unitGraph = (unit.graph as Record<string, unknown> | null) || null;
            const analysis = (unitGraph?.analysis as Record<string, unknown> | null) || null;
            if (!analysis || typeof analysis.exact !== 'number') {
                fail(`missing graph.analysis: ${JSON.stringify(unitGraph)}`);
                continue;
            }
            if (expect.exactMin != null && Number(analysis.exact) < Number(expect.exactMin)) {
                fail(`analysis.exact want >= ${expect.exactMin}, got ${analysis.exact}`);
            }
            if (expect.widenedMin != null && Number(analysis.widened || 0) < Number(expect.widenedMin)) {
                fail(`analysis.widened want >= ${expect.widenedMin}, got ${analysis.widened}`);
            }
            if (expect.unknownMin != null && Number(analysis.unknown || 0) < Number(expect.unknownMin)) {
                fail(`analysis.unknown want >= ${expect.unknownMin}, got ${analysis.unknown}`);
            }
            if (expect.callEdgesMin != null && Number(analysis.call_edges || 0) < Number(expect.callEdgesMin)) {
                fail(`analysis.call_edges want >= ${expect.callEdgesMin}, got ${analysis.call_edges}`);
            }
            if (expect.widenedOrUnknownMin != null) {
                const sum = Number(analysis.widened || 0) + Number(analysis.unknown || 0);
                if (sum < Number(expect.widenedOrUnknownMin)) {
                    fail(`widened+unknown want >= ${expect.widenedOrUnknownMin}, got ${sum}`);
                }
            }
            continue;
        }

        if (kind === 'reactive') {
            const reactive = (unit.reactive as Record<string, unknown> | null) || null;
            const effects = (reactive?.effects as Array<Record<string, unknown>>) || [];
            const name = expect.effect != null ? String(expect.effect) : '';
            const effect = name ? effects.find((e) => e.name === name) : null;
            if (name && !effect) {
                fail(`missing reactive effect ${name}`);
                continue;
            }
            if (effect && expect.writesInclude != null) {
                const needle = String(expect.writesInclude);
                const raw = JSON.stringify(effect);
                if (!raw.includes(needle)) fail(`effect ${name} must write ${needle}: ${raw}`);
            }
            if (effect && expect.opaqueCallee === true && !effect.opaque_callee) {
                fail(`effect ${name} must be opaque: ${JSON.stringify(effect)}`);
            }
            if (effect && Array.isArray(expect.starReasons)) {
                const reasons = (effect.star_reasons as Array<Record<string, unknown>>) || [];
                for (const want of expect.starReasons as Array<Record<string, unknown>>) {
                    const hit = reasons.some(
                        (r) => (want.field == null || r.field === want.field) && (want.reason == null || r.reason === want.reason),
                    );
                    if (!hit) {
                        fail(`star_reasons missing ${JSON.stringify(want)}: ${JSON.stringify(reasons)}`);
                    }
                }
            }
            continue;
        }

        if (kind === 'lifetime') {
            const life = (unit.lifetime as Record<string, unknown> | null) || null;
            if (expect.status != null) {
                if (!life || life.status !== expect.status) {
                    fail(`lifetime.status want ${expect.status}, got ${life?.status}`);
                }
            }
            if (expect.nonEmptyRegions === true) {
                if (!life || !Array.isArray(life.regions) || life.regions.length === 0) {
                    fail('lifetime.regions empty');
                }
            }
            if (Array.isArray(expect.regionKinds)) {
                const have = new Set(
                    (
                        (life?.regions as Array<{
                            kind?: string;
                        }>) || []
                    ).map((r) => String(r.kind || '')),
                );
                for (const k of expect.regionKinds) {
                    if (!have.has(String(k))) fail(`lifetime missing region kind=${k}: ${[...have]}`);
                }
            }
            if (expect.hasDisposeRegion === true) {
                const nodes = ((plan?.nodes as Array<Record<string, unknown>>) || []).filter((n) => n.kind === 'dispose-region');
                if (!nodes.length) fail('plan missing dispose-region nodes');
                for (const d of nodes) {
                    if (d.region == null) fail(`dispose-region missing region: ${JSON.stringify(d)}`);
                }
            }
            if (expect.disposeTag != null) {
                const nodes = ((plan?.nodes as Array<Record<string, unknown>>) || []).filter((n) => n.kind === 'dispose-region');
                // Wire field is `source` (`if` | `each`); accept legacy `tag` if present.
                if (!nodes.some((n) => n.source === expect.disposeTag || n.tag === expect.disposeTag)) {
                    fail(`dispose-region missing source=${expect.disposeTag}: ${JSON.stringify(nodes)}`);
                }
            }
            continue;
        }

        if (kind === 'motion') {
            const motion = (unit.motion as Record<string, unknown> | null) || null;
            const transitions = (motion?.transitions as Array<Record<string, unknown>>) || [];
            const edges = ((unit.graph as Record<string, unknown> | null)?.edges as Array<Record<string, unknown>>) || [];
            if (expect.status != null) {
                if (!motion || motion.status !== expect.status) {
                    fail(`motion.status want ${expect.status}, got ${motion?.status}`);
                }
            }
            if (expect.nonEmpty === true && transitions.length === 0) {
                fail('motion.transitions empty');
            }
            if (Array.isArray(expect.kinds)) {
                const have = new Set(transitions.map((t) => String(t.kind || '')));
                for (const k of expect.kinds) {
                    if (!have.has(String(k))) fail(`motion missing kind=${k}: ${[...have]}`);
                }
            }
            if (typeof expect.token === 'string') {
                if (!transitions.some((t) => t.token === expect.token)) {
                    fail(`motion missing token=${expect.token}: ${JSON.stringify(transitions)}`);
                }
            }
            if (Array.isArray(expect.tokens)) {
                for (const tok of expect.tokens) {
                    if (!transitions.some((t) => t.token === tok)) {
                        fail(`motion missing token=${tok}: ${JSON.stringify(transitions)}`);
                    }
                }
            }
            if (expect.cancelable === true) {
                if (!transitions.some((t) => t.cancelable === true)) {
                    fail(`motion missing cancelable transition: ${JSON.stringify(transitions)}`);
                }
            }
            if (expect.generation === true) {
                if (!transitions.some((t) => t.generation === true)) {
                    fail(`motion missing generation transition: ${JSON.stringify(transitions)}`);
                }
            }
            if (typeof expect.reducedMotion === 'string') {
                if (!transitions.every((t) => t.reduced_motion === expect.reducedMotion)) {
                    fail(`motion.reduced_motion want ${expect.reducedMotion}: ${JSON.stringify(transitions)}`);
                }
            }
            if (expect.hasRegion === true) {
                if (!transitions.some((t) => t.region != null)) {
                    fail(`motion missing region on transitions: ${JSON.stringify(transitions)}`);
                }
            }
            if (expect.affectsRegion === true) {
                const hit = edges.some(
                    (e) => e.kind === 'affects' && String(e.from).startsWith('motion:') && String(e.to).startsWith('region:'),
                );
                if (!hit)
                    fail(`missing motion→region affects edges: ${JSON.stringify(edges.filter((e) => String(e.from).startsWith('motion:')))}`);
            }
            if (Array.isArray(expect.cancelsFrom)) {
                for (const from of expect.cancelsFrom) {
                    const hit = edges.some((e) => e.kind === 'cancels' && e.from === from && String(e.to).startsWith('motion:'));
                    if (!hit) fail(`missing cancels from ${from}: ${JSON.stringify(edges.filter((e) => e.kind === 'cancels'))}`);
                }
            }
            if (expect.planMotionTransition === true) {
                const nodes = ((plan?.nodes as Array<Record<string, unknown>>) || []).filter((n) => n.kind === 'motion_transition');
                if (!nodes.length) fail('plan missing motion_transition nodes');
            }
            continue;
        }

        if (kind === 'deployment') {
            const deployment = (unit.deployment as Record<string, unknown> | null) || null;
            const entries =
                (deployment?.resume_entries as Array<Record<string, unknown>>) ||
                (deployment?.resumeEntries as Array<Record<string, unknown>>) ||
                [];
            if (expect.resumeComponent != null) {
                const name = String(expect.resumeComponent);
                const hit = entries.find((e) => (e.component || e.Component) === name);
                if (!hit) {
                    fail(`resume entry missing ${name}: ${JSON.stringify(entries)}`);
                } else if (expect.strategy != null && (hit.strategy || '') !== expect.strategy) {
                    fail(`resume strategy want ${expect.strategy}, got ${hit.strategy}`);
                }
            }
            if (expect.deploymentFileSchema != null) {
                const depPath = path.join(ctx.outDir, 'vmz-deployment.json');
                if (!fs.existsSync(depPath)) {
                    fail('missing vmz-deployment.json');
                } else {
                    const deploy = JSON.parse(fs.readFileSync(depPath, 'utf8'));
                    if (deploy.schema !== expect.deploymentFileSchema) {
                        fail(`deployment schema want ${expect.deploymentFileSchema}, got ${deploy.schema}`);
                    }
                    if (expect.deploymentResumeComponent != null) {
                        const name = String(expect.deploymentResumeComponent);
                        const unitsDep = (deploy.units as Array<Record<string, unknown>>) || [];
                        const chunk = unitsDep.find((u) => String(u.chunkId || '').includes(String(expect.deploymentChunkIncludes || chunkId)));
                        const resumes = (chunk?.resumeEntries as Array<Record<string, unknown>>) || [];
                        if (!resumes.some((e) => e.component === name)) {
                            fail(`deployment resumeEntries missing ${name}: ${JSON.stringify(resumes)}`);
                        }
                    }
                }
            }
            continue;
        }

        if (kind === 'diagnostic') {
            continue;
        }

        fail(`unknown assertion kind ${JSON.stringify(kind)}`);
    }

    const failed = diagnostics.some((d) => d.severity === 'error');
    return {
        status: failed ? 'failed' : 'passed',
        diagnostics,
        planId,
        programId,
    };
}
