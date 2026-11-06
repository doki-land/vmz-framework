/**
 * Named slot projection (`<template #header>` / `<Comp #header>`).
 *
 * Named children must land in the component's own `<slot name="…">` outlet, must not
 * cross a nested component boundary, and a missing outlet must never fall through into
 * the default slot.
 */
import { parseHTML } from 'linkedom';
import { afterEach, describe, it } from 'node:test';
import { expect } from '../../../../../scripts/test/expect.mjs';
import { mount, registerComponents, renderToString } from '@vmz/core/dom';

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

function namedSlotElement(api: any, name: string, extra?: (el: any) => void) {
    const slot = api.el('slot');
    api.attr(slot, 'name', name);
    if (extra) extra(slot);
    return slot;
}

afterEach(() => {
    delete (globalThis as any).document;
    delete (globalThis as any).window;
    delete (globalThis as any).MutationObserver;
});

describe('named slot projection', () => {
    it('projects named and default children into their own outlets', async () => {
        const window = installDom();

        class Card {
            static __vmzDirect = true;
            static __vmzCreate(api: any) {
                const root = api.el('article');
                const header = api.el('header');
                const headerSlot = namedSlotElement(api, 'header');
                headerSlot.appendChild(api.text('FALLBACK'));
                header.appendChild(headerSlot);
                const body = api.el('section');
                body.appendChild(api.el('slot'));
                root.appendChild(header);
                root.appendChild(body);
                return root;
            }
        }

        class Host {
            static __vmzDirect = true;
            static __vmzCreate(api: any) {
                const root = api.el('div');
                const card = api.component(this, Card, {}, null);
                api.projectNamedSlot(card, 'header', api.text('HEAD'));
                api.projectDefaultSlot(card, api.text('BODY'));
                root.appendChild(card);
                return root;
            }
        }

        registerComponents({ Card, Host });
        const container = window.document.createElement('div');
        window.document.body.appendChild(container);
        await mount(Host, container, {});

        expect(container.querySelector('header').textContent).toBe('HEAD');
        expect(container.querySelector('section').textContent).toBe('BODY');
        expect(container.textContent).not.toContain('FALLBACK');
        container.remove();
    });

    it('does not steal a nested component named slot', async () => {
        const window = installDom();

        class Inner {
            static __vmzDirect = true;
            static __vmzCreate(api: any) {
                const root = api.el('div');
                root.appendChild(namedSlotElement(api, 'header'));
                return root;
            }
        }

        class Wrapper {
            static __vmzDirect = true;
            static __vmzCreate(api: any) {
                const root = api.el('div');
                root.appendChild(namedSlotElement(api, 'header', (el) => api.attr(el, 'data-fixture', 'own')));
                root.appendChild(api.component(this, 'Inner', {}, null));
                return root;
            }
        }

        class Outer {
            static __vmzDirect = true;
            static __vmzCreate(api: any) {
                const root = api.el('div');
                const wrapper = api.component(this, Wrapper, {}, null);
                api.projectNamedSlot(wrapper, 'header', api.text('OWNED'));
                root.appendChild(wrapper);
                return root;
            }
        }

        registerComponents({ Inner, Wrapper, Outer });
        const container = window.document.createElement('div');
        window.document.body.appendChild(container);
        await mount(Outer, container, {});

        expect(container.querySelector('[data-fixture="own"]') == null).toBe(true);
        expect(container.querySelector('div[data-vmz="Inner"] slot[name="header"]') != null).toBe(true);
        expect(container.textContent).toBe('OWNED');
        container.remove();
    });

    it('keeps an unmatched named projection out of the default slot', async () => {
        const window = installDom();

        class Plain {
            static __vmzDirect = true;
            static __vmzCreate(api: any) {
                const root = api.el('div');
                const body = api.el('section');
                body.appendChild(api.el('slot'));
                root.appendChild(body);
                return root;
            }
        }

        class Missing {
            static __vmzDirect = true;
            static __vmzCreate(api: any) {
                const root = api.el('div');
                const plain = api.component(this, Plain, {}, null);
                api.projectNamedSlot(plain, 'footer', api.text('NOPE'));
                api.projectDefaultSlot(plain, api.text('OK'));
                root.appendChild(plain);
                return root;
            }
        }

        registerComponents({ Plain, Missing });
        const container = window.document.createElement('div');
        window.document.body.appendChild(container);
        await mount(Missing, container, {});

        expect(container.textContent).toBe('OK');
        expect(container.textContent).not.toContain('NOPE');
        container.remove();
    });

    it('serializes named content and drops the unused fallback', async () => {
        class SsrCard {
            static __vmzDirect = true;
            static __vmzCreate(api: any) {
                const root = api.el('article');
                const header = api.el('header');
                const headerSlot = namedSlotElement(api, 'header');
                headerSlot.appendChild(api.text('FALLBACK'));
                header.appendChild(headerSlot);
                const body = api.el('section');
                body.appendChild(api.el('slot'));
                root.appendChild(header);
                root.appendChild(body);
                return root;
            }
        }

        class SsrHost {
            static __vmzDirect = true;
            static __vmzCreate(api: any) {
                const root = api.el('div');
                const card = api.component(this, SsrCard, {}, null);
                api.projectNamedSlot(card, 'header', api.text('HEAD'));
                api.projectDefaultSlot(card, api.text('BODY'));
                root.appendChild(card);
                return root;
            }
        }

        const html = await renderToString(SsrHost);
        expect(html).toContain('<header>HEAD</header>');
        expect(html).toContain('<section>BODY</section>');
        expect(html).not.toContain('FALLBACK');
    });

    it('projects a `<template v-for #default>` keyed list into the default slot', async () => {
        const window = installDom();
        const Host = eachSlotHost([{ id: 1, label: 'one' }, { id: 2, label: 'two' }]);
        registerComponents({ ListBox, Host });
        const container = window.document.createElement('div');
        window.document.body.appendChild(container);
        await mount(Host, container, {});

        const items = container.querySelectorAll('ul > li');
        expect(items.length).toBe(2);
        expect(items[0].textContent).toBe('one');
        expect(items[1].textContent).toBe('two');
        container.remove();
    });

    it('serializes a `<template v-for #default>` keyed list', async () => {
        const Host = eachSlotHost([{ id: 1, label: 'one' }, { id: 2, label: 'two' }]);
        registerComponents({ ListBox, Host });
        const html = await renderToString(Host);
        expect(html).toContain('<li>one</li>');
        expect(html).toContain('<li>two</li>');
    });
});

/**
 * Mirrors the emitted `__vmzCreate` for
 *
 *     <NavList><template v-for="i in items" :key="i.id" #default><li>{{ i.label }}</li></template></NavList>
 *
 * Fragment rows are inserted before the each `end` marker and the whole list
 * fragment is projected into the default slot.
 */
class ListBox {
    static __vmzDirect = true;
    static __vmzCreate(api: any) {
        const ul = api.el('ul');
        ul.appendChild(api.el('slot'));
        return ul;
    }
}

function eachSlotHost(items: Array<{ id: number; label: string }>) {
    return class EachSlotHost {
        items = items;
        static __vmzDirect = true;
        static __vmzCreate(api: any) {
            const root = api.el('section');
            const list = api.component(this, ListBox, {}, null);
            const frag = api.frag();
            const start = api.comment('vmz-each:');
            const end = api.comment('/vmz-each');
            frag.appendChild(start);
            frag.appendChild(end);
            const keyed = new Map<number, any[]>();
            const apply = () => {
                const next = new Set(this.items.map((it) => it.id));
                for (const k of Array.from(keyed.keys())) {
                    if (next.has(k)) continue;
                    for (const node of keyed.get(k)!) if (node.parentNode) node.remove();
                    keyed.delete(k);
                }
                for (const it of this.items) {
                    if (keyed.has(it.id)) continue;
                    const li = api.el('li');
                    const text = api.text('');
                    api.trackPatch(
                        this,
                        ['items.*.label'],
                        function () {
                            text.textContent = String(it.label ?? '');
                        },
                        null,
                    );
                    li.appendChild(text);
                    const row = [li];
                    if (end.parentNode) for (const node of row) end.parentNode.insertBefore(node, end);
                    keyed.set(it.id, row);
                }
            };
            apply();
            api.projectDefaultSlot(list, frag);
            root.appendChild(list);
            return root;
        }
    };
}
