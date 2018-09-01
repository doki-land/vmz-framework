/**
 * v0.1.7: rowKernel + createItem:null must SSR via IR-homologous serializeItem
 * (not regex fill of rowKernel.html / linkedom).
 */
import { afterEach, describe, it } from 'node:test';
import { expect } from '../../../../../scripts/test/expect.mjs';
import { renderToString } from '@vmz/core/dom';

afterEach(() => {
    delete (globalThis as any).document;
    delete (globalThis as any).window;
});

/** Mimic generator serializeItem body for a simple article row. */
function dealSerializeItem(api: any, box: { item: { title: string; note: string } }) {
    const root = api.el('article');
    api.attr(root, 'class', 'deal');
    const h = api.el('h3');
    const tTitle = api.text('');
    api.bindText(
        this,
        null,
        [],
        function () {
            return box.item.title;
        },
        tTitle,
    );
    h.appendChild(tTitle);
    root.appendChild(h);
    const p = api.el('p');
    const tNote = api.text('');
    api.bindText(
        this,
        null,
        [],
        function () {
            return box.item.note;
        },
        tNote,
    );
    p.appendChild(tNote);
    root.appendChild(p);
    return root;
}

describe('rowKernel SSR (serializeItem / IR)', () => {
    it('renderToString uses serializeItem without document or hydrate', async () => {
        delete (globalThis as any).document;
        delete (globalThis as any).window;

        let hydrateCalls = 0;
        class DealsPage {
            deals = [
                { id: 'a', title: 'Deal A', note: 'N1' },
                { id: 'b', title: 'Deal B', note: 'N2' },
            ];
            static __vmzDirect = true;
            static __vmzCreate(api: any) {
                const root = api.el('div');
                api.attr(root, 'class', 'home');
                const list = api.eachBlock(this, 1, ['deals'], {
                    list() {
                        return this.deals;
                    },
                    key(box: { item: { id: string } }) {
                        return box.item.id;
                    },
                    createItem: null,
                    serializeItem: dealSerializeItem,
                    rowKernel: {
                        html: '<article class="deal"><h3> </h3><p> </p></article>',
                        textSlots: { title: 0, note: 1 },
                        hydrate() {
                            hydrateCalls++;
                            throw new Error('hydrate must not run when serializeItem is present');
                        },
                    },
                });
                root.appendChild(list);
                return root;
            }
        }

        const html = await renderToString(DealsPage);
        expect(hydrateCalls).toBe(0);
        expect(html).toContain('class="home"');
        expect(html).toContain('data-vmz-key="a"');
        expect(html).toContain('data-vmz-key="b"');
        expect(html).toContain('<h3>Deal A</h3>');
        expect(html).toContain('<p>N1</p>');
        expect(html).toContain('<h3>Deal B</h3>');
        expect(html).toContain('<p>N2</p>');
        expect(html).toContain('class="deal"');
    });

    it('escapes item text via serializeItem bindText', async () => {
        delete (globalThis as any).document;
        delete (globalThis as any).window;

        class Page {
            rows = [{ id: '1', label: '<script>x</script>' }];
            static __vmzDirect = true;
            static __vmzCreate(api: any) {
                const root = api.el('ul');
                root.appendChild(
                    api.eachBlock(this, 1, ['rows'], {
                        list() {
                            return this.rows;
                        },
                        key(box: { item: { id: string } }) {
                            return box.item.id;
                        },
                        createItem: null,
                        serializeItem(apiInner: any, box: { item: { label: string } }) {
                            const li = apiInner.el('li');
                            const t = apiInner.text('');
                            apiInner.bindText(
                                this,
                                null,
                                [],
                                function () {
                                    return box.item.label;
                                },
                                t,
                            );
                            li.appendChild(t);
                            return li;
                        },
                    }),
                );
                return root;
            }
        }

        const html = await renderToString(Page);
        expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
        expect(html).not.toContain('<script>x</script>');
    });
});
