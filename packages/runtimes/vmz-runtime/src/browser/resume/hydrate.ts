import { applyDirectHostBox, directHostBoxStyleAttr } from '../direct-host-box.js';
import {
    applyDomAttr,
    applyPreservedState,
    BOOLEAN_HTML_ATTRS,
    createInstance,
    destroy,
    directApi,
    eventPropHandlerName,
    findOwnedDefaultSlot,
    getRegisteredComponent,
    hasMeaningfulChild,
    isEventEntryStrategy,
    mergeClassParts,
    mergeStyleParts,
    mount,
    noteDomCreate,
    resolveComponent,
    runDirectCreate,
    scheduleClientOn,
    settlePendingChildMounts,
    snapshotInstanceState,
    stripFns,
} from '../dom-core.js';
import { createUnknownComponentElement, markUnknownComponentHost, serializeUnknownComponentNode } from '../unknown-component.js';
import { runDirectResume } from './adopt.js';
import { resumeIslands } from './resume.js';

export async function hydrateRoute(Page, container, props = {}, layoutCtors = [], opts = {}) {
    if (typeof document === 'undefined') {
        throw new Error('vmz:dom hydrateRoute() requires a document (browser)');
    }
    if (container.__vmzInst) {
        destroy(container.__vmzInst);
        container.__vmzInst = null;
    }
    container.__vmzPageHost = null;
    container.__vmzLayoutInsts = null;

    const layoutInsts = [];
    let host = container;
    const ctors = Array.isArray(layoutCtors) ? layoutCtors.filter(Boolean) : [];

    for (const Layout of ctors) {
        const inst = await mount(Layout, host, {});
        layoutInsts.push(inst);
        const slot = findOwnedDefaultSlot(inst.__vmzDomRoot);
        const outlet = document.createElement('div');
        outlet.setAttribute('data-vmz-outlet', '');
        if (slot && slot.parentNode) slot.replaceWith(outlet);
        else if (inst.__vmzDomRoot && typeof inst.__vmzDomRoot.appendChild === 'function') {
            inst.__vmzDomRoot.appendChild(outlet);
        } else {
            host.appendChild(outlet);
        }
        host = outlet;
    }

    const pageInst = await hydrate(Page, host, props, opts);
    container.__vmzPageHost = host;
    container.__vmzLayoutInsts = layoutInsts;
    // Outer layout (or page if no layouts) owns the #app instance for destroy().
    container.__vmzInst = layoutInsts[0] || pageInst;
    return pageInst;
}

export async function hydrateRoutePage(Page, container, props: any = {}, opts: any = {}) {
    if (typeof document === 'undefined') {
        throw new Error('vmz:dom hydrateRoutePage() requires a document (browser)');
    }
    const pageHost = container.__vmzPageHost || container;
    if (pageHost.__vmzInst) {
        destroy(pageHost.__vmzInst);
        pageHost.__vmzInst = null;
    }
    const pageInst = await hydrate(Page, pageHost, props, opts);
    container.__vmzPageHost = pageHost;
    const layouts = container.__vmzLayoutInsts;
    if (!Array.isArray(layouts) || layouts.length === 0) {
        container.__vmzInst = pageInst;
    }
    return pageInst;
}

export async function hydrate(Component, container, props: any = {}, opts: any = {}) {
    if (typeof document === 'undefined') {
        throw new Error('vmz:dom hydrate() requires a document (browser)');
    }

    let preserved = null;
    if (opts.preserveState && typeof opts.preserveState === 'object') {
        preserved = opts.preserveState;
    } else if (opts.preserveState === true && container.__vmzInst) {
        preserved = snapshotInstanceState(container.__vmzInst);
    }

    if (container.__vmzInst) {
        destroy(container.__vmzInst);
        container.__vmzInst = null;
    }
    const inst = createInstance(Component, props);
    if (preserved) {
        applyPreservedState(inst, preserved);
    }

    // production Direct emit: hydrate uses the same Direct schedule as resume (no render).
    if (!(Component && Component.__vmzDirect && typeof Component.__vmzCreate === 'function')) {
        throw new Error(`vmz:dom hydrate() requires __vmzCreate (Direct); blueprint render() removed (production Direct emit)`);
    }

    // Wire DOM + events BEFORE awaiting onMount. SSR shell is already visible; if we
    // wait on RPC/bootstrap first, buttons look real but have no listeners (dead UI).
    // onMount may still patch state / redirect afterwards (same end state as SSR order).
    if (!hasMeaningfulChild(container)) {
        const node = runDirectCreate(Component, inst);
        if (node) {
            inst.__vmzDomRoot = node;
            container.appendChild(node);
        }
    } else {
        // Deep adopt: park SSR children, rebuild schedule, reclaim nodes (no orphan siblings).
        const node = runDirectResume(Component, inst, container);
        if (node) inst.__vmzDomRoot = node;
    }
    await settlePendingChildMounts(inst);
    container.__vmzInst = inst;

    const runMount = opts.skipOnMount !== true && !preserved && typeof inst.onMount === 'function';
    if (runMount) {
        await inst.onMount();
    }
    return inst;
}

export function hydrateIslands(root = globalThis.document) {
    // resume: hydrateIslands is an alias for resumeIslands (same Plan attach).
    return resumeIslands(root);
}
