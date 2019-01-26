import path from 'node:path';
import { describe, it } from 'node:test';
import { expect } from '../../../../scripts/test/expect.mjs';
import { exampleDist, importDist, installDocument, installServerResolver, loadDom, loadRuntime, readJson } from '@vmz-examples/test-utils';

const dist = exampleDist('fullstack');

describe('fullstack each / batch / race', () => {
    it('each item label patches via Direct mount (no render blueprint)', async () => {
        const runtime = await loadRuntime(dist);
        const { flushPending, mount, __vmzWritePath } = await loadDom(dist);
        installServerResolver(runtime.setServerModuleResolver, dist);
        const { default: UserCard } = await importDist<{ default: any }>(dist, 'components/UserCard.client.js');

        expect(UserCard.__vmzDirect).toBe(true);
        expect(typeof UserCard.prototype.render).toBe('undefined');

        const { app } = installDocument(`<!DOCTYPE html><html><body><div id="app"></div></body></html>`);
        const inst = await mount(UserCard, app!);
        inst.user = { name: 'Ada', bio: 'x' };
        inst.tags = [
            { id: 'vmz', label: 'vmz' },
            { id: 'oxc', label: 'oxc' },
        ];
        await flushPending(inst);
        expect(app!.textContent).toContain('vmz');
        // Array elements stay plain — leaf writes notify via __vmzWritePath (not bare assign).
        const idx = inst.tags.findIndex((t: any) => t.id === 'vmz');
        __vmzWritePath(inst, 'tags', [String(idx), 'label'], 'VMZ');
        await flushPending(inst);
        expect(app!.textContent).toContain('VMZ');
    });

    it('in-place item.field and push update DOM without remount', async () => {
        const runtime = await loadRuntime(dist);
        const { flushPending, hydrate, renderToString } = await loadDom(dist);
        installServerResolver(runtime.setServerModuleResolver, dist);
        const { default: UserCard } = await importDist<{ default: any }>(dist, 'components/UserCard.client.js');

        const html = await renderToString(UserCard);
        expect(html).toContain('data-vmz-key="vmz"');
        const { app } = installDocument(`<!DOCTYPE html><html><body><div id="app">${html}</div></body></html>`);
        const inst = await hydrate(UserCard, app!);
        const liVmz = [...app!.querySelectorAll('li')].find((el: any) => el.__vmzKey === 'vmz')!;
        expect(liVmz).toBeTruthy();

        const { __vmzWritePath } = await loadDom(dist);
        __vmzWritePath(inst, 'tags', ['0', 'label'], 'VMZ!');
        await flushPending(inst);
        expect(liVmz.textContent).toBe('VMZ!');
        expect([...app!.querySelectorAll('li')].find((el: any) => el.__vmzKey === 'vmz')).toBe(liVmz);

        const beforeCount = [...app!.querySelectorAll('li')].filter((el: any) => el.__vmzKey != null).length;
        inst.tags.push({ id: 'rust', label: 'rust' });
        await flushPending(inst);
        const liRust = [...app!.querySelectorAll('li')].find((el: any) => el.__vmzKey === 'rust');
        expect(liRust?.textContent).toBe('rust');
        expect([...app!.querySelectorAll('li')].filter((el: any) => el.__vmzKey != null).length).toBe(beforeCount + 1);

        inst.user.name = 'Ada Lovelace';
        await flushPending(inst);
        expect(app!.querySelector('h2')?.textContent).toBe('Ada Lovelace');
    });

    it('batches same-turn writes into one flush', async () => {
        const runtime = await loadRuntime(dist);
        const { flushPending, hydrate, renderToString } = await loadDom(dist);
        installServerResolver(runtime.setServerModuleResolver, dist);
        const { default: UserCard } = await importDist<{ default: any }>(dist, 'components/UserCard.client.js');

        const html = await renderToString(UserCard);
        const { app } = installDocument(`<!DOCTYPE html><html><body><div id="app">${html}</div></body></html>`);
        const inst = await hydrate(UserCard, app!);

        let patchRuns = 0;
        const wrap = (orig: (...args: unknown[]) => unknown) => {
            return function wrappedPatch(this: unknown, ...args: unknown[]) {
                patchRuns++;
                return orig.apply(this, args);
            };
        };
        // Count BindingId patches (hot path); string binders are transitional only.
        for (const id of Object.keys(inst.__vmzBindings || {})) {
            const entry = inst.__vmzBindings[id];
            for (let i = 0; i < entry.patches.length; i++) {
                entry.patches[i] = wrap(entry.patches[i]);
            }
        }
        for (const field of Object.keys(inst.__vmzBinders || {})) {
            const list = inst.__vmzBinders[field];
            for (let i = 0; i < list.length; i++) {
                // Prefer BindingId registry when the same fn is already wrapped there.
                if (Object.values(inst.__vmzBindings || {}).some((e: any) => e.patches.includes(list[i]))) {
                    continue;
                }
                list[i] = wrap(list[i]);
            }
        }

        inst.user = { name: 'Bob', bio: 'batched' };
        inst.tags = [{ id: 'a', label: 'alpha' }];
        expect(patchRuns).toBe(0);
        await flushPending(inst);
        expect(patchRuns).toBeGreaterThanOrEqual(2);
        expect(app!.querySelector('h2')?.textContent).toBe('Bob');
        expect([...app!.querySelectorAll('li')].find((el: any) => el.__vmzKey === 'a')?.textContent).toBe('alpha');

        const meta = readJson<{
            methodRw?: { onMount?: { writes?: string[] } };
        }>(path.join(dist, 'components', 'UserCard.vmz.json'));
        expect(meta.methodRw?.onMount?.writes).toEqual(expect.arrayContaining(['user', 'tags']));
    });

    // Former createDom generation race case deleted with production Direct emit blueprint wipe.
    // Direct each generation races belong in vmz test, not Vitest.
});
