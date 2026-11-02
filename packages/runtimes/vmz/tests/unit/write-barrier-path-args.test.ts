/**
 * Write-path runtime contracts for mutator args and dynamic path segments:
 * the compiler passes the mutator argument list as one array, computed
 * segments arrive as live values, and two-segment object paths never fall
 * into the array-item fast path.
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

class PathArgsLike {
    static __vmzDirect = true;
    static __vmzWriteBarrier = true;
    static __vmzState = ['cells', 'user'];
    cells = [
        { id: 'a', text: 'A' },
        { id: 'b', text: 'B' },
    ];
    user = { address: { city: 'x', count: 0 } };
    static __vmzCreate(api) {
        const root = api.el('div');
        const span = api.el('span');
        const t = api.text('');
        api.trackPatch(this, ['user.address.city'], function () {
            t.textContent = String(this.user.address.city ?? '');
        }, 0);
        span.appendChild(t);
        root.appendChild(span);
        return root;
    }
}

describe('write-barrier path args contract', () => {
    it('applies mutator argument lists passed as one array', async () => {
        setupDom();
        const host = document.createElement('div');
        document.body.appendChild(host);
        const inst = await mount(PathArgsLike, host);
        const ctor = inst.constructor;
        ctor.__vmzArrayMutate(inst, 'cells', [], 'splice', [1, 0, { id: 'x', text: 'X' }]);
        expect(inst.cells.length).toBe(3);
        expect(inst.cells[1].id).toBe('x');
        ctor.__vmzArrayMutate(inst, 'cells', [], 'push', [{ id: 'p', text: 'P' }]);
        expect(inst.cells.length).toBe(4);
        ctor.__vmzArrayMutate(inst, 'cells', [], 'pop', []);
        expect(inst.cells.length).toBe(3);
    });

    it('rejects stale bare mutator args with a structured error', async () => {
        setupDom();
        const host = document.createElement('div');
        document.body.appendChild(host);
        const inst = await mount(PathArgsLike, host);
        const ctor = inst.constructor;
        assert.throws(() => ctor.__vmzArrayMutate(inst, 'cells', [], 'splice', 1), /argument list as one array/);
        assert.throws(
            () => ctor.__vmzArrayMutate(inst, 'cells', [], 'push', { id: 'p' }),
            /argument list as one array/,
        );
        expect(inst.cells.length).toBe(2);
    });

    it('writes computed root index segments by value', async () => {
        setupDom();
        const host = document.createElement('div');
        document.body.appendChild(host);
        const inst = await mount(PathArgsLike, host);
        const ctor = inst.constructor;
        const i = 1;
        ctor.__vmzWritePath(inst, 'cells', [i], { id: 'b', text: 'B2' });
        expect(inst.cells[1].text).toBe('B2');
        expect(inst.cells.length).toBe(2);
        expect(inst.cells[0].text).toBe('A');
    });

    it('keeps two-segment object paths off the array item fast path', async () => {
        setupDom();
        const host = document.createElement('div');
        document.body.appendChild(host);
        const inst = await mount(PathArgsLike, host);
        const ctor = inst.constructor;
        ctor.__vmzWritePath(inst, 'user', ['address', 'city'], 'Paris');
        expect(inst.user.address.city).toBe('Paris');
        await flushPending(inst);
        expect(host.querySelector('span')?.textContent).toBe('Paris');
        ctor.__vmzWritePathCompound(inst, 'user', ['address', 'count'], '+', 2);
        expect(inst.user.address.count).toBe(2);
        // Direct item-helper calls on an object root fall back to the generic path.
        ctor.__vmzWritePathItem(inst, 'user', 'address', 'city', 'Lyon');
        expect(inst.user.address.city).toBe('Lyon');
        ctor.__vmzWritePathCompoundItem(inst, 'user', 'address', 'count', '+', 1);
        expect(inst.user.address.count).toBe(3);
    });

    it('keeps the array item fast path precise for real arrays', async () => {
        setupDom();
        const host = document.createElement('div');
        document.body.appendChild(host);
        const inst = await mount(PathArgsLike, host);
        const ctor = inst.constructor;
        ctor.__vmzWritePathItem(inst, 'cells', 0, 'text', 'A9');
        expect(inst.cells[0].text).toBe('A9');
        ctor.__vmzWritePathCompoundItem(inst, 'cells', 1, 'text', '+', '!');
        expect(inst.cells[1].text).toBe('B!');
    });
});
