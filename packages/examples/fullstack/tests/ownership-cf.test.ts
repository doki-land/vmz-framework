import path from 'node:path';
import { describe, it } from 'node:test';
import { expect } from '../../../../scripts/test-expect.mjs';
import { exampleDist, importDist, installDocument, loadDom, readJson } from '@vmz-examples/test-utils';

const dist = exampleDist('fullstack');

describe('shared mutable ownership', () => {
    it('notifies both fields when the same raw object is shared', async () => {
        const { __vmzPrecisionEnable, __vmzPrecisionReset, __vmzPrecisionSnapshot, flushPending, mount } = await loadDom(dist);
        const { default: WriteBarrierSharedDemo } = await importDist<{ default: any }>(dist, 'components/WriteBarrierSharedDemo.client.js');

        const { app } = installDocument(`<!DOCTYPE html><html><body><div id="app"></div></body></html>`);

        __vmzPrecisionEnable(true);
        const inst = await mount(WriteBarrierSharedDemo, app!);
        inst.share();
        await flushPending(inst);
        __vmzPrecisionReset();

        inst.setSecondary('both');
        await flushPending(inst);
        const snap = __vmzPrecisionSnapshot();
        expect(snap.patchesByDep['primary.name']).toBeGreaterThanOrEqual(1);
        expect(snap.patchesByDep['secondary.name']).toBeGreaterThanOrEqual(1);
        expect(app!.textContent).toContain('both');
    });
});

describe('compiled control-flow precision', () => {
    it('inactive .vmz branch does not evaluate on sibling write', async () => {
        const { __vmzPrecisionEnable, __vmzPrecisionReset, __vmzPrecisionSnapshot, flushPending, hydrate, renderToString } =
            await loadDom(dist);

        const { default: BranchDemo } = await importDist<{ default: any }>(dist, 'components/BranchDemo.client.js');

        __vmzPrecisionEnable(true);
        const html = await renderToString(BranchDemo);
        expect(html).toContain('>A<');
        const { app } = installDocument(`<!DOCTYPE html><html><body><div id="app">${html}</div></body></html>`);
        const inst = await hydrate(BranchDemo, app!);

        // Activate both branches once so inactive branch DOM is cached.
        inst.showA = false;
        await flushPending(inst);
        inst.showA = true;
        await flushPending(inst);
        expect(inst.__vmzBinders.aText?.length).toBeGreaterThan(0);
        expect(inst.__vmzBinders.bText?.length ?? 0).toBe(0);

        const ir = readJson<{
            components: Array<{
                bindings: Array<{
                    id: number;
                    kind: string;
                    reads: Array<{ stable?: string }>;
                }>;
            }>;
        }>(path.join(dist, 'components', 'BranchDemo.reactive.json'));
        const ifBinding = ir.components[0]?.bindings.find((b) => b.kind === 'if_cond');
        expect(ifBinding?.id).toEqual(expect.any(Number));
        expect(inst.__vmzBindings[ifBinding!.id]?.patches.length).toBeGreaterThan(0);

        __vmzPrecisionReset();
        inst.bText = 'B2';
        await flushPending(inst);
        const snap = __vmzPrecisionSnapshot();
        expect(snap.patchesByDep.bText ?? 0).toBe(0);
        expect(snap.bindingEvalsByDep.bText ?? 0).toBe(0);
        expect(snap.patchesByDep.aText ?? 0).toBe(0);
        expect(snap.patchesByBinding[String(ifBinding!.id)] ?? 0).toBe(0);
        expect(app!.textContent).toContain('A');
        expect(app!.textContent).not.toContain('B2');

        inst.aText = 'A2';
        await flushPending(inst);
        expect(app!.textContent).toContain('A2');

        __vmzPrecisionReset();
        inst.showA = false;
        await flushPending(inst);
        const flipped = __vmzPrecisionSnapshot();
        expect(flipped.patchesByBinding[String(ifBinding!.id)]).toBeGreaterThanOrEqual(1);
        expect(app!.textContent).toContain('B2');
        expect(inst.__vmzBinders.aText?.length ?? 0).toBe(0);
        expect(inst.__vmzBinders.bText?.length).toBeGreaterThan(0);
    });
});
