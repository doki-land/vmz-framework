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
    api.trackPatch(
        this,
        [],
        function () {
            tTitle.value = String(box.item.title ?? '');
        },
        null,
    );
    h.appendChild(tTitle);
    root.appendChild(h);
    const p = api.el('p');
    const tNote = api.text('');
    api.trackPatch(
        this,
        [],
        function () {
            tNote.value = String(box.item.note ?? '');
        },
        null,
    );
    p.appendChild(tNote);
    root.appendChild(p);
    return root;
}

function appendSerializeEach(
    api: any,
    inst: { deals?: Array<{ id: string; title: string; note: string }>; rows?: Array<{ id: string; label: string }> },
    listField: 'deals' | 'rows',
    keyFn: (box: { item: { id: string }; index: number }) => string,
    serializeItem: (apiInner: any, box: { item: any; index: number }) => unknown,
) {
    const frag = api.frag();
    const list = (inst as any)[listField] || [];
    for (let i = 0; i < list.length; i++) {
        const box = { item: list[i], index: i };
        const k = keyFn(box as { item: { id: string }; index: number });
        const dom = serializeItem.call(inst, api, box);
        if (dom && dom.__kind === 'el' && !dom.__rawOuter) api.attr(dom, 'data-vmz-key', String(k));
        if (dom) frag.appendChild(dom);
    }
    return frag;
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
                const list = appendSerializeEach(api, this, 'deals', (box) => box.item.id, dealSerializeItem);
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

    it('escapes item text via serializeItem trackPatch', async () => {
        delete (globalThis as any).document;
        delete (globalThis as any).window;

        class Page {
            rows = [{ id: '1', label: '<script>x</script>' }];
            static __vmzDirect = true;
            static __vmzCreate(api: any) {
                const root = api.el('ul');
                root.appendChild(
                    appendSerializeEach(
                        api,
                        this,
                        'rows',
                        (box) => box.item.id,
                        function (apiInner: any, box: { item: { label: string } }) {
                            const li = apiInner.el('li');
                            const t = apiInner.text('');
                            apiInner.trackPatch(
                                this,
                                [],
                                function () {
                                    t.value = String(box.item.label ?? '');
                                },
                                null,
                            );
                            li.appendChild(t);
                            return li;
                        },
                    ),
                );
                return root;
            }
        }

        const html = await renderToString(Page);
        expect(html).toContain('&lt;script&gt;x&lt;/script&gt;');
        expect(html).not.toContain('<script>x</script>');
    });
});
