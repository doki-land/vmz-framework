/**
 * Root-field ++/-- stay plain JS (compiler contract) and flow through the
 * reactive field setter; the write-path runtime rejects empty-segment calls
 * with a structured error instead of silently dropping the write.
 */
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { describe, it } from 'node:test';
import { expect } from '../../../../../scripts/test/expect.mjs';
import { flushPending, mount } from '@vmz/core/dom';

function setupDom() {
    const { window } = parseHTML('<!doctype html><html><body></body></html>');
    globalThis.window = window;
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;
    globalThis.Node = window.Node;
    globalThis.Comment = window.Comment;
    globalThis.DocumentFragment = window.DocumentFragment;
    globalThis.Text = window.Text;
    return window;
}

class RootUpdateLike {
    static __vmzDirect = true;
    static __vmzWriteBarrier = true;
    static __vmzState = ['count', 'user'];
    count = 0;
    user = { count: 0 };
    static __vmzCreate(api) {
        const root = api.el('div');
        const strong = api.el('strong');
        const t = api.text('');
        api.specFieldText(this, 0, 'count', t);
        strong.appendChild(t);
        root.appendChild(strong);
        return root;
    }
}

describe('write-barrier root update guard', () => {
    it('repaints a field text binding when root updates run as plain JS', async () => {
        setupDom();
        const host = document.createElement('div');
        document.body.appendChild(host);
        const inst = await mount(RootUpdateLike, host);
        const strong = () => host.querySelector('strong')?.textContent;
        expect(strong()).toBe('0');
        inst.count++;
        await flushPending(inst);
        expect(strong()).toBe('1');
        ++inst.count;
        await flushPending(inst);
        expect(strong()).toBe('2');
        inst.count--;
        await flushPending(inst);
        expect(strong()).toBe('1');
        --inst.count;
        await flushPending(inst);
        expect(strong()).toBe('0');
    });

    it('rejects empty-segment write paths with a structured error', async () => {
        setupDom();
        const host = document.createElement('div');
        document.body.appendChild(host);
        const inst = await mount(RootUpdateLike, host);
        const ctor = inst.constructor;
        assert.throws(() => ctor.__vmzWritePathCompound(inst, 'count', [], '+', 1), /non-empty path/);
        assert.throws(() => ctor.__vmzWritePath(inst, 'user', [], { count: 9 }), /non-empty path/);
        assert.throws(() => ctor.__vmzWritePathLogical(inst, 'count', [], '||', 1), /non-empty path/);
        assert.throws(() => ctor.__vmzWritePath(inst, 'count', 'count', 1), /non-empty path/);
        expect(inst.count).toBe(0);
        expect(inst.user.count).toBe(0);
    });

    it('keeps nested compound writes working', async () => {
        setupDom();
        const host = document.createElement('div');
        document.body.appendChild(host);
        const inst = await mount(RootUpdateLike, host);
        const ctor = inst.constructor;
        ctor.__vmzWritePathCompound(inst, 'user', ['count'], '+', 1);
        expect(inst.user.count).toBe(1);
        ctor.__vmzWritePath(inst, 'user', ['count'], 5);
        expect(inst.user.count).toBe(5);
    });

    it('still drops writes on destroyed instances without throwing', async () => {
        setupDom();
        const host = document.createElement('div');
        document.body.appendChild(host);
        const inst = await mount(RootUpdateLike, host);
        inst.__vmzDestroyed = true;
        const ctor = inst.constructor;
        expect(ctor.__vmzWritePathCompound(inst, 'count', [], '+', 1)).toBe(undefined);
        expect(ctor.__vmzWritePath(inst, 'count', [], 1)).toBe(1);
        expect(inst.count).toBe(0);
    });
});
