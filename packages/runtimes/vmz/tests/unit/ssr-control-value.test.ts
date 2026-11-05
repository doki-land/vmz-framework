/**
 * SSR control values: `textarea` renders its value as text content and `select`
 * renders it as a selected option, because neither survives as a `value`
 * attribute in HTML.
 */
import { describe, it } from 'node:test';
import { expect } from '../../../../../scripts/test/expect.mjs';
import { renderToString } from '@vmz/core/dom';

class TextareaForm {
    static __vmzDirect = true;
    static __vmzTag = 'TextareaForm';
    msg = 'hello';

    static __vmzCreate(api) {
        const e0 = api.el('div');
        const e1 = api.el('textarea');
        api.specFieldAttr(this, 0, 'msg', e1, 'value');
        e0.appendChild(e1);
        return e0;
    }
}

class EscapedTextarea {
    static __vmzDirect = true;
    static __vmzTag = 'EscapedTextarea';
    msg = 'a & <b>';

    static __vmzCreate(api) {
        const e0 = api.el('textarea');
        api.specFieldAttr(this, 0, 'msg', e0, 'value');
        return e0;
    }
}

class SelectForm {
    static __vmzDirect = true;
    static __vmzTag = 'SelectForm';
    lang = 'b';

    static __vmzCreate(api) {
        const e0 = api.el('select');
        api.specFieldAttr(this, 0, 'lang', e0, 'value');
        for (const v of ['a', 'b']) {
            const opt = api.el('option');
            api.attr(opt, 'value', v);
            opt.appendChild(api.text(v.toUpperCase()));
            e0.appendChild(opt);
        }
        return e0;
    }
}

class InputForm {
    static __vmzDirect = true;
    static __vmzTag = 'InputForm';
    msg = 'hello';
    agree = true;

    static __vmzCreate(api) {
        const e0 = api.el('div');
        const e1 = api.el('input');
        api.specFieldAttr(this, 0, 'msg', e1, 'value');
        const e2 = api.el('input');
        api.attr(e2, 'type', 'checkbox');
        api.specFieldAttr(this, 1, 'agree', e2, 'checked');
        e0.appendChild(e1);
        e0.appendChild(e2);
        return e0;
    }
}

describe('SSR control values', () => {
    it('renders textarea value as text content, not an attribute', async () => {
        const html = await renderToString(TextareaForm, {});
        expect(html).toContain('<textarea>hello</textarea>');
        expect(html).not.toContain('value="hello"');
    });

    it('escapes textarea text content', async () => {
        const html = await renderToString(EscapedTextarea, {});
        expect(html).toContain('<textarea>a &amp; &lt;b&gt;</textarea>');
    });

    it('marks the matching option and drops the select value attribute', async () => {
        const html = await renderToString(SelectForm, {});
        expect(html).not.toContain('<select value=');
        expect(html).toContain('<option value="a">A</option>');
        expect(html).toContain('<option value="b" selected="">B</option>');
    });

    it('keeps input value and checked as attributes', async () => {
        const html = await renderToString(InputForm, {});
        expect(html).toContain('<input value="hello">');
        expect(html).toContain('<input type="checkbox" checked="">');
    });
});
