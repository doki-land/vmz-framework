/**
 * `<component :is="expr">` dynamic boundary.
 *
 * The evaluated `is` value must resolve the real component, switching must tear
 * down the old child and mount the new one in the same host element, props must
 * be re-evaluated per mount, and `@event` listeners must survive the switch.
 */
import { parseHTML } from 'linkedom';
import { afterEach, describe, it } from 'node:test';
import { expect } from '../../../../../scripts/test/expect.mjs';
import { flushPending, mount, registerComponents, renderToString } from '@vmz/core/dom';

function installDom() {
    const { window } = parseHTML('<!doctype html><html><body></body></html>');
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;
    globalThis.Node = window.Node;
    globalThis.Comment = window.Comment;
    globalThis.DocumentFragment = window.DocumentFragment;
    globalThis.Text = window.Text;
    return window;
}

class Alpha {
    static __vmzDirect = true;
    label = '';
    constructor(props: any = {}) {
        this.label = props.label ?? '';
    }
    static __vmzCreate(api: any) {
        const root = api.el('p');
        api.attr(root, 'data-kind', 'alpha');
        root.appendChild(api.text(String(this.label ?? '')));
        return root;
    }
}

class Beta {
    static __vmzDirect = true;
    label = '';
    constructor(props: any = {}) {
        this.label = props.label ?? '';
    }
    static __vmzCreate(api: any) {
        const root = api.el('p');
        api.attr(root, 'data-kind', 'beta');
        root.appendChild(api.text(String(this.label ?? '')));
        return root;
    }
}

afterEach(() => {
    delete (globalThis as any).document;
    delete (globalThis as any).window;
    delete (globalThis as any).MutationObserver;
});

/** Mirrors the emitted `dynamicComponent` call for `<component :is="kind" :label="label" />`. */
class DynHost {
    static __vmzDirect = true;
    static __vmzState = ['kind', 'label'];
    kind = 'alpha';
    label = 'L1';
    pings = 0;
    static __vmzCreate(api: any) {
        const root = api.el('section');
        const is = function () {
            return this.kind === 'alpha' ? Alpha : Beta;
        };
        const props = function () {
            return { label: this.label };
        };
        const host = api.dynamicComponent(this, null, ['kind'], is, props);
        api.onComponentEvent(host, 'ping', () => {
            this.pings += 1;
        });
        root.appendChild(host);
        return root;
    }
}

describe('dynamic component', () => {
    it('mounts the resolved component and swaps it in the same host', async () => {
        const window = installDom();
        registerComponents({ Alpha, Beta, DynHost });
        const container = window.document.createElement('div');
        window.document.body.appendChild(container);
        const inst = await mount(DynHost, container, {});

        const host = container.querySelector('section > div') as any;
        expect(host.getAttribute('data-vmz')).toBe('Alpha');
        expect(host.querySelector('p').getAttribute('data-kind')).toBe('alpha');
        expect(host.querySelector('p').textContent).toBe('L1');

        const oldChild = host.__vmzInst;
        expect(oldChild).toBeTruthy();

        inst.kind = 'beta';
        inst.label = 'L2';
        await flushPending(inst);

        expect(container.querySelector('section > div')).toBe(host);
        expect(host.getAttribute('data-vmz')).toBe('Beta');
        expect(host.querySelector('p').getAttribute('data-kind')).toBe('beta');
        expect(host.querySelector('p').textContent).toBe('L2');
        expect(oldChild.__vmzDestroyed).toBe(true);
        expect(host.__vmzInst).not.toBe(oldChild);

        host.__vmzInst.emit('ping');
        expect(inst.pings).toBe(1);
        container.remove();
    });

    it('serializes the resolved component on the server', async () => {
        registerComponents({ Alpha, Beta, DynHost });
        const html = await renderToString(DynHost);
        expect(html).toContain('data-vmz="Alpha"');
        expect(html).toContain('data-kind="alpha"');
        expect(html).toContain('<p data-kind="alpha">L1</p>');
    });
});
