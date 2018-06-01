/**
 * Logic-mode host — headless document (linkedom), same Direct __vmzCreate as production.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { resolveChunkArtifacts } from './compile.js';

const require = createRequire(import.meta.url);

function loadLinkedom(): { parseHTML: (html: string) => { window: any } } {
    try {
        return require('linkedom');
    } catch {
        throw new Error('linkedom not found (add dependency on @vmz/test)');
    }
}

export function installHeadlessDocument(): Document {
    const { parseHTML } = loadLinkedom();
    const { window } = parseHTML('<!DOCTYPE html><html><body><div id="app"></div></body></html>');
    (globalThis as any).window = window;
    (globalThis as any).document = window.document;
    (globalThis as any).HTMLElement = window.HTMLElement;
    (globalThis as any).Node = window.Node;
    (globalThis as any).DocumentFragment = window.DocumentFragment;
    (globalThis as any).Text = window.Text;
    (globalThis as any).Comment = window.Comment;
    return window.document;
}

export type LogicHost = {
    document: Document;
    app: Element;
    dom: any;
    Component: any;
    inst: any;
    lastPrecision: Record<string, unknown> | null;
    mount: (props?: object) => Promise<void>;
    click: (selector?: string) => void;
    write: (field: string, value: unknown) => void;
    flush: () => Promise<void>;
    destroy: () => void;
    precisionReset: () => void;
    precisionSnapshot: () => void;
};

export async function createLogicHost(opts: { outDir: string; chunkId: string; components?: Record<string, string> }): Promise<LogicHost> {
    const arts = resolveChunkArtifacts(opts.outDir, opts.chunkId);
    if (!arts.clientPath) {
        throw new Error(`missing ${opts.chunkId}.client.js under ${opts.outDir}`);
    }

    const document = installHeadlessDocument();
    const app = document.getElementById('app');
    if (!app) throw new Error('headless #app missing');

    const dom = await import(pathToFileURL(path.join(opts.outDir, 'vmz-dom.js')).href);
    const Component = (await import(pathToFileURL(arts.clientPath).href)).default;

    if (!Component?.__vmzDirect || typeof Component.__vmzCreate !== 'function') {
        throw new Error('logic host requires Direct __vmzCreate (rebuild with current compiler)');
    }

    if (opts.components && typeof dom.registerComponents === 'function') {
        const map: Record<string, any> = {};
        for (const [name, chunk] of Object.entries(opts.components)) {
            const cArts = resolveChunkArtifacts(opts.outDir, chunk);
            if (!cArts.clientPath) throw new Error(`registerComponents: missing ${chunk}.client.js`);
            map[name] = (await import(pathToFileURL(cArts.clientPath).href)).default;
        }
        dom.registerComponents(map);
    }

    if (typeof dom.__vmzPrecisionEnable === 'function') {
        dom.__vmzPrecisionEnable(true);
    }

    const host: LogicHost = {
        document,
        app,
        dom,
        Component,
        inst: null,
        lastPrecision: null,
        async mount(props = {}) {
            let createHits = 0;
            const orig = host.Component.__vmzCreate;
            host.Component.__vmzCreate = function (this: unknown, api: unknown) {
                createHits += 1;
                return orig.call(this, api);
            };
            host.inst = await host.dom.mount(host.Component, host.app, props);
            host.Component.__vmzCreate = orig;
            if (createHits !== 1) {
                throw new Error(`mount must call __vmzCreate once, got ${createHits}`);
            }
        },
        click(selector = 'button') {
            if (!host.inst) throw new Error('click before mount');
            const el = host.app.querySelector(selector);
            if (!el) throw new Error(`click: no element for ${JSON.stringify(selector)}`);
            (el as HTMLElement).click();
        },
        write(field, value) {
            if (!host.inst) throw new Error('write before mount');
            host.inst[field] = value;
        },
        async flush() {
            if (!host.inst) throw new Error('flush before mount');
            await host.dom.flushPending(host.inst);
        },
        destroy() {
            if (!host.inst) throw new Error('destroy before mount');
            host.dom.destroy(host.inst);
        },
        precisionReset() {
            if (typeof host.dom.__vmzPrecisionReset === 'function') host.dom.__vmzPrecisionReset();
        },
        precisionSnapshot() {
            if (typeof host.dom.__vmzPrecisionSnapshot === 'function') {
                host.lastPrecision = host.dom.__vmzPrecisionSnapshot();
            }
        },
    };

    return host;
}

type Diag = { severity: string; message: string; [k: string]: unknown };

export type LogicResult = {
    status: 'passed' | 'failed' | 'error';
    diagnostics: Diag[];
    planId: string | null;
    programId: string | null;
};

function runOneAssertion(a: Record<string, unknown>, host: LogicHost, fail: (message: string, extra?: Record<string, unknown>) => void) {
    const kind = String(a.kind || '');
    const expect = a.expect && typeof a.expect === 'object' ? (a.expect as Record<string, unknown>) : {};

    if (kind === 'text' || (kind === 'assert' && String(a.assertion || 'text') === 'text')) {
        const text = host.app.textContent ?? '';
        if (expect.equals != null && text !== String(expect.equals)) {
            fail(`text equals want ${JSON.stringify(expect.equals)}, got ${JSON.stringify(text)}`);
        }
        if (expect.contains != null && !text.includes(String(expect.contains))) {
            fail(`text contains want ${JSON.stringify(expect.contains)}, got ${JSON.stringify(text)}`);
        }
        if (expect.notContains != null && text.includes(String(expect.notContains))) {
            fail(`text notContains want absent ${JSON.stringify(expect.notContains)}, got ${JSON.stringify(text)}`);
        }
        return;
    }

    if (kind === 'state') {
        if (!host.inst) {
            fail('state assertion before mount');
            return;
        }
        for (const [k, v] of Object.entries(expect)) {
            if (host.inst[k] !== v) {
                fail(`state.${k} want ${JSON.stringify(v)}, got ${JSON.stringify(host.inst[k])}`);
            }
        }
        return;
    }

    if (kind === 'precision') {
        host.precisionSnapshot();
        const snap = host.lastPrecision || {};
        if (expect.minWrites != null && Number(snap.writes || 0) < Number(expect.minWrites)) {
            fail(`precision.writes want >= ${expect.minWrites}, got ${snap.writes}`);
        }
        if (expect.maxWrites != null && Number(snap.writes || 0) > Number(expect.maxWrites)) {
            fail(`precision.writes want <= ${expect.maxWrites}, got ${snap.writes}`);
        }
        if (expect.maxBindingEvals != null && Number(snap.bindingEvals || 0) > Number(expect.maxBindingEvals)) {
            fail(`precision.bindingEvals want <= ${expect.maxBindingEvals}, got ${snap.bindingEvals}`);
        }
        if (expect.maxPatchExecs != null && Number(snap.patchExecs || 0) > Number(expect.maxPatchExecs)) {
            fail(`precision.patchExecs want <= ${expect.maxPatchExecs}, got ${snap.patchExecs}`);
        }
        if (expect.patchesIncludeDep != null) {
            const dep = String(expect.patchesIncludeDep);
            const map = (snap.patchesByDep as Record<string, number>) || {};
            if (!map[dep]) {
                fail(`precision.patchesByDep missing ${dep}: ${JSON.stringify(map)}`);
            }
        }
        if (expect.writesIncludeRoot != null) {
            const rootKey = String(expect.writesIncludeRoot);
            const map = (snap.writesByRoot as Record<string, number>) || {};
            if (!map[rootKey]) {
                fail(`precision.writesByRoot missing ${rootKey}: ${JSON.stringify(map)}`);
            }
        }
        if (expect.patchesIncludeBinding != null) {
            const bid = String(expect.patchesIncludeBinding);
            const map = (snap.patchesByBinding as Record<string, number>) || {};
            if (!map[bid]) {
                fail(`precision.patchesByBinding missing ${bid}: ${JSON.stringify(map)}`);
            }
        }
        if (expect.bindingEvalsIncludeBinding != null) {
            const bid = String(expect.bindingEvalsIncludeBinding);
            const map = (snap.bindingEvalsByBinding as Record<string, number>) || {};
            if (!map[bid]) {
                fail(`precision.bindingEvalsByBinding missing ${bid}: ${JSON.stringify(map)}`);
            }
        }
        if (expect.domCreates === 0 || expect.domCreates === false) {
            if (Number(snap.domCreates || 0) !== 0) {
                fail(`precision.domCreates want 0 after action window, got ${snap.domCreates}`);
            }
        }
        return;
    }

    if (kind === 'destroyed') {
        if (!host.inst) {
            fail('destroyed assertion before mount');
            return;
        }
        const want = expect.value !== false;
        if (Boolean(host.inst.__vmzDestroyed) !== want) {
            fail(`__vmzDestroyed want ${want}, got ${host.inst.__vmzDestroyed}`);
        }
        return;
    }

    if (kind === 'exists') {
        const sel = String(expect.selector || '');
        if (!sel || !host.app.querySelector(sel)) {
            fail(`exists: missing ${JSON.stringify(sel)}`);
        }
        return;
    }

    if (kind === 'domKeys') {
        // Client Direct: `__vmzKey` expando. SSR HTML: `data-vmz-key` attr (expect.attr).
        const attr = expect.attr != null ? String(expect.attr) : null;
        const expando = expect.expando != null ? String(expect.expando) : attr ? null : '__vmzKey';
        let keys: string[] = [];
        if (attr) {
            keys = [...host.app.querySelectorAll(`[${attr}]`)].map((el) => String(el.getAttribute(attr)));
        } else if (expando) {
            keys = [...host.app.querySelectorAll('*')]
                .map((el) => (el as unknown as Record<string, unknown>)[expando])
                .filter((k) => k != null)
                .map((k) => String(k));
        }
        if (Array.isArray(expect.includes)) {
            for (const k of expect.includes) {
                if (!keys.includes(String(k))) fail(`domKeys missing ${k}: ${JSON.stringify(keys)}`);
            }
        }
        if (Array.isArray(expect.excludes)) {
            for (const k of expect.excludes) {
                if (keys.includes(String(k))) fail(`domKeys should exclude ${k}: ${JSON.stringify(keys)}`);
            }
        }
        return;
    }

    if (kind === 'childDestroyed') {
        const want = expect.value !== false;
        const child = (host as any)._capturedChild;
        if (!child) {
            fail('childDestroyed: no captured child (use capture_child action)');
            return;
        }
        if (Boolean(child.__vmzDestroyed) !== want) {
            fail(`child __vmzDestroyed want ${want}, got ${child.__vmzDestroyed}`);
        }
        return;
    }

    if (kind === 'graph' || kind === 'plan' || kind === 'diagnostic' || kind === 'view' || kind === 'motion') {
        return;
    }

    if (kind === 'assert') {
        // assertion kind nested: { kind: "assert", assertion: "text", expect: {...} }
        const nested = { ...a, kind: String(a.assertion || 'text') };
        runOneAssertion(nested, host, fail);
        return;
    }

    fail(`unknown assertion kind ${JSON.stringify(kind)}`);
}

export async function runLogicManifest(
    manifest: Record<string, unknown>,
    ctx: {
        outDir: string;
    },
): Promise<LogicResult> {
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

    let planId: string | null = null;
    const arts = resolveChunkArtifacts(ctx.outDir, chunkId);
    if (arts.programPath) {
        try {
            const prog = JSON.parse(fs.readFileSync(arts.programPath, 'utf8'));
            const unit = prog.units?.[0];
            if (unit?.plan?.schema) planId = String(unit.plan.schema);
        } catch {
            /* optional */
        }
    }

    const components =
        program.components && typeof program.components === 'object' ? (program.components as Record<string, string>) : undefined;

    let host: LogicHost;
    try {
        host = await createLogicHost({ outDir: ctx.outDir, chunkId, components });
    } catch (e) {
        fail(e instanceof Error ? e.message : String(e));
        return { status: 'error', diagnostics, planId, programId };
    }

    const actions = Array.isArray(manifest.actions) ? manifest.actions : [];
    for (const raw of actions) {
        const a = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
        const kind = String(a.kind || '');
        try {
            if (kind === 'mount') {
                const props = a.props && typeof a.props === 'object' ? (a.props as object) : {};
                await host.mount(props);
                continue;
            }
            if (kind === 'click') {
                host.click(typeof a.selector === 'string' ? a.selector : 'button');
                continue;
            }
            if (kind === 'write') {
                const field = String(a.field || '');
                if (!field) {
                    fail('write missing field');
                    continue;
                }
                host.write(field, a.value);
                continue;
            }
            if (kind === 'flush') {
                await host.flush();
                continue;
            }
            if (kind === 'destroy') {
                host.destroy();
                continue;
            }
            if (kind === 'precision_reset') {
                host.precisionReset();
                continue;
            }
            if (kind === 'precision_snapshot') {
                host.precisionSnapshot();
                continue;
            }
            if (kind === 'register_components') {
                const map = a.components && typeof a.components === 'object' ? (a.components as Record<string, string>) : {};
                const loaded: Record<string, any> = {};
                for (const [name, chunk] of Object.entries(map)) {
                    const cArts = resolveChunkArtifacts(ctx.outDir, chunk);
                    if (!cArts.clientPath) {
                        fail(`register_components: missing ${chunk}.client.js`);
                        continue;
                    }
                    loaded[name] = (await import(pathToFileURL(cArts.clientPath).href)).default;
                }
                host.dom.registerComponents(loaded);
                continue;
            }
            if (kind === 'stub_onMount') {
                if (!host.inst && !host.Component) {
                    fail('stub_onMount before component load');
                    continue;
                }
                const Comp = host.Component;
                Comp.prototype.onMount = async function () {};
                continue;
            }
            if (kind === 'capture_child') {
                const sel = String(a.selector || '');
                const el = host.app.querySelector(sel) as any;
                if (!el?.__vmzInst) {
                    fail(`capture_child: no inst for ${sel}`);
                    continue;
                }
                (host as any)._capturedChild = el.__vmzInst;
                continue;
            }
            if (kind === 'assert') {
                runOneAssertion(a, host, fail);
                continue;
            }
            fail(`unknown action kind ${JSON.stringify(kind)}`);
        } catch (e) {
            fail(`action ${kind}: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    host.precisionSnapshot();

    const assertions = Array.isArray(manifest.assertions) ? manifest.assertions : [];
    for (const raw of assertions) {
        const a = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
        runOneAssertion(a, host, fail);
    }

    const failed = diagnostics.some((d) => d.severity === 'error');
    return {
        status: failed ? 'failed' : 'passed',
        diagnostics,
        planId,
        programId,
    };
}
