/**
 * locale-transition gate — __vmzTransitionLocale observability (VMZ-5).
 */
import { installClientNavigation } from '@vmz/core/client-nav';

function fail(msg) {
    console.error(`LOCALE-TRANSITION GATE FAIL: ${msg}`);
    process.exit(1);
}

function mockDoc(routing) {
    const attrs = new Map();
    if (routing) attrs.set('data-vmz-locale-routing', JSON.stringify(routing));
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
    };
}

console.log('locale-transition: observability…');

const doc = mockDoc({
    strategy: 'none',
    defaultLocale: 'en-us',
    locales: ['en-us', 'zh-hans'],
});
const loc = { pathname: '/', search: '', hash: '', href: 'http://127.0.0.1/', reload() {} };
const hist = { pushState() {}, replaceState() {}, scrollRestoration: 'auto' };
const win = {
    location: loc,
    history: hist,
    document: doc,
    addEventListener() {},
    removeEventListener() {},
    __vmzLastLocaleTransition: undefined,
};
const prevWin = globalThis.window;
globalThis.window = win;
globalThis.document = doc;
globalThis.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
};

try {
    installClientNavigation({
        document: doc,
        history: hist,
        location: loc,
        fetchImpl: async () => new Response('<html></html>', { status: 200 }),
    });
    if (typeof win.__vmzTransitionLocale !== 'function') fail('missing __vmzTransitionLocale');

    const noop = await win.__vmzTransitionLocale('en-us', { reload: false });
    if (noop.status !== 'committed' || noop.reason !== 'noop') fail(`noop: ${JSON.stringify(noop)}`);
    if (win.__vmzLastLocaleTransition?.reason !== 'noop') fail('__vmzLastLocaleTransition noop');

    const bad = await win.__vmzTransitionLocale('ja-jp', { reload: false });
    if (bad.status !== 'rejected' || bad.reason !== 'unsupported') fail(`unsupported: ${JSON.stringify(bad)}`);
    if (win.__vmzLastLocaleTransition?.status !== 'rejected') fail('__vmzLastLocaleTransition reject');
} finally {
    if (prevWin === undefined) delete globalThis.window;
    else globalThis.window = prevWin;
    delete globalThis.document;
    delete globalThis.localStorage;
}

console.log('LOCALE-TRANSITION GATE OK');
