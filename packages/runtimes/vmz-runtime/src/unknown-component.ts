/**
 * Unknown Direct component resilience (`ssr-unknown-component-error-node`).
 * Leaf failure → subtree error node; do not throw out of document SSR.
 */

/** @type {string} */
export const UNKNOWN_COMPONENT_ERROR = 'unknown-component';

/**
 * @returns {boolean}
 */
function isDevSurface() {
    try {
        if (typeof process !== 'undefined' && process.env) {
            if (process.env.VMZ_DEV === '1' || process.env.VMZ_DEV === 'true') return true;
            if (process.env.NODE_ENV === 'development') return true;
        }
    } catch {
        /* ignore */
    }
    return false;
}

/**
 * Append a leaf diagnostic for tooling (does not replace the error node).
 * @param {string} name
 * @param {string} [via]
 */
export function noteUnknownComponent(name, via = 'ssr') {
    const detail = { kind: UNKNOWN_COMPONENT_ERROR, component: String(name || ''), via };
    try {
        if (typeof console !== 'undefined' && typeof console.error === 'function') {
            console.error(`vmz:dom unknown component <${name} /> (${via})`);
        }
    } catch {
        /* ignore */
    }
    try {
        const g = typeof globalThis !== 'undefined' ? globalThis : null;
        if (!g) return;
        if (!Array.isArray(g.__VMZ_COMPONENT_ERRORS__)) {
            g.__VMZ_COMPONENT_ERRORS__ = [];
        }
        /** @type {unknown[]} */
        const bag = g.__VMZ_COMPONENT_ERRORS__;
        bag.push(detail);
    } catch {
        /* ignore */
    }
}

/**
 * SSR serialize-tree error node (keeps document HTTP 200).
 * @param {string} name
 */
export function serializeUnknownComponentNode(name) {
    noteUnknownComponent(name, 'ssr');
    /** @type {Record<string, string>} */
    const attrs = {
        'data-vmz-error': UNKNOWN_COMPONENT_ERROR,
        'data-vmz-component': String(name || ''),
    };
    /** @type {any[]} */
    const children = [];
    if (isDevSurface()) {
        children.push({
            __kind: 'text',
            value: `Unknown component <${name} />`,
        });
    }
    return {
        __kind: 'el',
        tag: 'div',
        attrs,
        children,
        appendChild(c) {
            if (c != null) this.children.push(c);
        },
    };
}

/**
 * Live DOM error host (client create / schedule).
 * @param {string} name
 * @param {string} [via]
 * @returns {HTMLElement}
 */
export function createUnknownComponentElement(name, via = 'client') {
    noteUnknownComponent(name, via);
    const host = document.createElement('div');
    host.setAttribute('data-vmz-error', UNKNOWN_COMPONENT_ERROR);
    host.setAttribute('data-vmz-component', String(name || ''));
    if (isDevSurface()) {
        host.textContent = `Unknown component <${name} />`;
    }
    return host;
}

/**
 * Mark an existing island host as unknown (resume / EventEntry).
 * @param {HTMLElement} el
 * @param {string} name
 * @param {string} [via]
 */
export function markUnknownComponentHost(el, name, via = 'resume') {
    if (!el) return;
    noteUnknownComponent(name, via);
    el.setAttribute('data-vmz-error', UNKNOWN_COMPONENT_ERROR);
    el.setAttribute('data-vmz-component', String(name || ''));
}
