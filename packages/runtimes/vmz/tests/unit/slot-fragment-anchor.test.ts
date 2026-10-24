/**
 * Slot projection anchors must survive DocumentFragment projections.
 *
 * A v-if branch projects a fragment whose children move into the slot on insert.
 * Anchoring on the emptied fragment made every later sibling park forever, so a
 * lazily shown component (e.g. Message inside a Card) mounted into a detached
 * document fragment and never reached the document.
 */
import { parseHTML } from 'linkedom';
import { describe, it } from 'node:test';
import { expect } from '../../../../../scripts/test/expect.mjs';
import { mount } from '@vmz/core/dom';

describe('slot projection fragment anchor', () => {
    it('projects siblings after a fragment into the document', async () => {
        const { window } = parseHTML('<!doctype html><html><body></body></html>');
        globalThis.document = window.document;
        globalThis.HTMLElement = window.HTMLElement;
        globalThis.Node = window.Node;
        globalThis.Comment = window.Comment;
        globalThis.DocumentFragment = window.DocumentFragment;
        globalThis.Text = window.Text;

        class Surface {
            static __vmzDirect = true;
            static __vmzCreate(api) {
                const root = api.el('section');
                const body = api.el('div');
                api.attr(body, 'class', 'body');
                body.appendChild(api.el('slot'));
                root.appendChild(body);
                return root;
            }
        }

        class Host {
            static __vmzDirect = true;
            static __vmzCreate(api) {
                const root = api.el('div');
                const surface = api.component(this, 'Surface', {}, null);
                api.projectDefaultSlot(surface, api.text('first'));
                const frag = api.frag();
                frag.appendChild(api.comment('vmz-if'));
                frag.appendChild(api.comment('/vmz-if'));
                api.projectDefaultSlot(surface, frag);
                const after = api.el('p');
                api.attr(after, 'data-fixture', 'after-fragment');
                after.appendChild(api.text('after'));
                api.projectDefaultSlot(surface, after);
                root.appendChild(surface);
                return root;
            }
        }

        const { registerComponents } = await import('@vmz/core/dom');
        registerComponents({ Surface, Host });

        const container = document.createElement('div');
        document.body.appendChild(container);
        const dispose = await mount(Host, container, {});
        const projected = container.querySelector('[data-fixture="after-fragment"]');
        expect(projected != null).toBe(true);
        expect(projected.textContent).toBe('after');
        expect(container.querySelector('.body').textContent).toBe('firstafter');
        if (typeof dispose === 'function') dispose();
        container.remove();
    });
});
