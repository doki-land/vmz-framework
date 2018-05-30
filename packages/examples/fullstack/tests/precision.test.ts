import path from 'node:path';
import { describe, it } from 'node:test';
import { expect } from '../../../../scripts/test/expect.mjs';
import { exampleDist, importDist, installDocument, installServerResolver, loadDom, loadRuntime, readJson } from '@vmz-examples/test-utils';

const dist = exampleDist('fullstack');

describe('precision', () => {
    it('reactive IR distinguishes user.name vs user.bio', () => {
        const ir = readJson<{
            components: Array<{
                bindings: Array<{ reads: Array<{ kind?: string; stable?: string }> }>;
            }>;
        }>(path.join(dist, 'components', 'UserCard.reactive.json'));
        const stables = new Set<string>();
        const kinds = new Set<string>();
        for (const c of ir.components) {
            for (const b of c.bindings) {
                for (const r of b.reads) {
                    if (r.stable) stables.add(r.stable);
                    if (r.kind) kinds.add(r.kind);
                }
            }
        }
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
                reactive: {
                    bindings: Array<{ reads: Array<{ stable?: string }> }>;
                };
                view: { status: string; binding_ids: number[] };
                server: {
                    status: string;
                    module_id: string | null;
                    class_name: string | null;
                    capabilities: Array<{
                        method: string;
                        http: { verb: string; path: string } | null;
                    }>;
                    calls: Array<{ method: string; from_client_method: string | null }>;
                };
            }>;
        }>(path.join(dist, 'components', 'UserCard.program.json'));
        expect(program.schema).toBe('vmz.program.v0');
        expect(program.units[0]?.semantic.fields.some((f) => f.name === 'user')).toBe(true);
        expect(program.units[0]?.view.status).toBe('native');
        expect(Array.isArray(program.units[0]?.view.roots)).toBe(true);
        expect(program.units[0]?.view.roots.length).toBeGreaterThan(0);
        expect(program.units[0]?.server.status).toBe('partial');
        expect(program.units[0]?.server.module_id).toBe('#server/components/UserCard');
        expect(program.units[0]?.server.class_name).toBe('UserCardServer');
        const caps = program.units[0]?.server.capabilities ?? [];
        expect(caps.some((c) => c.method === 'fetchUser')).toBe(true);
        expect(caps.some((c) => c.method === 'getMe' && c.http?.verb === 'GET' && c.http?.path === '/api/users/me')).toBe(true);
        expect(program.units[0]?.server.calls.some((e) => e.method === 'fetchUser' && e.from_client_method === 'onMount')).toBe(true);
        const stables = new Set<string>();
        for (const b of program.units[0]?.reactive.bindings ?? []) {
            for (const r of b.reads) {
                if (r.stable) stables.add(r.stable);
            }
        }
        expect(stables.has('user.name')).toBe(true);
        expect(program.units[0]?.view.binding_ids.length).toBeGreaterThan(0);
    });

    it('leaf user.name write patches only that binding', async () => {
        const ir = readJson<{
            components: Array<{
                bindings: Array<{
                    id: number;
                    kind: string;
                    reads: Array<{ stable?: string }>;
                }>;
            }>;
        }>(path.join(dist, 'components', 'UserCard.reactive.json'));
        const nameBinding = ir.components[0]?.bindings.find((b) => b.kind === 'text' && b.reads.some((r) => r.stable === 'user.name'));
        const bioBinding = ir.components[0]?.bindings.find((b) => b.kind === 'text' && b.reads.some((r) => r.stable === 'user.bio'));
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

    it('item leaf write patches BindingId without keyed reconcile', async () => {
        const ir = readJson<{
            components: Array<{
                bindings: Array<{
                    id: number;
                    kind: string;
                    reads: Array<{ stable?: string }>;
                }>;
            }>;
        }>(path.join(dist, 'components', 'UserCard.reactive.json'));
        const labelBinding = ir.components[0]?.bindings.find(
            (b) => b.kind === 'text' && b.reads.some((r) => r.stable === 'tags[key=tag.id].label'),
        );
        const eachBinding = ir.components[0]?.bindings.find((b) => b.kind === 'each_list');
        expect(labelBinding?.id).toEqual(expect.any(Number));
        expect(eachBinding?.id).toEqual(expect.any(Number));

        const runtime = await loadRuntime(dist);
        const { __vmzPrecisionEnable, __vmzPrecisionReset, __vmzPrecisionSnapshot, flushPending, hydrate, renderToString } =
            await loadDom(dist);
        installServerResolver(runtime.setServerModuleResolver, dist);
        const { default: UserCard } = await importDist<{ default: any }>(dist, 'components/UserCard.client.js');

        const html = await renderToString(UserCard);
        const { app } = installDocument(`<!DOCTYPE html><html><body><div id="app">${html}</div></body></html>`);
        const inst = await hydrate(UserCard, app!);
        expect(inst.__vmzBindings[labelBinding!.id]?.patches.length).toBeGreaterThan(0);

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
        const li = app!.querySelector('[data-vmz-key="vmz"]')!;
        inst.tags[0].label = 'VMZ!';
        await flushPending(inst);
        const snap = __vmzPrecisionSnapshot();
        const labelKey = String(labelBinding!.id);
        const eachKey = String(eachBinding!.id);

        expect(li.textContent).toBe('VMZ!');
        expect(app!.querySelector('[data-vmz-key="vmz"]')).toBe(li);
        expect(reconcileRuns).toBe(0);
        expect(snap.patchesByBinding[eachKey] ?? 0).toBe(0);
        expect(snap.patchesByBinding[labelKey]).toBe(1);
        expect(snap.patchExecs).toBe(1);
        expect(inst.__vmzBindings[labelBinding!.id].deps).toContain('tags.*.label');
        expect(inst.__vmzBindings[labelBinding!.id].deps).not.toContain('tags.*');
        expect(snap.domCreates).toBe(0);
        expect(snap.domMoves).toBe(0);
        expect(snap.domRemoves).toBe(0);
    });
});
