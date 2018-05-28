import { describe, it } from 'node:test';
import { expect } from '../../../../scripts/test-expect.mjs';
import { exampleDist, importDist, installDocument, installServerResolver, loadDom, loadRuntime } from '@vmz-examples/test-utils';

const dist = exampleDist('fullstack');

describe('path trie scheduling', () => {
    it('parent path write wakes child binding; sibling stays idle', async () => {
        const runtime = await loadRuntime(dist);
        const { __vmzPrecisionEnable, __vmzPrecisionReset, __vmzPrecisionSnapshot, flushPending, hydrate, renderToString } =
            await loadDom(dist);
        installServerResolver(runtime.setServerModuleResolver, dist);
        const { default: UserCard } = await importDist<{ default: any }>(dist, 'components/UserCard.client.js');

        __vmzPrecisionEnable(true);
        const html = await renderToString(UserCard);
        const { app } = installDocument(`<!DOCTYPE html><html><body><div id="app">${html}</div></body></html>`);
        const inst = await hydrate(UserCard, app!);

        // Ensure nested object exists for parent write of a container path.
        inst.user = {
            name: 'Ada',
            bio: 'from db',
            address: { city: 'London' },
        };
        await flushPending(inst);
        __vmzPrecisionReset();

        // Register an extra binder under user.address.city for coverage.
        let cityRuns = 0;
        const cityFn = () => {
            cityRuns++;
        };
        if (!inst.__vmzBinders['user.address.city']) {
            inst.__vmzBinders['user.address.city'] = [];
        }
        inst.__vmzBinders['user.address.city'].push(cityFn);

        // Parent write: replace address object  - ?path notice user.address
        inst.user.address = { city: 'Paris' };
        await flushPending(inst);

        expect(cityRuns).toBeGreaterThanOrEqual(1);
        const snap = __vmzPrecisionSnapshot();
        expect(snap.patchesByDep['user.bio'] ?? 0).toBe(0);
        expect(snap.patchesByDep['user.name'] ?? 0).toBe(0);
    });

    it('coalesces replace over nested path dirty in one flush', async () => {
        const runtime = await loadRuntime(dist);
        const { __vmzPrecisionEnable, __vmzPrecisionReset, __vmzPrecisionSnapshot, flushPending, hydrate, renderToString } =
            await loadDom(dist);
        installServerResolver(runtime.setServerModuleResolver, dist);
        const { default: UserCard } = await importDist<{ default: any }>(dist, 'components/UserCard.client.js');

        __vmzPrecisionEnable(true);
        const html = await renderToString(UserCard);
        const { app } = installDocument(`<!DOCTYPE html><html><body><div id="app">${html}</div></body></html>`);
        const inst = await hydrate(UserCard, app!);
        __vmzPrecisionReset();

        inst.user.name = 'X';
        inst.user = { name: 'Y', bio: 'Z' };
        await flushPending(inst);

        const snap = __vmzPrecisionSnapshot();
        // Both path binders should run from the replace; writes counted for both notices.
        expect(snap.writes).toBeGreaterThanOrEqual(2);
        expect(snap.patchesByDep['user.name']).toBeGreaterThanOrEqual(1);
        expect(snap.patchesByDep['user.bio']).toBeGreaterThanOrEqual(1);
        expect(app!.querySelector('h2')?.textContent).toBe('Y');
    });
});
