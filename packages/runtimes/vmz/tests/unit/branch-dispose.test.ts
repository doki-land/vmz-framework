/**
 * `v-if` branch switching must unmount the outgoing branch.
 *
 * Emitted branch controllers cached the detached subtree, so a hidden branch kept
 * its child instances, subscriptions and `onDestroy` alive and a later re-show
 * replayed stale state onto nodes that had already left the document. The
 * controller now disposes the outgoing tree before detaching it and clears both
 * `cached[active]` and `branchBinds[active]`.
 */
import { parseHTML } from 'linkedom';
import { afterEach, describe, it } from 'node:test';
import { expect } from '../../../../../scripts/test/expect.mjs';
import { flushPending, mount, registerComponents } from '@vmz/core/dom';

function installDom() {
    const { window } = parseHTML('<!doctype html><html><body></body></html>');
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;
    globalThis.Node = window.Node;
    globalThis.Comment = window.Comment;
    globalThis.DocumentFragment = window.DocumentFragment;
    globalThis.Text = window.Text;
    return window;
}

afterEach(() => {
    delete (globalThis as any).document;
    delete (globalThis as any).window;
    delete (globalThis as any).MutationObserver;
});

function branchFixture() {
    const stats = { created: [] as string[], onDestroyCalls: 0 };

    class BranchBody {
        static __vmzDirect = true;
        tag = '';
        constructor(props: any = {}) {
            this.tag = String(props.tag ?? '');
            stats.created.push(this.tag);
        }
        static __vmzCreate(api: any) {
            const root = api.el('p');
            api.attr(root, 'data-branch', this.tag);
            root.appendChild(api.text(this.tag));
            return root;
        }
        onDestroy() {
            stats.onDestroyCalls += 1;
        }
    }

    /** Mirrors the emitted `__vmzCreate` for `<p v-if="showA">A</p><p v-else>B</p>`. */
    class BranchHost {
        static __vmzDirect = true;
        static __vmzState = ['showA'];
        showA = true;
        static __vmzCreate(api: any) {
            const root = api.el('div');
            const v = (function (this: any) {
                const inst = this;
                const start = api.comment('vmz-if');
                const end = api.comment('/vmz-if');
                const frag = api.frag();
                frag.appendChild(start);
                frag.appendChild(end);
                const branches = [
                    {
                        cond: function () {
                            return this.showA;
                        },
                        create: function (apiInner: any) {
                            return apiInner.component(this, BranchBody, { tag: 'a' }, null);
                        },
                    },
                    {
                        cond: null,
                        create: function (apiInner: any) {
                            return apiInner.component(this, BranchBody, { tag: 'b' }, null);
                        },
                    },
                ];
                const cached: any[] = branches.map(() => null);
                const branchBinds: any[][] = branches.map(() => []);
                let active = -1;
                let gen = 0;
                function pick() {
                    for (let i = 0; i < branches.length; i++) {
                        const b: any = branches[i];
                        if (!b.cond) return i;
                        try {
                            if (b.cond.call(inst)) return i;
                        } catch {}
                    }
                    return -1;
                }
                function wireBranch(idx: number) {
                    if (idx < 0) return;
                    for (let j = 0; j < branchBinds[idx].length; j++) {
                        const bb = branchBinds[idx][j];
                        api.trackPatch(inst, bb.deps, bb.fn, bb.bindingId);
                    }
                }
                function unwireBranch(idx: number) {
                    if (idx < 0) return;
                    for (let j = 0; j < branchBinds[idx].length; j++) {
                        const bb = branchBinds[idx][j];
                        api.untrackPatch(inst, bb.deps, bb.fn, bb.bindingId);
                    }
                }
                function apply() {
                    if (inst.__vmzDestroyed) return;
                    const applied = ++gen;
                    const next = pick();
                    if (next === active) return;
                    if (next >= 0 && !cached[next]) {
                        const binds: any[] = [];
                        const prevSink = api._branchBinds;
                        const prevInst = api._inst;
                        api._branchBinds = binds;
                        api._inst = inst;
                        let created = null;
                        try {
                            created = branches[next].create.call(inst, api);
                        } finally {
                            api._branchBinds = prevSink;
                            api._inst = prevInst;
                        }
                        if (applied !== gen || inst.__vmzDestroyed) return;
                        if (!cached[next]) {
                            cached[next] = created;
                            branchBinds[next] = binds;
                        }
                    }
                    if (applied !== gen || inst.__vmzDestroyed) return;
                    if (active >= 0) {
                        unwireBranch(active);
                        if (cached[active]) {
                            api.disposeTree(cached[active]);
                            if (cached[active].parentNode) api.removeNode(cached[active]);
                        }
                        cached[active] = null;
                        branchBinds[active] = [];
                    }
                    active = next;
                    if (next < 0) return;
                    wireBranch(next);
                    if (cached[next] && end.parentNode) end.parentNode.insertBefore(cached[next], end);
                }
                api.trackPatch(inst, ['showA'], apply, null);
                start.__vmzDispose = function () {
                    for (let i = 0; i < cached.length; i++) {
                        unwireBranch(i);
                        if (cached[i]) api.disposeTree(cached[i]);
                        cached[i] = null;
                    }
                    active = -1;
                };
                apply();
                return frag;
            }).call(this);
            root.appendChild(v);
            return root;
        }
    }

    return { BranchHost, stats };
}

describe('v-if branch dispose', () => {
    it('destroys the outgoing branch before detaching it', async () => {
        const window = installDom();
        const { BranchHost, stats } = branchFixture();
        registerComponents({ BranchHost });
        const container = window.document.createElement('div');
        window.document.body.appendChild(container);
        const inst: any = await mount(BranchHost, container, {});

        const firstHost = container.querySelector('div[data-vmz]') as any;
        expect(firstHost != null).toBe(true);
        expect(firstHost.querySelector('p').getAttribute('data-branch')).toBe('a');
        const firstChild = firstHost.__vmzInst;
        expect(firstChild).toBeTruthy();
        expect(stats.onDestroyCalls).toBe(0);

        inst.showA = false;
        await flushPending(inst);

        expect(stats.onDestroyCalls).toBe(1);
        expect(firstChild.__vmzDestroyed).toBe(true);
        expect(firstHost.__vmzInst == null).toBe(true);
        const hostStillInDom = firstHost.parentNode != null;
        expect(hostStillInDom).toBe(false);

        const secondHost = container.querySelector('div[data-vmz]') as any;
        expect(secondHost).not.toBe(firstHost);
        expect(secondHost.querySelector('p').getAttribute('data-branch')).toBe('b');
        expect(stats.created).toEqual(['a', 'b']);

        inst.showA = true;
        await flushPending(inst);

        const thirdHost = container.querySelector('div[data-vmz]') as any;
        expect(thirdHost).not.toBe(firstHost);
        expect(thirdHost.querySelector('p').getAttribute('data-branch')).toBe('a');
        expect(stats.created).toEqual(['a', 'b', 'a']);
        expect(thirdHost.__vmzInst).not.toBe(firstChild);
        container.remove();
    });
});
