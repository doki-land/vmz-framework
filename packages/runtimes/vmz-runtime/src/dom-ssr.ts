// @ts-nocheck
/**
 * VMZ DOM SSR / hydrate / resume — precise patches, no VDOM diff.
 * Imports client DOM primitives from ./dom-core.js for tree-shakeable browser entry.
 */

import { applyDirectHostBox, directHostBoxStyleAttr } from './direct-host-box.js';
import {
    applyDomAttr,
    applyPreservedState,
    BOOLEAN_HTML_ATTRS,
    createInstance,
    destroy,
    directApi,
    eventPropHandlerName,
    getRegisteredComponent,
    hasMeaningfulChild,
    isEventEntryStrategy,
    mount,
    noteDomCreate,
    resolveComponent,
    runDirectCreate,
    scheduleClientOn,
    settlePendingChildMounts,
    snapshotInstanceState,
    stripFns,
} from './dom-core.js';
import { createUnknownComponentElement, markUnknownComponentHost, serializeUnknownComponentNode } from './unknown-component.js';

/** @type {Error | null} last linkedom resolve failure (for clear SSR errors) */
let _ssrDocumentLastError = null;

/**
 * Node SSR has no browser `document`. rowKernel prefers document-free HTML fill;
 * DOM hydrate is a fallback (class ternaries / missing textSlots) and needs linkedom.
 *
 * Must not statically import `node:module`: `dom.js` / `vmz-dom.js` re-export this file,
 * and browser hosts load that barrel.
 *
 * When this file is copied into an app `dist/`, `createRequire(import.meta.url)` cannot
 * see `@vmz/core`'s dependency tree — resolve linkedom from cwd / `@vmz/core` as well.
 */
function ensureSsrDocument() {
    if (typeof globalThis.document !== 'undefined' && typeof globalThis.document.createElement === 'function') {
        return true;
    }
    const proc = globalThis.process;
    if (!proc?.versions?.node) {
        _ssrDocumentLastError = new Error('vmz:dom SSR document: not running on Node');
        return false;
    }
    try {
        // Node 20.16+ / 22.3+: sync builtin load without a static `node:` import.
        const mod = typeof proc.getBuiltinModule === 'function' ? proc.getBuiltinModule('module') : null;
        if (!mod?.createRequire) {
            _ssrDocumentLastError = new Error('vmz:dom SSR document: createRequire unavailable');
            return false;
        }
        const pathMod = typeof proc.getBuiltinModule === 'function' ? proc.getBuiltinModule('path') : null;
        const createRequire = mod.createRequire;
        /** @type {string[]} */
        const bases = [];
        bases.push(import.meta.url);
        if (pathMod && typeof proc.cwd === 'function') {
            bases.push(pathMod.join(proc.cwd(), 'package.json'));
        }
        /** @type {string[]} */
        const errors = [];
        let parseHTML = null;
        for (const base of bases) {
            let req;
            try {
                req = createRequire(base);
            } catch (e) {
                errors.push(`${base}: createRequire failed: ${e && e.message ? e.message : e}`);
                continue;
            }
            try {
                parseHTML = req('linkedom').parseHTML;
                break;
            } catch (e) {
                errors.push(`${base} → linkedom: ${e && e.message ? e.message : e}`);
            }
            // Walk into @vmz/core's dependency tree (linkedom is declared there).
            for (const coreId of ['@vmz/core', '@vmz/core/dom', '@vmz/core/server']) {
                try {
                    const coreEntry = req.resolve(coreId);
                    parseHTML = createRequire(coreEntry)('linkedom').parseHTML;
                    break;
                } catch (e) {
                    errors.push(`${base} → ${coreId}/linkedom: ${e && e.message ? e.message : e}`);
                }
            }
            if (parseHTML) break;
        }
        if (typeof parseHTML !== 'function') {
            const detail = errors.length ? `\n${errors.join('\n')}` : '';
            throw new Error(`linkedom unresolved for SSR document${detail}`);
        }
        const { window, document } = parseHTML('<!DOCTYPE html><html><body></body></html>');
        globalThis.window = window;
        globalThis.document = document;
        _ssrDocumentLastError = null;
        return typeof document.createElement === 'function';
    } catch (err) {
        _ssrDocumentLastError = err instanceof Error ? err : new Error(String(err));
        return false;
    }
}

export async function renderToString(Component, props = {}, opts = {}) {
    ensureSsrDocument();
    const signal = opts && opts.signal;
    if (signal && signal.aborted) return '';
    const inst = createInstance(Component, props);
    if (typeof inst.onMount === 'function') {
        await inst.onMount();
    }
    if (signal && signal.aborted) return '';
    // production Direct emit: SSR only via Direct serialize schedule — never `render`.
    if (!(Component && Component.__vmzDirect && typeof Component.__vmzCreate === 'function')) {
        throw new Error(`vmz:dom renderToString() requires __vmzCreate (Direct); blueprint render() removed (production Direct emit)`);
    }
    const root = await runDirectSerializeTreeWithMounts(Component, inst);
    if (opts && opts.slotHtml != null) injectDefaultSlotHtml(root, opts.slotHtml);
    return flattenSerializeNode(root);
}

/**
 * Stream SSR via the same Direct serialize schedule as `renderToString`.
 * Yields HTML chunks (open tag → children → close). Joining chunks equals `renderToString`.
 * Supports AbortSignal for cancel; consumers should respect backpressure (await between chunks).
 * @param {new (props?: object) => any} Component
 * @param {object} [props]
 * @param {{ signal?: AbortSignal, slotHtml?: string }} [opts]
 * @returns {AsyncGenerator<string, void, void>}
 */
export async function* renderToStream(Component, props = {}, opts = {}) {
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

/**
 * Fill the layout-owned default `<slot>` with pre-rendered HTML (layout SSR wrap).
 * Skips nested component hosts (`data-vmz`) — their slots are for child projection
 * (e.g. Button label), not the page outlet. Without this, DFS hits LocaleToggle→Button
 * before Layout's `<main><slot>`, and the entire page HTML lands inside a button.
 * @param {any} node
 * @param {string} html
 */
function injectDefaultSlotHtml(node, html) {
    if (!node || typeof node !== 'object') return false;
    if (node.__kind === 'el' && node.tag === 'slot' && !(node.attrs && node.attrs.name)) {
        node.__rawHtml = String(html ?? '');
        node.children = [];
        return true;
    }
    // Nested Direct component wrapper from serializeApi.component — do not search inside.
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

/**
 * Live-DOM counterpart: first default `<slot>` owned by this tree, not by a nested
 * `[data-vmz]` component (Button/Link labels, etc.).
 * @param {Element | null | undefined} root
 * @returns {Element | null}
 */
export function findOwnedDefaultSlot(root) {
    if (!root || root.nodeType !== 1) return null;
    const tag = String(root.tagName || '').toLowerCase();
    if (tag === 'slot' && !root.getAttribute('name')) return root;
    const kids = root.children;
    if (!kids || !kids.length) return null;
    for (let i = 0; i < kids.length; i++) {
        const c = kids[i];
        if (c.nodeType !== 1) continue;
        // Nested component host — its slots are not the layout page outlet.
        if (c.hasAttribute('data-vmz')) continue;
        const hit = findOwnedDefaultSlot(c);
        if (hit) return hit;
    }
    return null;
}

/**
 * Hydrate/mount a file-route page inside an optional layout chain (outer → inner).
 * Mirrors SSR `slotHtml` wrapping: each layout's owned default slot becomes the
 * outlet for the next layout or the page. Retains layout instances on `container`
 * so SPA transitions can dispose only the page host.
 * @param {new (props?: object) => any} Page
 * @param {Element} container
 * @param {object} [props]
 * @param {Array<new (props?: object) => any>} [layoutCtors] outer → inner
 * @param {{ preserveState?: boolean | Record<string, unknown>, skipOnMount?: boolean }} [opts]
 */
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

    /** @type {object[]} */
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

/**
 * SPA same-layout transition: dispose only the page host, keep layout instances.
 * Callers must verify `data-vmz-layout` is unchanged before using this.
 * @param {new (props?: object) => any} Page
 * @param {Element} container `#app` that already has `__vmzPageHost` / `__vmzLayoutInsts`
 * @param {object} [props]
 * @param {{ preserveState?: boolean | Record<string, unknown>, skipOnMount?: boolean }} [opts]
 */
export async function hydrateRoutePage(Page, container, props = {}, opts = {}) {
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

/**
 * SSR: run the same __vmzCreate schedule against a serialize host (no render).
 * @param {new (props?: object) => any} Component
 * @param {object} inst
 */
function runDirectSerializeTree(Component, inst) {
    serializeApi._inst = inst;
    try {
        return Component.__vmzCreate.call(inst, serializeApi);
    } finally {
        serializeApi._inst = null;
    }
}

/**
 * SSR child onMount: sync `__vmzCreate` cannot await nested mounts.
 * Expand rounds — reuse prior child instances, await newly discovered onMounts, re-emit.
 * @param {new (props?: object) => any} Component
 * @param {object} inst
 */
async function runDirectSerializeTreeWithMounts(Component, inst) {
    /** @type {object[]} */
    let preMounted = [];
    /** @type {any} */
    let tree = null;
    for (let round = 0; round < 32; round++) {
        serializeApi._ssrPreMounted = preMounted;
        serializeApi._ssrPreIdx = 0;
        serializeApi._ssrCollected = [];
        tree = runDirectSerializeTree(Component, inst);
        if (serializeApi._ssrPreIdx !== preMounted.length) {
            throw new Error(`vmz:dom SSR child mount queue desync (used ${serializeApi._ssrPreIdx}, had ${preMounted.length})`);
        }
        const collected = serializeApi._ssrCollected;
        serializeApi._ssrPreMounted = null;
        serializeApi._ssrCollected = null;
        if (!collected.length) return tree;
        for (const child of collected) {
            if (typeof child.onMount === 'function') {
                await child.onMount();
            }
        }
        preMounted = preMounted.concat(collected);
    }
    throw new Error('vmz:dom SSR child onMount expansion exceeded 32 rounds');
}

function serializeOpenTag(node) {
    const tag = node.tag || 'div';
    let attrs = '';
    for (const [k, v] of Object.entries(node.attrs || {})) {
        if (v == null || v === false) continue;
        if (k === 'className') attrs += ` class="${escapeHtml(v)}"`;
        else attrs += ` ${k}="${escapeHtml(v)}"`;
    }
    return { tag, open: `<${tag}${attrs}>` };
}

function flattenSerializeNode(node) {
    if (node == null || node === false) return '';
    if (typeof node === 'string' || typeof node === 'number') return escapeHtml(node);
    if (node.__kind === 'text') return escapeHtml(node.value);
    if (node.__kind === 'frag') {
        if (node.__rawHtml != null) return String(node.__rawHtml);
        return (node.children || []).map(flattenSerializeNode).join('');
    }
    if (node.__kind === 'el') {
        const tag = node.tag || 'div';
        if (tag === 'slot') {
            if (node.__rawHtml != null) return String(node.__rawHtml);
            return (node.children || []).map(flattenSerializeNode).join('');
        }
        // rowKernel SSR: full outerHTML payload (do not re-wrap).
        if (node.__rawOuter && node.__rawHtml != null) return String(node.__rawHtml);
        const { open } = serializeOpenTag(node);
        if (node.__rawHtml != null) {
            return `${open}${String(node.__rawHtml)}</${tag}>`;
        }
        const inner = (node.children || []).map(flattenSerializeNode).join('');
        return `${open}${inner}</${tag}>`;
    }
    return '';
}

/**
 * Progressive HTML chunks from a serialize tree (same nodes as flattenSerializeNode).
 * @param {any} node
 * @returns {Generator<string, void, void>}
 */
function* streamSerializeChunks(node) {
    if (node == null || node === false) return;
    if (typeof node === 'string' || typeof node === 'number') {
        yield escapeHtml(node);
        return;
    }
    if (node.__kind === 'text') {
        yield escapeHtml(node.value);
        return;
    }
    if (node.__kind === 'frag') {
        if (node.__rawHtml != null) {
            yield String(node.__rawHtml);
            return;
        }
        for (const c of node.children || []) yield* streamSerializeChunks(c);
        return;
    }
    if (node.__kind === 'el') {
        const tag = node.tag || 'div';
        if (tag === 'slot') {
            if (node.__rawHtml != null) {
                yield String(node.__rawHtml);
                return;
            }
            for (const c of node.children || []) yield* streamSerializeChunks(c);
            return;
        }
        if (node.__rawOuter && node.__rawHtml != null) {
            yield String(node.__rawHtml);
            return;
        }
        const { open } = serializeOpenTag(node);
        yield open;
        if (node.__rawHtml != null) {
            yield String(node.__rawHtml);
        } else {
            for (const c of node.children || []) yield* streamSerializeChunks(c);
        }
        yield `</${tag}>`;
    }
}

/**
 * Document-free rowKernel SSR fill (transitional / pre-0.1.7 emit only).
 * Prefer `serializeItem` (IR schedule). Do not treat this as the long-term contract.
 * @param {{ html: string, textSlots?: Record<string, number>, hostFields?: string[] }} rk
 * @param {any} item
 * @param {any} key
 * @returns {string | null} filled outer HTML, or null if shape is not fillable
 */
function fillRowKernelHtml(rk, item, key) {
    const slots = rk.textSlots;
    if (!slots || typeof slots !== 'object') return null;
    /** @type {string[]} */
    const fields = Object.entries(slots)
        .filter(([, i]) => typeof i === 'number' && Number.isFinite(i))
        .sort((a, b) => /** @type {number} */ (a[1]) - /** @type {number} */ (b[1]))
        .map(([f]) => f);
    if (!fields.length) return null;
    let slotI = 0;
    // Generator emits one space per text interp as a dedicated text node (`> <`).
    const filled = String(rk.html).replace(/>([^<]*)</g, (m, text) => {
        if (text === ' ' && slotI < fields.length) {
            const f = fields[slotI++];
            const v = item == null ? '' : item[f];
            return `>${escapeHtml(v == null ? '' : String(v))}<`;
        }
        return m;
    });
    if (slotI !== fields.length) return null;
    if (key == null) return filled;
    // Inject data-vmz-key on the root opening tag (same attr hydrate would set).
    return filled.replace(/^<([A-Za-z][\w:-]*)/, `<$1 data-vmz-key="${escapeHtml(String(key))}"`);
}

/**
 * SSR row when `createItem` was omitted (rowKernel client emit).
 * Prefer document-free fill from `html` + `textSlots`; fall back to linkedom + hydrate
 * when host class ternaries need live DOM, or when placeholders cannot be string-filled.
 * @param {object} inst
 * @param {{ html: string, hydrate?: Function, textSlots?: Record<string, number>, hostFields?: string[] }} rk
 * @param {{ item: any, index: number }} box
 * @param {any} key
 */
function serializeRowFromKernel(inst, rk, box, key) {
    const item = box.item;
    const hostFields = Array.isArray(rk.hostFields) ? rk.hostFields : [];
    // Text-only kernels: no document. Host class ternaries still need hydrate/DOM.
    if (hostFields.length === 0) {
        const raw = fillRowKernelHtml(rk, item, key);
        if (raw != null) {
            return {
                __kind: 'el',
                tag: 'div',
                attrs: Object.create(null),
                children: [],
                __rawOuter: true,
                __rawHtml: raw,
                appendChild() {},
            };
        }
    }
    if (!ensureSsrDocument()) {
        // Degrade: still ship text fill if possible (class may be wrong until client hydrate).
        const raw = fillRowKernelHtml(rk, item, key);
        if (raw != null) {
            return {
                __kind: 'el',
                tag: 'div',
                attrs: Object.create(null),
                children: [],
                __rawOuter: true,
                __rawHtml: raw,
                appendChild() {},
            };
        }
        const cause = _ssrDocumentLastError;
        const detail = cause && cause.message ? cause.message : 'unavailable';
        throw new Error(`vmz:dom SSR rowKernel requires a document (createItem omitted): ${detail}`, cause ? { cause } : undefined);
    }
    const tpl = document.createElement('template');
    tpl.innerHTML = rk.html;
    const root = tpl.content.firstElementChild;
    if (!root || root.nodeType !== 1) {
        throw new Error('vmz:dom SSR rowKernel html produced no element');
    }
    if (typeof rk.hydrate === 'function') {
        rk.hydrate.call(inst, root, item);
    }
    if (key != null) root.setAttribute('data-vmz-key', String(key));
    return {
        __kind: 'el',
        tag: root.tagName.toLowerCase(),
        attrs: Object.create(null),
        children: [],
        __rawOuter: true,
        __rawHtml: root.outerHTML,
        appendChild() {},
    };
}

/** Serialize host mirroring directApi — returns virtual nodes, not DOM. */
const serializeApi = {
    /** @type {object | null} */
    _inst: null,
    /** @type {null} */
    _branchBinds: null,
    /** @type {null} */
    _itemPatches: null,
    /** @type {object[] | null} reused child instances from prior SSR mount rounds */
    _ssrPreMounted: null,
    /** @type {number} */
    _ssrPreIdx: 0,
    /** @type {object[] | null} newly created child instances this round */
    _ssrCollected: null,
    /**
     * @param {new (props?: object) => any} Ctor
     * @param {object} resolved
     */
    _ssrChildInstance(Ctor, resolved) {
        const pre = serializeApi._ssrPreMounted;
        if (pre && serializeApi._ssrPreIdx < pre.length) {
            return pre[serializeApi._ssrPreIdx++];
        }
        const child = createInstance(Ctor, resolved);
        if (serializeApi._ssrCollected) serializeApi._ssrCollected.push(child);
        return child;
    },
    el(tag) {
        return {
            __kind: 'el',
            tag: tag || 'div',
            attrs: {},
            children: [],
            appendChild(c) {
                if (c != null) this.children.push(c);
            },
        };
    },
    text(value) {
        return { __kind: 'text', value: value == null ? '' : String(value) };
    },
    frag() {
        return {
            __kind: 'frag',
            children: [],
            appendChild(c) {
                if (c != null) this.children.push(c);
            },
        };
    },
    attr(el, name, value) {
        if (!el || el.__kind !== 'el') return;
        applySerializeAttr(el, name, value);
    },
    on() {
        /* events are no-ops during SSR */
    },
    onMethod() {
        /* named method events are also attached only during client resume */
    },
    bindText(inst, bindingId, deps, get, textNode) {
        let raw = '';
        try {
            raw = get.call(inst);
        } catch {
            raw = '';
        }
        textNode.value = String(raw ?? '');
    },
    bindAttr(inst, bindingId, deps, get, el, name) {
        let raw;
        try {
            raw = get.call(inst);
        } catch {
            raw = null;
        }
        applySerializeAttr(el, name, raw);
    },
    bindComponentProp() {
        /* SSR: props already resolved into the child instance at create */
    },
    projectDefaultSlot(hostEl, node) {
        if (!hostEl || node == null) return;
        // serializeApi.component returns a serialize el tree (or island shell).
        const root = hostEl.__kind === 'el' ? hostEl : null;
        const findSlot = (n) => {
            if (!n || n.__kind !== 'el') return null;
            if (n.tag === 'slot' && !(n.attrs && n.attrs.name)) return n;
            for (const c of n.children || []) {
                const hit = findSlot(c);
                if (hit) return hit;
            }
            return null;
        };
        // Prefer searching the component body (first child of host wrapper).
        let slot = null;
        if (root) {
            for (const c of root.children || []) {
                slot = findSlot(c);
                if (slot) break;
            }
            if (!slot) slot = findSlot(root);
        }
        if (slot) {
            slot.__rawHtml = null;
            if (!Array.isArray(slot.children)) slot.children = [];
            // Append — multiple projectDefaultSlot calls must accumulate (SSR).
            // Client path replaces the live <slot> then appends siblings; serialize must push.
            slot.children.push(node);
            return;
        }
        if (root) root.appendChild(node);
    },
    setHtml(el, value) {
        if (!el || el.__kind !== 'el') return;
        el.__rawHtml = value == null ? '' : String(value);
        el.children = [];
    },
    bindHtml(inst, bindingId, deps, get, el) {
        let raw = '';
        try {
            raw = get.call(inst);
        } catch {
            raw = '';
        }
        el.__rawHtml = raw == null ? '' : String(raw);
        el.children = [];
    },
    ifBlock(inst, bindingId, deps, branches) {
        // No empty `span[data-vmz-if]` box (`ui-vif-dom`): false → empty frag.
        const frag = serializeApi.frag();
        let idx = -1;
        for (let i = 0; i < branches.length; i++) {
            const b = branches[i];
            if (!b.cond) {
                idx = i;
                break;
            }
            try {
                if (b.cond.call(inst)) {
                    idx = i;
                    break;
                }
            } catch {
                /* continue */
            }
        }
        if (idx >= 0 && branches[idx].create) {
            const created = branches[idx].create.call(inst, serializeApi);
            if (created) frag.appendChild(created);
        }
        return frag;
    },
    eachBlock(inst, bindingId, deps, spec) {
        const frag = serializeApi.frag();
        let list = [];
        try {
            list = spec.list.call(inst) || [];
        } catch {
            list = [];
        }
        if (!Array.isArray(list)) list = [...list];
        for (let i = 0; i < list.length; i++) {
            const box = { item: list[i], index: i };
            let k = i;
            if (typeof spec.key === 'function') {
                try {
                    k = spec.key.call(inst, box);
                } catch {
                    k = i;
                }
            }
            let dom = null;
            if (typeof spec.createItem === 'function') {
                dom = spec.createItem.call(inst, serializeApi, box);
            } else if (typeof spec.serializeItem === 'function') {
                // IR-homologous schedule (v0.1.7): same Direct body as fat createItem.
                dom = spec.serializeItem.call(inst, serializeApi, box);
            } else if (spec.rowKernel && typeof spec.rowKernel.html === 'string') {
                // Transitional only: pre-0.1.7 emit without serializeItem.
                dom = serializeRowFromKernel(inst, spec.rowKernel, box, k);
            }
            if (dom) {
                // SSR only: serialize key into HTML for hydrate/debug. Direct client does not write this attr.
                if (dom.__kind === 'el' && !dom.__rawOuter) serializeApi.attr(dom, 'data-vmz-key', String(k));
                frag.appendChild(dom);
            }
        }
        return frag;
    },
    component(hostInst, name, props, client) {
        const Ctor = getRegisteredComponent(name);
        if (!Ctor) {
            return serializeUnknownComponentNode(name);
        }
        /** @type {Record<string, any>} */
        const resolved = {};
        for (const [k, v] of Object.entries(props || {})) {
            const onKey = typeof v === 'function' ? eventPropHandlerName(k) : null;
            if (onKey) continue;
            else if (typeof v === 'function') resolved[k] = v.call(hostInst);
            else resolved[k] = v;
        }
        if (client) {
            // resume: Island SSR includes body + ResumeEntry slice (same Direct schedule).
            const child = serializeApi._ssrChildInstance(Ctor, resolved);
            let body = null;
            if (Ctor.__vmzDirect && typeof Ctor.__vmzCreate === 'function') {
                const prev = serializeApi._inst;
                serializeApi._inst = child;
                try {
                    body = Ctor.__vmzCreate.call(child, serializeApi);
                } finally {
                    serializeApi._inst = prev;
                }
            }
            const state = snapshotInstanceState(child) || {};
            const plan = Ctor.__vmzPlan || null;
            const resume = {
                schema: 'vmz.resume.v0',
                component: name,
                strategy: String(client),
                props: stripFns(resolved),
                state,
                planSchema: plan?.schema || null,
                planRootIds: plan?.root_ids || [],
            };
            /** @type {Record<string, string>} */
            const attrs = {
                'data-vmz': name,
                'data-vmz-island': name,
                'data-vmz-client': String(client),
                'data-vmz-props': JSON.stringify(stripFns(resolved)),
                'data-vmz-resume': JSON.stringify(resume),
            };
            const boxStyle = directHostBoxStyleAttr(name, Ctor);
            if (boxStyle) attrs.style = boxStyle;
            if (isEventEntryStrategy(String(client))) {
                attrs['data-vmz-entry'] = 'event';
            }
            return {
                __kind: 'el',
                tag: 'div',
                attrs,
                children: body ? [body] : [],
                appendChild(c) {
                    if (c != null) this.children.push(c);
                },
            };
        }
        const child = serializeApi._ssrChildInstance(Ctor, resolved);
        if (Ctor.__vmzDirect && typeof Ctor.__vmzCreate === 'function') {
            const prev = serializeApi._inst;
            serializeApi._inst = child;
            try {
                const node = Ctor.__vmzCreate.call(child, serializeApi);
                /** @type {Record<string, string>} */
                const attrs = { 'data-vmz': name };
                const boxStyle = directHostBoxStyleAttr(name, Ctor);
                if (boxStyle) attrs.style = boxStyle;
                return {
                    __kind: 'el',
                    tag: 'div',
                    attrs,
                    children: node ? [node] : [],
                    appendChild(c) {
                        if (c != null) this.children.push(c);
                    },
                };
            } finally {
                serializeApi._inst = prev;
            }
        }
        throw new Error(`vmz:dom serialize component <${name}> requires __vmzCreate (rebuild child with Direct)`);
    },
};

/**
 * Serialize-tree attr write (SSR).
 * @param {any} el
 * @param {string} name
 * @param {any} value
 */
function applySerializeAttr(el, name, value) {
    if (!el || el.__kind !== 'el') return;
    const key = name === 'className' ? 'class' : name;
    if (BOOLEAN_HTML_ATTRS.has(String(key).toLowerCase())) {
        if (value === false || value == null || value === '') delete el.attrs[key];
        else el.attrs[key] = value === true ? '' : String(value);
        return;
    }
    if (value == null || value === false) delete el.attrs[key];
    else el.attrs[key] = value === true ? '' : String(value);
}

/**
 * resume: attach to existing Island DOM without re-running construct structure or onMount.
 * Consumes ResumeEntry product (`data-vmz-resume`) derived from the same Execution Plan.
 * @param {new (props?: object) => any} Component
 * @param {HTMLElement} container
 * @param {{ props?: object, state?: Record<string, unknown>, strategy?: string } | null} [slice]
 */
export async function resume(Component, container, slice = null) {
    if (typeof document === 'undefined') {
        throw new Error('vmz:dom resume() requires a document (browser)');
    }
    let parsed = slice;
    if (!parsed) {
        const raw = container.getAttribute('data-vmz-resume');
        if (raw) {
            try {
                parsed = JSON.parse(raw);
            } catch {
                parsed = null;
            }
        }
    }
    if (!parsed) {
        let props = {};
        try {
            props = JSON.parse(container.getAttribute('data-vmz-props') || '{}');
        } catch {
            props = {};
        }
        parsed = { props, state: {} };
    }

    if (container.__vmzInst) {
        destroy(container.__vmzInst);
        container.__vmzInst = null;
    }

    const hostName = container.getAttribute('data-vmz') || container.getAttribute('data-vmz-island') || Component.name || '';
    applyDirectHostBox(container, hostName, Component);

    const props = parsed.props || {};
    const inst = createInstance(Component, props);
    if (parsed.state) applyPreservedState(inst, parsed.state);
    // Intentionally never call onMount — SSR already completed that work.

    if (Component.__vmzDirect && typeof Component.__vmzCreate === 'function') {
        if (!hasMeaningfulChild(container)) {
            const node = runDirectCreate(Component, inst);
            if (node) {
                inst.__vmzDomRoot = node;
                container.appendChild(node);
            }
        } else {
            // Island leaf adopt: preserve Element identity (resume nodeIdentity).
            const node = runDirectResume(Component, inst, container);
            if (node) inst.__vmzDomRoot = node;
        }
    } else {
        throw new Error(`vmz:dom resume() requires __vmzCreate (Direct); blueprint render() removed (production Direct emit)`);
    }
    container.__vmzInst = inst;
    container.__vmzResumed = true;
    return inst;
}

/**
 * Resume all `[data-vmz-island]` hosts (prefer ResumeEntry / EventEntry over mount).
 * Event strategy islands wait for the DOM event before attach (lazy EventEntry).
 * @param {ParentNode} [root]
 */
export function resumeIslands(root = globalThis.document) {
    if (!root || typeof root.querySelectorAll !== 'function') {
        throw new Error('vmz:dom resumeIslands() requires a DOM root');
    }
    const nodes = [...root.querySelectorAll('[data-vmz-island]')];
    for (const el of nodes) {
        const name = el.getAttribute('data-vmz-island');
        const strategy = el.getAttribute('data-vmz-client') || 'load';
        scheduleClientOn(el, strategy, async () => {
            const Ctor = await resolveComponent(name);
            if (!Ctor) {
                markUnknownComponentHost(el, name, 'resume');
                return;
            }
            await resume(Ctor, el);
        });
    }
}

/**
 * EventEntry attach: only wire `client:event` / `client:event:*` islands.
 * Idle/load/visible ResumeEntries are left alone (static shell can defer framework work).
 * @param {ParentNode} [root]
 */
export function attachEventEntries(root = globalThis.document) {
    if (!root || typeof root.querySelectorAll !== 'function') {
        throw new Error('vmz:dom attachEventEntries() requires a DOM root');
    }
    const nodes = [...root.querySelectorAll('[data-vmz-island]')];
    for (const el of nodes) {
        const strategy = el.getAttribute('data-vmz-client') || '';
        if (!isEventEntryStrategy(strategy)) continue;
        const name = el.getAttribute('data-vmz-island');
        el.setAttribute('data-vmz-entry', 'event');
        scheduleClientOn(el, strategy, async () => {
            const Ctor = await resolveComponent(name);
            if (!Ctor) {
                markUnknownComponentHost(el, name, 'event-entry');
                return;
            }
            await resume(Ctor, el);
        });
    }
}

/**
 * Adopt parked SSR/Island nodes while `__vmzCreate` rebuilds the live tree.
 * Children of `rootEl` are moved into `pool` first so the create schedule never
 * leaves orphan SSR siblings beside if/each markers (duplicate h2 / stale text).
 * @param {DocumentFragment} pool
 * @param {Element} rootEl
 */
function createResumeAdopt(pool, rootEl) {
    const used = new WeakSet();
    /** @type {Element[]} */
    const adopted = [];

    const markElement = (n) => {
        used.add(n);
        adopted.push(n);
        if (typeof n.getAttribute === 'function') {
            const k = n.getAttribute('data-vmz-key');
            if (k != null && n.__vmzKey == null) n.__vmzKey = k;
        }
        // Park descendants so create can rebuild if/each without orphan SSR siblings.
        while (n.firstChild) pool.appendChild(n.firstChild);
        return n;
    };

    /**
     * linkedom lacks `NodeFilter` — walk manually.
     * @param {Node} root
     * @param {(n: Element) => void} visit
     */
    const walkElements = (root, visit) => {
        if (!root || root.nodeType !== 1) return;
        const el = /** @type {Element} */ (root);
        visit(el);
        for (let c = el.firstChild; c; c = c.nextSibling) walkElements(c, visit);
    };

    /**
     * @param {Node} root
     * @param {(n: Text) => void} visit
     */
    const walkTexts = (root, visit) => {
        if (!root) return;
        if (root.nodeType === 3) {
            visit(/** @type {Text} */ (root));
            return;
        }
        if (root.nodeType !== 1) return;
        for (let c = root.firstChild; c; c = c.nextSibling) walkTexts(c, visit);
    };

    /** @returns {Generator<Element>} */
    function* elementCandidates() {
        if (!used.has(rootEl)) yield rootEl;
        for (const n of pool.childNodes) {
            if (n.nodeType !== 1) continue;
            /** @type {Element[]} */
            const found = [];
            walkElements(n, (el) => {
                if (!used.has(el)) found.push(el);
            });
            for (const el of found) yield el;
        }
        for (const a of adopted) {
            /** @type {Element[]} */
            const found = [];
            for (let c = a.firstChild; c; c = c.nextSibling) {
                walkElements(c, (el) => {
                    if (!used.has(el)) found.push(el);
                });
            }
            for (const el of found) yield el;
        }
    }

    /** @returns {Generator<Text>} */
    function* textCandidates() {
        for (const n of pool.childNodes) {
            /** @type {Text[]} */
            const found = [];
            walkTexts(n, (t) => {
                if (!used.has(t)) found.push(t);
            });
            for (const t of found) yield t;
        }
        for (const a of adopted) {
            /** @type {Text[]} */
            const found = [];
            walkTexts(a, (t) => {
                if (!used.has(t)) found.push(t);
            });
            for (const t of found) yield t;
        }
    }

    const adoptElement = (tag) => {
        const want = String(tag || 'div').toLowerCase();
        for (const el of elementCandidates()) {
            if (String(el.tagName).toLowerCase() === want) return markElement(el);
        }
        noteDomCreate();
        return document.createElement(tag || 'div');
    };

    const adoptText = (value) => {
        for (const n of textCandidates()) {
            used.add(n);
            if (value != null && value !== '') n.textContent = String(value);
            return n;
        }
        noteDomCreate();
        return document.createTextNode(value == null ? '' : String(value));
    };

    /** Reclaim SSR `<div data-vmz="Name">` hosts for nested Direct components. */
    const componentHost = (name) => {
        const want = String(name || '');
        for (const el of elementCandidates()) {
            if (String(el.tagName).toLowerCase() !== 'div') continue;
            if (el.getAttribute('data-vmz') !== want) continue;
            return markElement(el);
        }
        return null;
    };

    return {
        el: adoptElement,
        text: adoptText,
        componentHost,
    };
}

/**
 * Adopt existing Island DOM while running the same `__vmzCreate` schedule (resume).
 * @param {new (props?: object) => any} Component
 * @param {object} inst
 * @param {Element} container
 */
function runDirectResume(Component, inst, container) {
    const rootEl = [...container.childNodes].find((n) => n.nodeType === 1 || (n.nodeType === 3 && String(n.textContent).trim() !== ''));
    if (!rootEl || rootEl.nodeType !== 1) {
        return runDirectCreate(Component, inst);
    }

    // Park SSR descendants so create can append if/each structure without orphan siblings.
    const pool = document.createDocumentFragment();
    while (rootEl.firstChild) pool.appendChild(rootEl.firstChild);

    const prevInst = directApi._inst;
    const prevBranch = directApi._branchBinds;
    const prevItems = directApi._itemPatches;
    const prevEach = directApi._eachCtx;
    const prevAdopt = directApi._resumeAdopt;
    directApi._inst = inst;
    directApi._branchBinds = null;
    directApi._itemPatches = null;
    directApi._eachCtx = null;
    directApi._resumeAdopt = createResumeAdopt(pool, rootEl);
    try {
        return Component.__vmzCreate.call(inst, directApi);
    } finally {
        directApi._resumeAdopt = prevAdopt;
        directApi._inst = prevInst;
        directApi._branchBinds = prevBranch;
        directApi._itemPatches = prevItems;
        directApi._eachCtx = prevEach;
        while (pool.firstChild) pool.removeChild(pool.firstChild);
    }
}

/**
 * @param {new (props?: object) => any} Component
 * @param {HTMLElement} container
 * @param {object} [props]
 * @param {{ preserveState?: boolean | Record<string, unknown>, skipOnMount?: boolean }} [opts]
 */
export async function hydrate(Component, container, props = {}, opts = {}) {
    if (typeof document === 'undefined') {
        throw new Error('vmz:dom hydrate() requires a document (browser)');
    }

    /** @type {Record<string, unknown> | null} */
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

/**
 * @param {ParentNode} [root]
 */
export function hydrateIslands(root = globalThis.document) {
    // resume: hydrateIslands is an alias for resumeIslands (same Plan attach).
    return resumeIslands(root);
}

function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
