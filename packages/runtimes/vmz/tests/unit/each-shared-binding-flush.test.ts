/**
 * Shared IR BindingId across keyed-each items must not skip sibling patches when
 * a cf patch untrack/retracks mid-flush (Tabs aria-selected regression).
 */
import { parseHTML } from 'linkedom';
import { describe, it } from 'node:test';
import { expect } from '../../../../../scripts/test/expect.mjs';
import { flushPending, mount } from '@vmz/core/dom';

describe('each-item shared BindingId flush', () => {
    it('updates every item attr when a host field changes', async () => {
        const { window } = parseHTML('<!doctype html><html><body></body></html>');
        globalThis.document = window.document;
        globalThis.HTMLElement = window.HTMLElement;
        globalThis.Node = window.Node;
        globalThis.Comment = window.Comment;
        globalThis.DocumentFragment = window.DocumentFragment;
        globalThis.Text = window.Text;

        class TabsLike {
            static __vmzDirect = true;
            static __vmzState = ['selected', 'items'];
            selected = 'a';
            items = [
                { id: 'a', title: 'A' },
                { id: 'b', title: 'B' },
                { id: 'c', title: 'C' },
            ];

            static __vmzCreate(api) {
                const root = api.el('div');
                const list = api.el('div');
                const frag = function () {
                    const inst = this;
                    const start = api.comment('each');
                    const end = api.comment('/each');
                    const out = api.frag();
                    out.appendChild(start);
                    out.appendChild(end);
                    const keyed = new Map();
                    function apply() {
                        const items = inst.items || [];
                        for (let i = 0; i < items.length; i++) {
                            const item = items[i];
                            const key = item.id;
                            let entry = keyed.get(key);
                            if (!entry) {
                                const box = { item, index: i };
                                const itemPatches = [];
                                const prevEach = api._eachCtx;
                                const prevInst = api._inst;
                                api._eachCtx = {
                                    noteItemBind(bId, d, fn) {
                                        fn.__vmzItemDeps = d;
                                    },
                                    needDelegate() {},
                                };
                                api._inst = inst;
                                api._itemPatches = itemPatches;
                                const btn = api.el('button');
                                btn.setAttribute('data-id', item.id);
                                // Same BindingId for every item (matches generator IR).
                                (function () {
                                    let liveDeps = ['selected', 'items.*.id'];
                                    let active = -1;
                                    function patchAttr() {
                                        const raw = inst.selected === box.item.id ? 'true' : 'false';
                                        api.attr(btn, 'aria-selected', raw);
                                        const next = inst.selected === box.item.id ? 0 : 1;
                                        if (next === active) return;
                                        active = next;
                                        const nd = ['selected', 'items.*.id'];
                                        api.untrackPatch(inst, liveDeps, patchAttr, 7);
                                        liveDeps = nd;
                                        api.trackPatch(inst, liveDeps, patchAttr, 7);
                                    }
                                    api.trackPatch(inst, liveDeps, patchAttr, 7);
                                })();
                                api._eachCtx = prevEach;
                                api._inst = prevInst;
                                api._itemPatches = null;
                                entry = { box, dom: btn, patches: itemPatches };
                                keyed.set(key, entry);
                                end.parentNode.insertBefore(btn, end);
                            } else {
                                entry.box.item = item;
                                entry.box.index = i;
                            }
                        }
                    }
                    api.trackPatch(inst, ['items'], apply, 1);
                    apply();
                    return out;
                }.call(this);
                list.appendChild(frag);
                root.appendChild(list);
                return root;
            }
        }

        const host = document.createElement('div');
        document.body.appendChild(host);
        const inst = await mount(TabsLike, host, {});
        expect(host.querySelector('[data-id="a"]')?.getAttribute('aria-selected')).toBe('true');
        expect(host.querySelector('[data-id="b"]')?.getAttribute('aria-selected')).toBe('false');

        inst.selected = 'b';
        await flushPending(inst);

        expect(host.querySelector('[data-id="a"]')?.getAttribute('aria-selected')).toBe('false');
        expect(host.querySelector('[data-id="b"]')?.getAttribute('aria-selected')).toBe('true');
        expect(host.querySelector('[data-id="c"]')?.getAttribute('aria-selected')).toBe('false');
    });
});
