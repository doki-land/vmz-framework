/**
 * rowKernel SSR with createItem omitted must not require a preinstalled document.
 * Document-free path fills html + textSlots (farm-h5 deals / ERR_EMPTY_RESPONSE regression).
 */
import { afterEach, describe, it } from 'node:test';
import { expect } from '../../../../../scripts/test/expect.mjs';
import { renderToString } from '@vmz/core/dom';

afterEach(() => {
    delete (globalThis as any).document;
    delete (globalThis as any).window;
});

describe('rowKernel SSR (createItem omitted)', () => {
    it('renderToString fills textSlots without document / without calling hydrate', async () => {
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
                    rowKernel: {
                        html: '<article class="deal"><h3> </h3><p> </p></article>',
                        textSlots: { title: 0, note: 1 },
                        itemFields: ['note', 'title'],
                        hydrate() {
                            hydrateCalls++;
                            throw new Error('hydrate must not run on document-free SSR path');
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

    it('escapes item text in document-free rowKernel fill', async () => {
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
                        rowKernel: {
                            html: '<li> </li>',
                            textSlots: { label: 0 },
                            hydrate() {
                                throw new Error('hydrate must not run');
                            },
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
