/**
 * Trusted `html={}` runtime smoke (directApi + serialize).
 */
import { parseHTML } from 'linkedom';
import { describe, it } from 'node:test';
import { expect } from '../../../../scripts/test-expect.mjs';
import { renderToString } from '@vmz/core/dom';

describe('trusted html binding', () => {
    it('serialize emits raw HTML without escaping', async () => {
        const { window } = parseHTML('<!doctype html><html><body></body></html>');
        globalThis.document = window.document;
        globalThis.HTMLElement = window.HTMLElement;
        globalThis.Node = window.Node;

        class HtmlDemo {
            static __vmzDirect = true;
            markup = '<b>ok</b>';

            static __vmzCreate(api) {
                const e0 = api.el('div');
                api.bindHtml(
                    this,
                    null,
                    ['markup'],
                    function () {
                        return this.markup;
                    },
                    e0,
                );
                return e0;
            }
        }

        const html = await renderToString(HtmlDemo, {});
        expect(html).toContain('<b>ok</b>');
        expect(html).not.toContain('&lt;b&gt;');
    });
});
