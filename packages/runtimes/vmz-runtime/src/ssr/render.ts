import { applyDirectHostBox, directHostBoxStyleAttr } from '../browser/direct-host-box.js';
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
} from '../browser/dom-core.js';
import { createUnknownComponentElement, markUnknownComponentHost, serializeUnknownComponentNode } from '../browser/unknown-component.js';
import { ensureSsrDocument } from './document.js';
import { flattenSerializeNode, runDirectSerializeTreeWithMounts, streamSerializeChunks } from './serialize.js';

export async function renderToString(Component, props: any = {}, opts: any = {}) {
    ensureSsrDocument();
    const signal = opts && opts.signal;
    if (signal && signal.aborted) return '';
    const inst = createInstance(Component, props);
    if (typeof inst.onMount === 'function') {
        await inst.onMount();
    }
    if (signal && signal.aborted) return '';
    // production Direct emit: SSR only via Direct serialize schedule ??never `render`.
    if (!(Component && Component.__vmzDirect && typeof Component.__vmzCreate === 'function')) {
        throw new Error(`vmz:dom renderToString() requires __vmzCreate (Direct); blueprint render() removed (production Direct emit)`);
    }
    const root = await runDirectSerializeTreeWithMounts(Component, inst);
    if (opts && opts.slotHtml != null) injectDefaultSlotHtml(root, opts.slotHtml);
    return flattenSerializeNode(root);
}

export async function* renderToStream(Component, props: any = {}, opts: any = {}) {
    ensureSsrDocument();
    const signal = opts && opts.signal;
    const aborted = () => Boolean(signal && signal.aborted);
    if (aborted()) return;
    const inst = createInstance(Component, props);
    try {
        if (typeof inst.onMount === 'function') {
            await inst.onMount();
        }
        if (aborted()) return;
        if (!(Component && Component.__vmzDirect && typeof Component.__vmzCreate === 'function')) {
            throw new Error(`vmz:dom renderToStream() requires __vmzCreate (Direct); blueprint render() removed (production Direct emit)`);
        }
        const root = await runDirectSerializeTreeWithMounts(Component, inst);
        if (opts && opts.slotHtml != null) injectDefaultSlotHtml(root, opts.slotHtml);
        if (aborted()) return;
        for (const chunk of streamSerializeChunks(root)) {
            if (aborted()) return;
            yield chunk;
            // Allow consumers / HTTP hosts to flush between chunks (backpressure point).
            await Promise.resolve();
        }
    } finally {
        // Abort and normal completion both dispose the SSR instance (lifetime).
        destroy(inst);
    }
}

function injectDefaultSlotHtml(node, html) {
    if (!node || typeof node !== 'object') return false;
    if (node.__kind === 'el' && node.tag === 'slot' && !(node.attrs && node.attrs.name)) {
        node.__rawHtml = String(html ?? '');
        node.children = [];
        return true;
    }
    // Nested Direct component wrapper from serializeApi.component ??do not search inside.
    if (node.__kind === 'el' && node.attrs && node.attrs['data-vmz'] != null) {
        return false;
    }
    const kids = node.children;
    if (Array.isArray(kids)) {
        for (const c of kids) {
            if (injectDefaultSlotHtml(c, html)) return true;
        }
    }
    return false;
}
