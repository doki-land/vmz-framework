/**
 * v0.1.8: routing.strategy `none` — Host preference + LocaleTransition (no URL rewrite).
 */
import { describe, it } from 'node:test';
import { expect } from '../../../../../scripts/test/expect.mjs';
import { installClientNavigation } from '@vmz/core/client-nav';

function mockDoc(routing) {
    const attrs = new Map();
    if (routing) {
        attrs.set('data-vmz-locale-routing', JSON.stringify(routing));
    }
    attrs.set('data-locale', 'en-us');
    attrs.set('lang', 'en-us');
    const el = {
        getAttribute(name) {
            return attrs.has(name) ? attrs.get(name) : null;
        },
        setAttribute(name, value) {
            attrs.set(name, String(value));
        },
    };
    return {
        documentElement: el,
        addEventListener() {},
        removeEventListener() {},
        cookie: '',
        _attrs: attrs,
    };
}

describe('locale none host transition (v0.1.8)', () => {
    it('__vmzTransitionLocale persists preference without URL rewrite', async () => {
        const store = new Map();
        const prevLS = globalThis.localStorage;
        globalThis.localStorage = {
            getItem: (k) => (store.has(k) ? store.get(k) : null),
            setItem: (k, v) => {
                store.set(k, String(v));
            },
            removeItem: (k) => {
                store.delete(k);
            },
        };

        const doc = mockDoc({
            strategy: 'none',
            defaultLocale: 'en-us',
            locales: ['en-us', 'zh-hans'],
        });
        let reloaded = false;
        const loc = {
            pathname: '/',
            search: '',
            hash: '',
            href: 'http://127.0.0.1/',
            reload() {
                reloaded = true;
            },
        };
        const hist = {
            pushState() {},
            replaceState() {},
            scrollRestoration: 'auto',
        };
        const prevWin = globalThis.window;
        const win = {
            __vmzLocaleIdHint: undefined,
            location: loc,
            history: hist,
            document: doc,
            addEventListener() {},
            removeEventListener() {},
        };
        globalThis.window = win;
        globalThis.document = doc;

        try {
            const nav = installClientNavigation({
                document: doc,
                history: hist,
                location: loc,
                fetchImpl: async () => new Response('<html></html>', { status: 200 }),
            });
            expect(nav.ok).toBe(true);
            expect(typeof win.__vmzTransitionLocale).toBe('function');

            const out = await win.__vmzTransitionLocale('zh-hans', { reload: true });
            expect(out.status).toBe('committed');
            expect(out.strategy).toBe('none');
            expect(store.get('vmz.locale')).toBe('zh-hans');
            expect(doc.documentElement.getAttribute('data-locale')).toBe('zh-hans');
            expect(win.__vmzLocaleIdHint).toBe('zh-hans');
            expect(reloaded).toBe(true);
            expect(String(doc.cookie || '')).toMatch(/vmz\.locale=zh-hans/);

            const rejected = await win.__vmzTransitionLocale('ja-jp', { reload: false });
            expect(rejected.status).toBe('rejected');
            expect(rejected.reason).toBe('unsupported');
            expect(doc.documentElement.getAttribute('data-locale')).toBe('zh-hans');
        } finally {
            if (prevLS === undefined) delete globalThis.localStorage;
            else globalThis.localStorage = prevLS;
            if (prevWin === undefined) delete globalThis.window;
            else globalThis.window = prevWin;
            delete globalThis.document;
        }
    });

    it('prefix strategy still rejects unsupported without touching none persist', async () => {
        const doc = mockDoc({
            strategy: 'prefix',
            defaultLocale: 'en-us',
            defaultPrefix: 'include',
            locales: ['en-us', 'zh-hans'],
        });
        const loc = { pathname: '/', search: '', hash: '', href: 'http://127.0.0.1/', reload() {} };
        const hist = { pushState() {}, replaceState() {}, scrollRestoration: 'auto' };
        const win = { location: loc, history: hist, document: doc, addEventListener() {}, removeEventListener() {} };
        const prevWin = globalThis.window;
        globalThis.window = win;
        globalThis.document = doc;
        try {
            const nav = installClientNavigation({
                document: doc,
                history: hist,
                location: loc,
                fetchImpl: async () => new Response('<html data-locale="en-us"></html>', { status: 200 }),
            });
            expect(nav.ok).toBe(true);
            const rejected = await win.__vmzTransitionLocale('ja-jp');
            expect(rejected.status).toBe('rejected');
        } finally {
            if (prevWin === undefined) delete globalThis.window;
            else globalThis.window = prevWin;
            delete globalThis.document;
        }
    });
});
