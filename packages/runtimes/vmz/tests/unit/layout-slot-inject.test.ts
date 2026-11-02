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

    it('omits projected children when the component has no mounted default slot', async () => {
        const { window } = parseHTML('<!doctype html><html><body></body></html>');
        globalThis.document = window.document;
        globalThis.HTMLElement = window.HTMLElement;
        globalThis.Node = window.Node;

        class ClosedSurface {
            static __vmzDirect = true;
            static __vmzCreate(api) {
                const root = api.el('div');
                api.attr(root, 'class', 'closed');
                return root;
            }
        }

        class Page {
            static __vmzDirect = true;
            static __vmzCreate(api) {
                const root = api.el('main');
                const surface = api.component(this, 'ClosedSurface', {}, null);
                api.projectDefaultSlot(surface, api.text('LEAKED'));
                root.appendChild(surface);
                return root;
            }
        }

        const { registerComponents } = await import('@vmz/core/dom');
        registerComponents({ ClosedSurface });

        const html = await renderToString(Page, {});
        expect(html).toContain('class="closed"');
        expect(html).not.toContain('LEAKED');
    });
});

describe('layout slot hydration', () => {
    it('hydrates the page into a multi-root layout default slot', async () => {
        // Multi-root layout (chrome + `<main><slot /></main>` + chrome) compiles
        // to a DocumentFragment root. The outlet search must run against the
        // live container, not the emptied fragment, or the page hydrates into
        // a detached tree and the document keeps only an empty `<slot>`.
        const { window } = parseHTML('<!doctype html><html><body></body></html>');
        globalThis.document = window.document;
        globalThis.HTMLElement = window.HTMLElement;
        globalThis.Node = window.Node;

        class SiteHeader {
            static __vmzDirect = true;
            static __vmzCreate(api) {
                const h = api.el('header');
                h.appendChild(api.text('HDR'));
                return h;
            }
        }
        class SiteFooter {
            static __vmzDirect = true;
            static __vmzCreate(api) {
                const f = api.el('footer');
                f.appendChild(api.text('FTR'));
                return f;
            }
        }
        class Layout {
            static __vmzDirect = true;
            static __vmzCreate(api) {
                const frag = api.frag();
                const header = api.component(this, 'SiteHeader', {}, null);
                const main = api.el('main');
                main.appendChild(api.el('slot'));
                const footer = api.component(this, 'SiteFooter', {}, null);
                frag.appendChild(header);
                frag.appendChild(main);
                frag.appendChild(footer);
                return frag;
            }
        }
        class Page {
            static __vmzDirect = true;
            static __vmzCreate(api) {
                const div = api.el('div');
                api.attr(div, 'class', 'vos-home');
                div.appendChild(api.text('HOME'));
                return div;
            }
        }

        const { registerComponents } = await import('@vmz/core/dom');
        registerComponents({ SiteHeader, SiteFooter });
        const { hydrateRoute } = await import('@vmz/core/dom/browser');

        const app = document.createElement('div');
        app.setAttribute('id', 'app');
        document.body.appendChild(app);
        await hydrateRoute(Page, app, {}, [Layout]);

        const home = app.querySelector('.vos-home');
        expect(home != null).toBe(true);
        expect(document.body.contains(home)).toBe(true);
        const main = app.querySelector('main');
        expect(main != null && main.contains(home)).toBe(true);
        // The outlet replaced the empty slot: no `<slot>` may survive hydration.
        expect(app.querySelector('slot')).toBe(null);
        // Chrome stays mounted around the projected page.
        expect(app.querySelector('header') != null).toBe(true);
        expect(app.querySelector('footer') != null).toBe(true);
        app.remove();
    });
});
