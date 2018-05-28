/**
 * Resume host for `vmz test --mode resume` (T2/T3 first slice).
 * SSR shell → resume adopt → event patch; onMount must not run.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveChunkArtifacts } from './compile.js';
import { installHeadlessDocument } from './logic.js';

type Diag = { severity: string; message: string; [k: string]: unknown };

export type ResumeResult = {
    status: 'passed' | 'failed' | 'error';
    diagnostics: Diag[];
    planId: string | null;
    programId: string | null;
};

export async function runResumeManifest(
    manifest: Record<string, unknown>,
    ctx: {
        outDir: string;
    },
): Promise<ResumeResult> {
    const diagnostics: Diag[] = [];
    const program = manifest.program && typeof manifest.program === 'object' ? (manifest.program as Record<string, unknown>) : {};
    const chunkId = String(program.chunkId || '');
    const programId = chunkId || null;
    const fail = (message: string, extra: Record<string, unknown> = {}) => {
        diagnostics.push({ severity: 'error', message, ...extra });
    };

    if (!chunkId) {
        fail('program.chunkId missing');
        return { status: 'error', diagnostics, planId: null, programId: null };
    }

    const arts = resolveChunkArtifacts(ctx.outDir, chunkId);
    if (!arts.clientPath) {
        fail(`missing ${chunkId}.client.js`);
        return { status: 'failed', diagnostics, planId: null, programId };
    }

    installHeadlessDocument();
    (globalThis as any).requestIdleCallback = (cb: (deadline: object) => void) =>
        setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 1 }), 0);

    let dom: any;
    let Page: any;
    try {
        dom = await import(pathToFileURL(path.join(ctx.outDir, 'vmz-dom.js')).href);
        Page = (await import(pathToFileURL(arts.clientPath).href)).default;
    } catch (e) {
        fail(`import dist: ${e instanceof Error ? e.message : String(e)}`);
        return { status: 'error', diagnostics, planId: null, programId };
    }

    const components =
        program.components && typeof program.components === 'object' ? (program.components as Record<string, string>) : undefined;
    const loaded: Record<string, any> = {};
    if (components) {
        for (const [name, chunk] of Object.entries(components)) {
            const cArts = resolveChunkArtifacts(ctx.outDir, chunk);
            if (!cArts.clientPath) {
                fail(`missing component ${chunk}`);
                continue;
            }
            loaded[name] = (await import(pathToFileURL(cArts.clientPath).href)).default;
        }
        dom.registerComponents(loaded);
    }

    let html = '';
    let island: Element | null = null;
    let inst: any = null;
    let buttonBefore: Element | null = null;
    let onMountHits = 0;
    let createHits = 0;
    const resumeTarget = String(program.resumeComponent || Object.keys(loaded)[0] || '');

    const actions = Array.isArray(manifest.actions) ? manifest.actions : [];
    for (const raw of actions) {
        const a = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
        const kind = String(a.kind || '');
        try {
            if (kind === 'ssr' || kind === 'renderToString') {
                const props = a.props && typeof a.props === 'object' ? (a.props as object) : {};
                html = await dom.renderToString(Page, props);
                continue;
            }
            if (kind === 'attachEventEntries') {
                if (!html) html = await dom.renderToString(Page, {});
                document.body.innerHTML = `<div id="app">${html}</div>`;
                const islandName = String(a.component || resumeTarget);
                island = document.querySelector(`[data-vmz-island="${islandName}"]`);
                if (!island) {
                    fail(`EventEntry host missing for ${islandName}`);
                    continue;
                }
                buttonBefore = island.querySelector('button');
                if (typeof dom.attachEventEntries !== 'function') {
                    fail('attachEventEntries missing from vmz-dom');
                    continue;
                }
                dom.attachEventEntries(document);
                continue;
            }
            if (kind === 'resumeIslands') {
                if (!html) html = await dom.renderToString(Page, {});
                document.body.innerHTML = `<div id="app">${html}</div>`;
                const islandName = String(a.component || resumeTarget);
                island = document.querySelector(`[data-vmz-island="${islandName}"]`);
                if (!island) {
                    fail(`island host missing for ${islandName}`);
                    continue;
                }
                buttonBefore = island.querySelector('button');
                dom.resumeIslands(document);
                continue;
            }
            if (kind === 'resume') {
                if (!html) html = await dom.renderToString(Page, {});
                document.body.innerHTML = `<div id="app">${html}</div>`;
                const islandName = String(a.component || resumeTarget);
                island = document.querySelector(`[data-vmz-island="${islandName}"]`);
                if (!island) {
                    fail(`island host missing for ${islandName}`);
                    continue;
                }
                buttonBefore = island.querySelector('button');
                const Comp = loaded[islandName];
                if (!Comp) {
                    fail(`resume component ${islandName} not registered`);
                    continue;
                }
                const prevMount = Comp.prototype.onMount;
                Comp.prototype.onMount = function (this: unknown) {
                    onMountHits += 1;
                    if (typeof prevMount === 'function') return prevMount.call(this);
                };
                const origCreate = Comp.__vmzCreate;
                Comp.__vmzCreate = function (this: unknown, api: unknown) {
                    createHits += 1;
                    return origCreate.call(this, api);
                };
                inst = await dom.resume(Comp, island);
                Comp.__vmzCreate = origCreate;
                Comp.prototype.onMount = prevMount;
                continue;
            }
            if (kind === 'clickHost' || kind === 'clickIsland') {
                const sel = typeof a.selector === 'string' ? a.selector : `[data-vmz-island="${String(a.component || resumeTarget)}"]`;
                const el = document.querySelector(sel) as HTMLElement | null;
                if (!el) {
                    fail(`clickHost: no ${sel}`);
                    continue;
                }
                island = el;
                el.click();
                // EventEntry resume is async via Promise.resolve(fn()).
                await Promise.resolve();
                await Promise.resolve();
                await new Promise((r) => setTimeout(r, Number(a.waitMs ?? 10)));
                inst = (el as any).__vmzInst || inst;
                continue;
            }
            if (kind === 'click') {
                const root = island || document.getElementById('app');
                const sel = typeof a.selector === 'string' ? a.selector : 'button';
                const el = root?.querySelector(sel) as HTMLElement | null;
                if (!el) {
                    fail(`click: no ${sel}`);
                    continue;
                }
                el.click();
                continue;
            }
            if (kind === 'flush') {
                if (!inst) {
                    fail('flush before resume');
                    continue;
                }
                await dom.flushPending(inst);
                continue;
            }
            if (kind === 'assert') {
                const assertion = String(a.assertion || 'html');
                const expect = a.expect && typeof a.expect === 'object' ? (a.expect as Record<string, unknown>) : {};
                if (assertion === 'html') {
                    if (expect.contains != null && !html.includes(String(expect.contains))) {
                        fail(`html contains want ${JSON.stringify(expect.contains)}`);
                    }
                    if (expect.notContains != null && html.includes(String(expect.notContains))) {
                        fail(`html notContains ${JSON.stringify(expect.notContains)}`);
                    }
                    continue;
                }
                if (assertion === 'resumed') {
                    const want = expect.value !== false;
                    const got = Boolean((island as any)?.__vmzResumed);
                    if (got !== want) fail(`__vmzResumed want ${want}, got ${got}`);
                    continue;
                }
                fail(`unknown resume assert ${assertion}`);
                continue;
            }
            fail(`unknown resume action ${JSON.stringify(kind)}`);
        } catch (e) {
            fail(`action ${kind}: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    const assertions = Array.isArray(manifest.assertions) ? manifest.assertions : [];
    for (const raw of assertions) {
        const a = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
        const kind = String(a.kind || '');
        const expect = a.expect && typeof a.expect === 'object' ? (a.expect as Record<string, unknown>) : {};

        if (kind === 'html') {
            if (expect.contains != null && !html.includes(String(expect.contains))) {
                fail(`html contains want ${JSON.stringify(expect.contains)}`);
            }
            continue;
        }
        if (kind === 'resumed') {
            const want = expect.value !== false;
            if (Boolean((island as any)?.__vmzResumed) !== want) {
                fail(`__vmzResumed want ${want}, got ${Boolean((island as any)?.__vmzResumed)}`);
            }
            continue;
        }
        if (kind === 'onMount') {
            const want = Number(expect.hits ?? 0);
            if (onMountHits !== want) fail(`onMount hits want ${want}, got ${onMountHits}`);
            continue;
        }
        if (kind === 'createOnce') {
            if (createHits !== 1) fail(`__vmzCreate want 1, got ${createHits}`);
            continue;
        }
        if (kind === 'nodeIdentity') {
            const after = island?.querySelector('button') ?? null;
            if (!buttonBefore || !after || after !== buttonBefore) {
                fail('button node identity changed on resume');
            }
            continue;
        }
        if (kind === 'text') {
            const text = island?.querySelector('button')?.textContent ?? island?.textContent ?? '';
            if (expect.contains != null && !text.includes(String(expect.contains))) {
                fail(`text contains want ${JSON.stringify(expect.contains)}, got ${JSON.stringify(text)}`);
            }
            if (Array.isArray(expect.containsAny)) {
                const ok = expect.containsAny.some((s) => text.includes(String(s)));
                if (!ok) {
                    fail(`text containsAny want ${JSON.stringify(expect.containsAny)}, got ${JSON.stringify(text)}`);
                }
            }
            continue;
        }
        if (kind === 'graph' || kind === 'plan' || kind === 'deployment' || kind === 'diagnostic') {
            continue;
        }
        fail(`unknown resume assertion ${JSON.stringify(kind)}`);
    }

    const failed = diagnostics.some((d) => d.severity === 'error');
    return {
        status: failed ? 'failed' : 'passed',
        diagnostics,
        planId: null,
        programId,
    };
}
