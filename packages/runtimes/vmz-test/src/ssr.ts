/**
 * SSR / hydrate / stream host for `vmz test --mode ssr` .
 * Same Direct schedule as production via linkedom + renderToString / renderToStream / hydrate.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveChunkArtifacts } from './compile.js';
import { installHeadlessDocument } from './logic.js';

type Diag = { severity: string; message: string; [k: string]: unknown };

export type SsrResult = {
    status: 'passed' | 'failed' | 'error';
    diagnostics: Diag[];
    planId: string | null;
    programId: string | null;
};

export async function runSsrManifest(manifest: Record<string, unknown>, ctx: { outDir: string }): Promise<SsrResult> {
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
    let dom: any;
    let Component: any;
    try {
        dom = await import(pathToFileURL(path.join(ctx.outDir, 'vmz-dom.js')).href);
        Component = (await import(pathToFileURL(arts.clientPath).href)).default;
    } catch (e) {
        fail(`import dist: ${e instanceof Error ? e.message : String(e)}`);
        return { status: 'error', diagnostics, planId: null, programId };
    }

    const components =
        program.components && typeof program.components === 'object' ? (program.components as Record<string, string>) : undefined;
    if (components) {
        const map: Record<string, any> = {};
        for (const [name, chunk] of Object.entries(components)) {
            const cArts = resolveChunkArtifacts(ctx.outDir, chunk);
            if (!cArts.clientPath) {
                fail(`missing component ${chunk}`);
                continue;
            }
            map[name] = (await import(pathToFileURL(cArts.clientPath).href)).default;
        }
        dom.registerComponents(map);
    }

    let html = '';
    let streamChunks: string[] = [];
    let streamAborted = false;
    let streamPullGapsMs: number[] = [];
    let lastSsrProps: object = {};
    let app: Element | null = document.getElementById('app');
    let inst: any = null;
    let nodeBefore: Element | null = null;

    const actions = Array.isArray(manifest.actions) ? manifest.actions : [];
    for (const raw of actions) {
        const a = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
        const kind = String(a.kind || '');
        try {
            if (kind === 'ssr' || kind === 'renderToString') {
                const props = a.props && typeof a.props === 'object' ? (a.props as object) : {};
                lastSsrProps = props;
                html = await dom.renderToString(Component, props);
                streamChunks = [];
                streamAborted = false;
                streamPullGapsMs = [];
                continue;
            }
            if (kind === 'renderToStream' || kind === 'stream') {
                const props = a.props && typeof a.props === 'object' ? (a.props as object) : {};
                lastSsrProps = props;
                if (typeof dom.renderToStream !== 'function') {
                    fail('renderToStream missing from vmz-dom (rebuild example dist)');
                    continue;
                }
                streamChunks = [];
                streamAborted = false;
                streamPullGapsMs = [];
                const abortAfter = a.abortAfterChunks != null ? Number(a.abortAfterChunks) : NaN;
                const pullDelayMs = a.pullDelayMs != null ? Number(a.pullDelayMs) : 0;
                const ac = new AbortController();
                let lastPullAt = 0;
                for await (const chunk of dom.renderToStream(Component, props, {
                    signal: ac.signal,
                })) {
                    const now = Date.now();
                    if (lastPullAt > 0) streamPullGapsMs.push(now - lastPullAt);
                    lastPullAt = now;
                    streamChunks.push(String(chunk));
                    if (Number.isFinite(abortAfter) && streamChunks.length >= abortAfter) {
                        ac.abort();
                        streamAborted = true;
                        break;
                    }
                    if (pullDelayMs > 0) {
                        await new Promise((r) => setTimeout(r, pullDelayMs));
                    }
                }
                if (ac.signal.aborted) streamAborted = true;
                html = streamChunks.join('');
                continue;
            }
            if (kind === 'hydrate') {
                const props = a.props && typeof a.props === 'object' ? (a.props as object) : {};
                if (!html) {
                    html = await dom.renderToString(Component, props);
                }
                document.body.innerHTML = `<div id="app">${html}</div>`;
                app = document.getElementById('app');
                if (!app) {
                    fail('hydrate #app missing');
                    continue;
                }
                const sel = typeof a.identitySelector === 'string' ? a.identitySelector : 'button';
                nodeBefore = app.querySelector(sel);
                inst = await dom.hydrate(Component, app, props);
                continue;
            }
            if (kind === 'mount') {
                const props = a.props && typeof a.props === 'object' ? (a.props as object) : {};
                if (!app) app = document.getElementById('app');
                inst = await dom.mount(Component, app, props);
                continue;
            }
            if (kind === 'write') {
                if (!inst) {
                    fail('write before hydrate/mount');
                    continue;
                }
                inst[String(a.field || '')] = a.value;
                continue;
            }
            if (kind === 'flush') {
                if (!inst) {
                    fail('flush before hydrate/mount');
                    continue;
                }
                await dom.flushPending(inst);
                continue;
            }
            if (kind === 'click') {
                if (!app) {
                    fail('click before hydrate');
                    continue;
                }
                const sel = typeof a.selector === 'string' ? a.selector : 'button';
                const el = app.querySelector(sel) as HTMLElement | null;
                if (!el) {
                    fail(`click: no ${sel}`);
                    continue;
                }
                el.click();
                continue;
            }
            fail(`unknown ssr action ${JSON.stringify(kind)}`);
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
                fail(`html contains want ${JSON.stringify(expect.contains)}, got ${JSON.stringify(html)}`);
            }
            if (expect.notContains != null && html.includes(String(expect.notContains))) {
                fail(`html notContains ${JSON.stringify(expect.notContains)}`);
            }
            if (expect.equals != null && html !== String(expect.equals)) {
                fail(`html equals want ${JSON.stringify(expect.equals)}, got ${JSON.stringify(html)}`);
            }
            continue;
        }
        if (kind === 'stream') {
            if (streamChunks.length === 0 && !html && expect.aborted !== true) {
                fail('stream assertion without renderToStream action');
                continue;
            }
            if (expect.chunkCountMin != null && streamChunks.length < Number(expect.chunkCountMin)) {
                fail(`stream.chunkCountMin want >= ${expect.chunkCountMin}, got ${streamChunks.length}`);
            }
            if (expect.chunkCountMax != null && streamChunks.length > Number(expect.chunkCountMax)) {
                fail(`stream.chunkCountMax want <= ${expect.chunkCountMax}, got ${streamChunks.length}`);
            }
            if (expect.aborted === true && !streamAborted) {
                fail('stream.aborted want true, got false');
            }
            if (expect.aborted === false && streamAborted) {
                fail('stream.aborted want false, got true');
            }
            if (expect.pullGapMinMs != null) {
                const minGap = Number(expect.pullGapMinMs);
                const ok = streamPullGapsMs.some((g) => g >= minGap);
                if (!ok) {
                    fail(`stream.pullGapMinMs want >= ${minGap} between pulls, gaps=${JSON.stringify(streamPullGapsMs)}`);
                }
            }
            if (expect.equalsRenderToString === true) {
                const asString = await dom.renderToString(Component, lastSsrProps);
                if (html !== asString) {
                    fail(`stream join !== renderToString\nstream: ${JSON.stringify(html)}\nstring: ${JSON.stringify(asString)}`);
                }
            }
            if (expect.firstChunkContains != null) {
                const first = streamChunks[0] || '';
                if (!first.includes(String(expect.firstChunkContains))) {
                    fail(`stream.firstChunkContains want ${JSON.stringify(expect.firstChunkContains)}, got ${JSON.stringify(first)}`);
                }
            }
            continue;
        }
        if (kind === 'text') {
            const text = app?.textContent ?? '';
            if (expect.contains != null && !text.includes(String(expect.contains))) {
                fail(`text contains want ${JSON.stringify(expect.contains)}, got ${JSON.stringify(text)}`);
            }
            continue;
        }
        if (kind === 'nodeIdentity') {
            const sel = typeof expect.selector === 'string' ? expect.selector : 'button';
            const after = app?.querySelector(sel) ?? null;
            if (!nodeBefore || !after || after !== nodeBefore) {
                fail(`nodeIdentity failed for ${sel}`);
            }
            continue;
        }
        if (kind === 'graph' || kind === 'plan' || kind === 'view' || kind === 'diagnostic') {
            continue;
        }
        fail(`unknown ssr assertion ${JSON.stringify(kind)}`);
    }

    const failed = diagnostics.some((d) => d.severity === 'error');
    return {
        status: failed ? 'failed' : 'passed',
        diagnostics,
        planId: null,
        programId,
    };
}
