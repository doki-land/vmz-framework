import path from 'node:path';
import { describe, it } from 'node:test';
import { expect } from '../../../../scripts/test/expect.mjs';
import { exampleDist, importDist, installDocument, installServerResolver, loadDom, loadRuntime, readJson } from '@vmz-examples/test-utils';

const dist = exampleDist('fullstack');

type Slot = { id: number; name: string };
type ReactiveComp = {
    state_slots: Slot[];
    properties: Slot[];
    exprs: Array<{ id: number; text: string }>;
    bindings: Array<{ id: number; kind: string; reads: unknown[] }>;
};

function fieldName(c: ReactiveComp, id: number): string {
    return c.state_slots.find((s) => s.id === id)?.name ?? `f${id}`;
}

function propName(c: ReactiveComp, id: number): string {
    return c.properties.find((p) => p.id === id)?.name ?? `p${id}`;
}

function exprText(c: ReactiveComp, id: number): string {
    return c.exprs.find((e) => e.id === id)?.text ?? '';
}

/** Reconstruct wire-stable strings from serde IrDepPath (external tag, no embedded `stable`). */
function pathStable(c: ReactiveComp, path: unknown): string | null {
    if (!path || typeof path !== 'object') return null;
    const p = path as Record<string, unknown>;
    if ('static_path' in p) {
        const sp = p.static_path as { root: number; props?: number[] };
        return [fieldName(c, sp.root), ...(sp.props ?? []).map((id) => propName(c, id))].join('.');
    }
    if ('list_item' in p) {
        const li = p.list_item as {
            list: number;
            frames?: Array<{ via?: number[]; key?: number | null }>;
            path?: number[];
        };
        let s = fieldName(c, li.list);
        for (const fr of li.frames ?? []) {
            for (const v of fr.via ?? []) s += `.${propName(c, v)}`;
            s += fr.key != null ? `[key=${exprText(c, fr.key)}]` : '[]';
        }
        for (const id of li.path ?? []) s += `.${propName(c, id)}`;
        return s;
    }
    if ('field' in p && typeof p.field === 'number') {
        return fieldName(c, p.field);
    }
    if ('dynamic_path' in p) {
        const dp = p.dynamic_path as {
            root: number;
            steps?: Array<{ via?: number[]; key: number }>;
            path?: number[];
        };
        let s = fieldName(c, dp.root);
        for (const st of dp.steps ?? []) {
            for (const v of st.via ?? []) s += `.${propName(c, v)}`;
            s += `[${exprText(c, st.key) || fieldName(c, st.key)}]`;
        }
        for (const id of dp.path ?? []) s += `.${propName(c, id)}`;
        return s;
    }
    return null;
}

function readStables(c: ReactiveComp): Set<string> {
    const stables = new Set<string>();
    for (const b of c.bindings) {
        for (const r of b.reads) {
            const s = pathStable(c, r);
            if (s) stables.add(s);
        }
    }
    return stables;
}

function pathKinds(c: ReactiveComp): Set<string> {
    const kinds = new Set<string>();
    for (const b of c.bindings) {
        for (const r of b.reads) {
            if (!r || typeof r !== 'object') continue;
            const key = Object.keys(r as object)[0];
            if (key) kinds.add(key);
        }
    }
    return kinds;
}

describe('precision', () => {
    it('reactive IR distinguishes user.name vs user.bio', () => {
        const ir = readJson<{ components: ReactiveComp[] }>(path.join(dist, 'components', 'UserCard.reactive.json'));
        const c = ir.components[0]!;
        const stables = readStables(c);
        const kinds = pathKinds(c);
        expect(stables.has('user.name')).toBe(true);
        expect(stables.has('user.bio')).toBe(true);
        expect(kinds.has('list_item')).toBe(true);
        expect(stables.has('tags[key=tag.id].label')).toBe(true);
    });

    it('program IR shells reactive as one view', () => {
        const program = readJson<{
            schema: string;
            units: Array<{
                semantic: { fields: Array<{ name: string }> };
                reactive: ReactiveComp;
                view: { status: string; binding_ids: number[]; roots?: unknown[] };
                server: {
                    status: string;
                    module_id: string | null;
                    class_name: string | null;
                    capabilities: Array<{
                        method: string;
                        http: { verb: string; path: string } | null;
                    }>;
                };
            }>;
        }>(path.join(dist, 'components', 'UserCard.program.json'));
        expect(program.schema).toBe('vmz.program.v0');
        expect(program.units[0]?.semantic.fields.some((f) => f.name === 'user')).toBe(true);
        expect(program.units[0]?.view.status).toBe('native');
        expect(Array.isArray(program.units[0]?.view.roots)).toBe(true);
        expect(program.units[0]?.view.roots!.length).toBeGreaterThan(0);
        expect(program.units[0]?.server.status).toBe('partial');
        expect(program.units[0]?.server.module_id).toBe('#server/components/UserCard');
        expect(program.units[0]?.server.class_name).toBe('UserCardServer');
        const caps = program.units[0]?.server.capabilities ?? [];
        expect(caps.some((c) => c.method === 'fetchUser')).toBe(true);
        expect(caps.some((c) => c.method === 'getMe' && c.http?.verb === 'GET' && c.http?.path === '/api/users/me')).toBe(true);
        const stables = readStables(program.units[0]!.reactive);
        expect(stables.has('user.name')).toBe(true);
        expect(program.units[0]?.view.binding_ids.length).toBeGreaterThan(0);
    });

    it('leaf user.name write patches only that binding', async () => {
        const ir = readJson<{ components: ReactiveComp[] }>(path.join(dist, 'components', 'UserCard.reactive.json'));
        const c = ir.components[0]!;
        const nameBinding = c.bindings.find((b) => b.kind === 'text' && b.reads.some((r) => pathStable(c, r) === 'user.name'));
        const bioBinding = c.bindings.find((b) => b.kind === 'text' && b.reads.some((r) => pathStable(c, r) === 'user.bio'));
        expect(nameBinding?.id).toEqual(expect.any(Number));
        expect(bioBinding?.id).toEqual(expect.any(Number));
        expect(nameBinding!.id).not.toBe(bioBinding!.id);

        const runtime = await loadRuntime(dist);
        const { __vmzPrecisionEnable, __vmzPrecisionReset, __vmzPrecisionSnapshot, flushPending, hydrate, renderToString } =
            await loadDom(dist);
        installServerResolver(runtime.setServerModuleResolver, dist);
        const { default: UserCard } = await importDist<{ default: any }>(dist, 'components/UserCard.client.js');

        __vmzPrecisionEnable(true);
        const html = await renderToString(UserCard);
        const { app } = installDocument(`<!DOCTYPE html><html><body><div id="app">${html}</div></body></html>`);
        const inst = await hydrate(UserCard, app!);
        // IR BindingId registry (string `__vmzBinders` is transitional adapter only).
        expect(inst.__vmzBindings[nameBinding!.id]?.patches.length).toBeGreaterThan(0);
        expect(inst.__vmzBindings[bioBinding!.id]?.patches.length).toBeGreaterThan(0);
        expect(inst.__vmzBindings[nameBinding!.id].deps).toContain('user.name');

        __vmzPrecisionReset();
        inst.user.name = 'Ada Lovelace';
        await flushPending(inst);
        const snap = __vmzPrecisionSnapshot();

        const nameKey = String(nameBinding!.id);
        const bioKey = String(bioBinding!.id);
        expect(snap.patchesByBinding[nameKey]).toBe(1);
        expect(snap.patchesByBinding[bioKey] ?? 0).toBe(0);
        expect(Object.keys(snap.patchesByBinding)).toEqual([nameKey]);
        expect(snap.patchExecs).toBe(1);
        expect(snap.bindingEvalsByBinding[bioKey] ?? 0).toBe(0);
        expect(snap.bindingEvalsByBinding[nameKey]).toBeGreaterThanOrEqual(1);
        // Transitional dep counters still agree, but BindingId is the gate.
        expect(snap.patchesByDep['user.name']).toBeGreaterThanOrEqual(1);
        expect(snap.patchesByDep['user.bio'] ?? 0).toBe(0);
        expect(snap.domCreates).toBe(0);
        expect(snap.domMoves).toBe(0);
        expect(snap.domRemoves).toBe(0);
        expect(snap.componentExecs).toBe(0);
        expect(app!.querySelector('h2')?.textContent).toContain('Ada Lovelace');

        __vmzPrecisionReset();
        inst.user = { name: 'Bob', bio: 'replaced' };
        await flushPending(inst);
        const after = __vmzPrecisionSnapshot();
        expect(after.patchesByBinding[nameKey]).toBeGreaterThanOrEqual(1);
        expect(after.patchesByBinding[bioKey]).toBeGreaterThanOrEqual(1);
    });

    // Control-flow binder wiring: BranchDemo in ownership-cf.test.ts (production Direct emit Direct).

    it('item leaf writePath updates rowKernel DOM without keyed reconcile', async () => {
        const ir = readJson<{ components: ReactiveComp[] }>(path.join(dist, 'components', 'UserCard.reactive.json'));
        const c = ir.components[0]!;
        const labelBinding = c.bindings.find((b) => b.kind === 'text' && b.reads.some((r) => pathStable(c, r) === 'tags[key=tag.id].label'));
        const eachBinding = c.bindings.find((b) => b.kind === 'each_list');
        expect(labelBinding?.id).toEqual(expect.any(Number));
        expect(eachBinding?.id).toEqual(expect.any(Number));

        const runtime = await loadRuntime(dist);
        const { __vmzPrecisionEnable, __vmzPrecisionReset, __vmzPrecisionSnapshot, flushPending, hydrate, renderToString, __vmzWritePath } =
            await loadDom(dist);
        installServerResolver(runtime.setServerModuleResolver, dist);
        const { default: UserCard } = await importDist<{ default: any }>(dist, 'components/UserCard.client.js');

        const html = await renderToString(UserCard);
        const { app } = installDocument(`<!DOCTYPE html><html><body><div id="app">${html}</div></body></html>`);
        const inst = await hydrate(UserCard, app!);

        const tagsBinders = inst.__vmzBinders.tags || [];
        let reconcileRuns = 0;
        for (let i = 0; i < tagsBinders.length; i++) {
            const orig = tagsBinders[i];
            tagsBinders[i] = (...args: unknown[]) => {
                reconcileRuns++;
                return orig(...args);
            };
        }

        __vmzPrecisionEnable(true);
        __vmzPrecisionReset();
        const li = [...app!.querySelectorAll('li')].find((el: any) => el.__vmzKey === 'vmz')!;
        __vmzWritePath(inst, 'tags', ['0', 'label'], 'VMZ!');
        await flushPending(inst);
        const snap = __vmzPrecisionSnapshot();
        const eachKey = String(eachBinding!.id);

        expect(li.textContent).toBe('VMZ!');
        expect([...app!.querySelectorAll('li')].find((el: any) => el.__vmzKey === 'vmz')).toBe(li);
        expect(reconcileRuns).toBe(0);
        // rowKernel owns item leaf apply via __vmzRk — each BindingId must stay idle.
        expect(snap.patchesByBinding[eachKey] ?? 0).toBe(0);
        expect(snap.domCreates).toBe(0);
        expect(snap.domMoves).toBe(0);
        expect(snap.domRemoves).toBe(0);
    });
});
