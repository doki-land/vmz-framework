/**
 * Rewrite `@vmz/core` dist imports for flat app delivery layout.
 * Keep in sync with `rewrite_delivery_imports` in vmz-compiler compile.rs.
 */

function replaceImportPath(text: string, from: string, to: string): string {
    let out = text;
    out = out.replaceAll(`'${from}'`, `'${to}'`);
    out = out.replaceAll(`"${from}"`, `"${to}"`);
    return out;
}

function replaceQuotedPrefix(text: string, from: string, to: string): string {
    let out = text;
    out = out.replaceAll(`'${from}`, `'${to}`);
    out = out.replaceAll(`"${from}`, `"${to}`);
    return out;
}

function rewriteFlatDeliveryImports(text: string): string {
    let out = text;
    const pairs: Array<[string, string]> = [
        ['../browser/dom-core.js', './dom-core.js'],
        ['../browser/direct-host-box.js', './direct-host-box.js'],
        ['../browser/unknown-component.js', './unknown-component.js'],
        ['../shared/dom-attr-normalize.js', './dom-attr-normalize.js'],
        ['../browser/client-nav.js', './vmz-client-nav.js'],
        ['../ssr/dom-ssr.js', './dom-ssr.js'],
        ['../faces/server.js', './vmz-runtime.js'],
        ['../faces/vmz-runtime.js', './vmz-runtime.js'],
        ['../faces/http.js', './vmz-http.js'],
    ];
    for (const [from, to] of pairs) {
        out = replaceImportPath(out, from, to);
    }
    return out;
}

function rewriteNestedSsrDelivery(text: string): string {
    let out = text;
    for (const [from, to] of [
        ['../browser/dom-core.js', '../dom-core.js'],
        ['../browser/direct-host-box.js', '../direct-host-box.js'],
        ['../browser/unknown-component.js', '../unknown-component.js'],
    ] as const) {
        out = replaceImportPath(out, from, to);
    }
    return out;
}

function rewriteNestedBrowserDelivery(text: string): string {
    let out = replaceImportPath(text, '../../shared/dom-attr-normalize.js', '../../dom-attr-normalize.js');
    for (const [from, to] of [
        ['../direct-host-box.js', '../../direct-host-box.js'],
        ['../unknown-component.js', '../../unknown-component.js'],
        ['../dom-core.js', '../../dom-core.js'],
    ] as const) {
        out = replaceImportPath(out, from, to);
    }
    return out;
}

function rewriteFlatDeliveryRoot(text: string, outName: string): string {
    let out = rewriteFlatDeliveryImports(text);
    if (outName === 'dom-core.js') {
        for (const [from, to] of [
            ['./diagnostics/', './browser/diagnostics/'],
            ['./dom/', './browser/dom/'],
            ['./reactivity/', './browser/reactivity/'],
        ] as const) {
            out = replaceQuotedPrefix(out, from, to);
        }
    } else if (outName === 'dom-ssr.js') {
        out = replaceImportPath(out, './render.js', './ssr/render.js');
        out = replaceQuotedPrefix(out, '../browser/resume/', './browser/resume/');
    } else if (outName === 'vmz-client-nav.js') {
        out = replaceQuotedPrefix(out, './navigation/', './browser/navigation/');
    } else if (outName === 'dom.browser.js') {
        out = replaceQuotedPrefix(out, '../browser/resume/', './browser/resume/');
    }
    return out;
}

/** @param {string} text @param {string} outName delivery-relative output path */
export function rewriteDeliveryImports(text: string, outName: string): string {
    if (outName.startsWith('ssr/')) return rewriteNestedSsrDelivery(text);
    if (outName.startsWith('browser/')) return rewriteNestedBrowserDelivery(text);
    return rewriteFlatDeliveryRoot(text, outName);
}
