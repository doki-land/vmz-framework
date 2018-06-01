/**
 * Layout SSR slotHtml must target the layout-owned default slot, never nested
 * component slots (e.g. Button label inside SiteChrome).
 */
import { parseHTML } from 'linkedom';
import { describe, it } from 'node:test';
import { expect } from '../../../../../scripts/test/expect.mjs';
import { renderToString } from '@vmz/core/dom';

describe('layout slotHtml injection', () => {
    it('injects page HTML into layout slot, not nested Button slot', async () => {
        const { window } = parseHTML('<!doctype html><html><body></body></html>');
        globalThis.document = window.document;
        globalThis.HTMLElement = window.HTMLElement;
        globalThis.Node = window.Node;

        class Button {
            static __vmzDirect = true;
            static __vmzCreate(api) {
                const btn = api.el('button');
                api.attr(btn, 'class', 'vmz-ui-btn');
                const slot = api.el('slot');
                btn.appendChild(slot);
                return btn;
            }
        }

        class SiteChrome {
            static __vmzDirect = true;
            static __vmzCreate(api) {
                const header = api.el('header');
                const c = api.component(this, 'Button', {}, null);
                const t = api.text('ZH');
                api.projectDefaultSlot(c, t);
                header.appendChild(c);
                return header;
            }
        }

        class Layout {
            static __vmzDirect = true;
            static __vmzCreate(api) {
                const root = api.el('div');
                api.attr(root, 'class', 'layout');
                const chrome = api.component(this, 'SiteChrome', {}, null);
                const main = api.el('main');
                api.attr(main, 'class', 'layout__main');
                const slot = api.el('slot');
                main.appendChild(slot);
                root.appendChild(chrome);
                root.appendChild(main);
                return root;
            }
        }

        const { registerComponents } = await import('@vmz/core/dom');
        registerComponents({ Button, SiteChrome });

        const html = await renderToString(
            Layout,
            {},
            {
                slotHtml: '<div class="home">PAGE</div>',
            },
        );

        expect(html).toContain('class="layout"');
        expect(html).toContain('class="layout__main"');
        expect(html).toContain('<div class="home">PAGE</div>');
        // Page must not land inside the chrome Button (check button inner HTML only).
        const btnInner = html.match(/vmz-ui-btn[^>]*>([\s\S]*?)<\/button>/)?.[1] ?? '';
        expect(btnInner).not.toContain('class="home"');
        expect(btnInner).toContain('ZH');
        const mainInner = html.match(/layout__main[^>]*>([\s\S]*?)<\/main>/)?.[1] ?? '';
        expect(mainInner).toContain('<div class="home">PAGE</div>');
    });
});
