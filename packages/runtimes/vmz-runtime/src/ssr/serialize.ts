import { applyDirectHostBox, directHostBoxStyleAttr, resolveDirectHostTag } from '../browser/direct-host-box.js';
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
import { splitStyleDeclarations } from '../shared/dom-attr-normalize.js';
import { HTML_HASH_ATTR, htmlDigest } from '../shared/html-digest.js';
import { rowEndMarker, rowMarker } from '../shared/row-key.js';
import { _ssrDocumentLastError, ensureSsrDocument } from './document.js';
import { awaitSsrOnMount, ssrComponentName, ssrOnMountContext } from './onmount.js';

function runDirectSerializeTree(Component, inst) {
    serializeApi._inst = inst;
    try {
        return Component.__vmzCreate.call(inst, serializeApi);
    } finally {
        serializeApi._inst = null;
    }
}

export async function runDirectSerializeTreeWithMounts(Component, inst, onMountCtx?: any) {
    const ctx = onMountCtx || ssrOnMountContext(null);
    let preMounted = [];

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
            await awaitSsrOnMount(child, ssrComponentName(null, child), ctx);
        }
        preMounted = preMounted.concat(collected);
    }
    throw new Error('vmz:dom SSR child onMount expansion exceeded 32 rounds');
}

/** HTML void elements never take a closing tag; `</br>` is parsed as another `<br>`. */
const VOID_TAGS = new Set([
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr',
]);

function isVoidTag(tag) {
    return VOID_TAGS.has(String(tag).toLowerCase());
}

/**
 * `textarea` carries its initial value as text content and `select` carries it
 * as a selected option, so neither can travel as a `value` attribute. `input`
 * keeps the attribute, which browsers honor for the default value.
 */
function controlValue(node, tag) {
    if (tag !== 'textarea' && tag !== 'select') return null;
    const v = node.attrs ? node.attrs.value : null;
    if (v == null || v === false) return null;
    // A `multiple` select model is a list; keep every entry addressable.
    if (tag === 'select' && Array.isArray(v)) return v.map((item) => String(item));
    return String(v);
}

function nodeText(node) {
    if (!node || typeof node !== 'object') return '';
    if (node.__kind === 'text') return String(node.value ?? '');
    if (node.__kind === 'el' || node.__kind === 'frag') {
        return (node.children || []).map(nodeText).join('');
    }
    return '';
}

/** Mark the `<option>` whose value (or text) equals one of the model values. */
function markSelectSelection(node, wanted) {
    const wants = Array.isArray(wanted) ? wanted.map((item) => String(item)) : [String(wanted)];
    const visit = (n) => {
        if (!n || typeof n !== 'object') return;
        if (n.__kind === 'el') {
            const tag = String(n.tag || '').toLowerCase();
            if (tag === 'option') {
                const raw =
                    n.attrs && n.attrs.value != null ? String(n.attrs.value) : nodeText(n).trim();
                if (wants.includes(raw)) {
                    if (!n.attrs) n.attrs = {};
                    n.attrs.selected = '';
                } else if (n.attrs && Object.prototype.hasOwnProperty.call(n.attrs, 'selected')) {
                    delete n.attrs.selected;
                }
                return;
            }
        }
        for (const c of n.children || []) visit(c);
    };
    for (const c of node.children || []) visit(c);
}

/**
 * Inline style as the browser would serialize it: the `style` attribute merged
 * with the live `style.*` writes that Direct patches and `v-show` perform
 * (`el.style.display = …`). SSR virtual elements only kept the attribute, so a
 * server-first response showed elements that hydration hid.
 */
function serializeStyleAttr(node) {
    const declared = node.attrs && node.attrs.style != null ? String(node.attrs.style) : '';
    const live = node.style;
    if (!live || typeof live !== 'object') return declared;
    const display = live.display;
    if (display === undefined) return declared;
    // `el.style.display = ''` removes the declaration instead of writing it.
    if (display === '' || display == null) {
        return splitStyleDeclarations(declared)
            .filter((chunk) => {
                const idx = chunk.indexOf(':');
                return idx < 0 || chunk.slice(0, idx).trim() !== 'display';
            })
            .map((chunk) => chunk.trim())
            .filter(Boolean)
            .join('; ');
    }
    return mergeStyleParts(declared, { display });
}

function serializeOpenTag(node) {
    const tag = node.tag || 'div';
    const lowerTag = String(tag).toLowerCase();
    let attrs = '';
    for (const [k, v] of Object.entries(node.attrs || {})) {
        if (v == null || v === false) continue;
        // `textarea` value renders as text content and `select` value as a
        // selected option, so the raw attribute must not be emitted.
        if (k === 'value' && (lowerTag === 'textarea' || lowerTag === 'select')) continue;
        if (k === 'style') continue;
        // Always replaced by the digest of the payload written below, so an
        // author-supplied marker can never mask a different payload.
        if (k === HTML_HASH_ATTR) continue;
        if (k === 'className') attrs += ` class="${escapeHtml(v)}"`;
        else attrs += ` ${k}="${escapeHtml(v)}"`;
    }
    const style = serializeStyleAttr(node);
    if (style) attrs += ` style="${escapeHtml(style)}"`;
    // `v-html` hosts carry the digest of the exact string SSR wrote, so the
    // client can keep the SSR subtree without DOM-serializing its payload.
    if (node.__rawHtml != null && !node.__rawOuter) {
        attrs += ` ${HTML_HASH_ATTR}="${escapeHtml(htmlDigest(String(node.__rawHtml)))}"`;
    }
    return { tag, open: `<${tag}${attrs}>` };
}

export function flattenSerializeNode(node) {
    if (node == null || node === false) return '';
    if (typeof node === 'string' || typeof node === 'number') return escapeHtml(node);
    if (node.__kind === 'text') return escapeHtml(node.value);
    if (node.__kind === 'comment') return '';
    if (node.__kind === 'frag') {
        if (node.__rawHtml != null) return String(node.__rawHtml);
        const inner = (node.children || []).map(flattenSerializeNode).join('');
        // Multi-root `<template v-for>` rows have no element root to carry
        // `data-vmz-key`, so their identity travels as a marker pair around the
        // row's nodes. Resume reads the same pair and scopes adoption to it.
        if (node.__vmzRowKey != null) {
            return `<!--${rowMarker(node.__vmzRowKey)}-->${inner}<!--${rowEndMarker(node.__vmzRowKey)}-->`;
        }
        return inner;
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
        const lowerTag = String(tag).toLowerCase();
        const control = controlValue(node, lowerTag);
        if (node.__rawHtml != null) {
            const lead = needsSacrificialLF(node, lowerTag, null) ? '\n' : '';
            const raw = String(node.__rawHtml);
            return isVoidTag(tag) ? `${open}${raw}` : `${open}${lead}${raw}</${tag}>`;
        }
        if (lowerTag === 'textarea' && control != null) {
            const lead = needsSacrificialLF(node, lowerTag, control) ? '\n' : '';
            return `${open}${lead}${escapeHtml(control)}</${tag}>`;
        }
        if (lowerTag === 'select' && control != null) markSelectSelection(node, control);
        const inner = (node.children || []).map(flattenSerializeNode).join('');
        const lead = needsSacrificialLF(node, lowerTag, control) ? '\n' : '';
        return isVoidTag(tag) ? `${open}${inner}` : `${open}${lead}${inner}</${tag}>`;
    }
    return '';
}

export function* streamSerializeChunks(node) {
    if (node == null || node === false) return;
    if (typeof node === 'string' || typeof node === 'number') {
        yield escapeHtml(node);
        return;
    }
    if (node.__kind === 'text') {
        yield escapeHtml(node.value);
        return;
    }
    if (node.__kind === 'comment') return;
    if (node.__kind === 'frag') {
        if (node.__rawHtml != null) {
            yield String(node.__rawHtml);
            return;
        }
        if (node.__vmzRowKey != null) {
            yield `<!--${rowMarker(node.__vmzRowKey)}-->`;
            for (const c of node.children || []) yield* streamSerializeChunks(c);
            yield `<!--${rowEndMarker(node.__vmzRowKey)}-->`;
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
        const lowerTag = String(tag).toLowerCase();
        const control = controlValue(node, lowerTag);
        const lead = needsSacrificialLF(node, lowerTag, control) ? '\n' : '';
        if (node.__rawHtml != null) {
            yield lead + String(node.__rawHtml);
        } else if (lowerTag === 'textarea' && control != null) {
            yield lead + escapeHtml(control);
        } else {
            if (lowerTag === 'select' && control != null) markSelectSelection(node, control);
            if (lead) yield lead;
            for (const c of node.children || []) yield* streamSerializeChunks(c);
        }
        if (!isVoidTag(tag)) yield `</${tag}>`;
    }
}

function fillRowKernelHtml(rk, item, key) {
    const slots = rk.textSlots;
    if (!slots || typeof slots !== 'object') return null;

    const fields = Object.entries(slots)
        .filter(([, i]) => typeof i === 'number' && Number.isFinite(i))
        .sort((a, b) => Number(a[1]) - Number(b[1]))
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

function virtualLink(parent, child) {
    if (child != null && typeof child === 'object') child.parentNode = parent;
}

function virtualAppend(parent, child) {
    if (parent == null || child == null) return;
    if (!Array.isArray(parent.children)) parent.children = [];
    parent.children.push(child);
    virtualLink(parent, child);
}

function virtualInsertBefore(parent, node, ref) {
    if (parent == null || node == null) return;
    if (!Array.isArray(parent.children)) parent.children = [];
    if (ref == null) {
        virtualAppend(parent, node);
        return;
    }
    const idx = parent.children.indexOf(ref);
    if (idx < 0) virtualAppend(parent, node);
    else {
        parent.children.splice(idx, 0, node);
        virtualLink(parent, node);
    }
}

function virtualRemove(node) {
    const p = node && node.parentNode;
    if (!p || !Array.isArray(p.children)) return;
    const idx = p.children.indexOf(node);
    if (idx >= 0) p.children.splice(idx, 1);
    node.parentNode = null;
}

/**
 * Replace an element's content with escaped text (`v-text` / `el.textContent`).
 * Direct emit writes `textContent` for both static and reactive text, so SSR
 * must model it or the first response ships an empty element.
 */
function replaceSerializeText(node, value) {
    const text = value == null ? '' : String(value);
    node.__rawHtml = null;
    node.children = text === '' ? [] : [{ __kind: 'text', value: text, parentNode: node }];
}

function makeVirtualEl(tag) {
    const node = {
        __kind: 'el',
        tag: tag || 'div',
        attrs: {},
        children: [],
        style: {},
        __rawHtml: null,
        __vmzKey: null,
        parentNode: null,
        setAttribute(name, value) {
            applySerializeAttr(this, name, value);
        },
        appendChild(c) {
            virtualAppend(this, c);
        },
        insertBefore(node, ref) {
            virtualInsertBefore(this, node, ref);
        },
    };
    // Direct emit writes `el.innerHTML` for v-html. Mirror that DOM property
    // on the SSR virtual element so the serializer receives the same payload.
    Object.defineProperty(node, 'innerHTML', {
        configurable: true,
        get() {
            return this.__rawHtml ?? '';
        },
        set(value) {
            this.__rawHtml = value == null ? '' : String(value);
            this.children = [];
        },
    });
    // Direct emit writes `el.textContent` for v-text (static `api.setText` and
    // reactive `el.textContent = …`). Mirror it so the serializer sees the text.
    Object.defineProperty(node, 'textContent', {
        configurable: true,
        get() {
            return nodeText(this);
        },
        set(value) {
            replaceSerializeText(this, value);
        },
    });
    return node;
}

/**
 * Owned `<slot>` outlet in a serialize el tree.
 *
 * `name === null` matches the default outlet (no `name` attr). Named lookups require
 * an exact match and stop at nested component shells (`data-vmz`), mirroring the
 * browser runtime ownership boundary.
 */
function findOwnedSerializeSlot(n, name) {
    if (!n || typeof n !== 'object') return null;
    if (n.__kind === 'frag') {
        for (const c of n.children || []) {
            const hit = findOwnedSerializeSlot(c, name);
            if (hit) return hit;
        }
        return null;
    }
    if (n.__kind !== 'el') return null;
    if (n.tag === 'slot') {
        const outletName = n.attrs && n.attrs.name != null ? String(n.attrs.name) : '';
        if (name == null ? !outletName : outletName === name) return n;
    }
    for (const c of n.children || []) {
        if (c && c.__kind === 'el' && c.attrs && c.attrs['data-vmz'] != null) continue;
        const hit = findOwnedSerializeSlot(c, name);
        if (hit) return hit;
    }
    return null;
}

function findOwnedSerializeSlotTarget(n, name) {
    const slot = findOwnedSerializeSlot(n, name);
    if (slot) return slot;
    if (name != null) return null;
    if (!n || n.__kind !== 'el') return null;
    const tag = String(n.tag || '').toLowerCase();
    if ((tag === 'button' || tag === 'a') && n.attrs && n.attrs['data-vmz-ui'] === 'button') return n;
    if (n.attrs && n.attrs['data-vmz'] != null) return null;
    for (const c of n.children || []) {
        if (c && c.__kind === 'el' && c.attrs && c.attrs['data-vmz'] != null) continue;
        const hit = findOwnedSerializeSlotTarget(c, name);
        if (hit) return hit;
    }
    return null;
}

/** Outlets that already received projected content (fallback children dropped once). */
const filledSerializeSlots = new WeakSet();

const serializeApi = {
    _inst: null,

    _branchBinds: null,

    _itemPatches: null,

    _eachCtx: null,

    _ssrPreMounted: null,

    _ssrPreIdx: 0,

    _ssrCollected: null,

    _ssrChildInstance(Ctor, resolved) {
        const pre = serializeApi._ssrPreMounted;
        if (pre && serializeApi._ssrPreIdx < pre.length) {
            return pre[serializeApi._ssrPreIdx++];
        }
        const child = createInstance(Ctor, resolved);
        if (serializeApi._ssrCollected) serializeApi._ssrCollected.push(child);
        return child;
    },
    el(tag, key ?) {
        const node = makeVirtualEl(tag) as ReturnType<typeof makeVirtualEl> & { namespaceURI?: string };
        if (String(tag || '').toLowerCase() === 'svg') {
            node.namespaceURI = 'http://www.w3.org/2000/svg';
        }
        // Row roots need their key in the HTML so hydration reclaims by identity,
        // not the order in which tags happen to appear.
        if (key != null) {
            node.__vmzKey = key;
            if (!node.attrs) node.attrs = Object.create(null);
            node.attrs['data-vmz-key'] = String(key);
        }
        return node;
    },
    elNS(ns, tag) {
        const node = makeVirtualEl(tag) as ReturnType<typeof makeVirtualEl> & { namespaceURI?: string };
        node.namespaceURI = ns || 'http://www.w3.org/2000/svg';
        return node;
    },
    text(value) {
        const node = { __kind: 'text', value: value == null ? '' : String(value), parentNode: null };
        // Generated Direct patches use DOM `textContent`; virtual text uses `value`.
        Object.defineProperty(node, 'textContent', {
            configurable: true,
            enumerable: false,
            get() {
                return node.value;
            },
            set(v) {
                node.value = v == null ? '' : String(v);
            },
        });
        return node;
    },
    comment(value) {
        return { __kind: 'comment', value: value == null ? '' : String(value), parentNode: null };
    },
    frag() {
        return {
            __kind: 'frag',
            children: [],
            parentNode: null,
            appendChild(c) {
                virtualAppend(this, c);
            },
            insertBefore(node, ref) {
                virtualInsertBefore(this, node, ref);
            },
        };
    },
    /** Multi-root `<template v-for>` row fragment; serializes its marker pair. */
    fragRow(key) {
        const frag = serializeApi.frag();
        if (key != null) (frag as any).__vmzRowKey = String(key);
        return frag;
    },
    rowEnd() {
        /* SSR rows are one-shot: the marker pair closes at serialization. */
    },
    insertBefore(parent, node, ref) {
        virtualInsertBefore(parent, node, ref);
    },
    removeNode(node) {
        virtualRemove(node);
    },
    trackPatch(inst, deps, patch, bindingId = null) {
        if (typeof patch !== 'function') return;
        if (serializeApi._branchBinds) {
            serializeApi._branchBinds.push({ deps: deps || [], fn: patch, bindingId });
            try {
                patch.call(inst);
            } catch (err) {
                console.error('vmz:ssr trackPatch branch', err);
            }
            return;
        }
        if (serializeApi._itemPatches) {
            patch.__vmzItemLocal = true;
            serializeApi._itemPatches.push(patch);
            if (serializeApi._eachCtx) {
                serializeApi._eachCtx.noteItemBind(bindingId, deps || [], patch);
            }
            try {
                patch.call(inst);
            } catch (err) {
                console.error('vmz:ssr trackPatch item', err);
            }
            return;
        }
        try {
            patch.call(inst);
        } catch (err) {
            console.error('vmz:ssr trackPatch', err);
        }
    },
    untrackPatch() {
        /* SSR one-shot schedule ??no reactive unregister */
    },
    disposeTree() {
        /* SSR one-shot schedule */
    },
    attr(el, name, value) {
        if (!el || el.__kind !== 'el') return;
        applySerializeAttr(el, name, value);
    },
    mergeClass(...parts) {
        return mergeClassParts(...parts);
    },
    mergeStyle(...parts) {
        return mergeStyleParts(...parts);
    },
    on() {
        /* events are no-ops during SSR */
    },
    onMethod() {
        /* named method events are also attached only during client resume */
    },
    adoptEnter() {
        return false;
    },
    adoptLeave() {
        /* resume scope only */
    },
    onComponentEvent() {
        /* component events attach only on the client */
    },
    specFieldText(inst, _bindingId, fieldName, textNode) {
        let raw;
        try {
            raw = inst[fieldName];
        } catch {
            raw = '';
        }
        textNode.value = String(raw ?? '');
    },
    specFieldAttr(inst, _bindingId, fieldName, el, name) {
        let raw;
        try {
            raw = inst[fieldName];
        } catch {
            raw = null;
        }
        if (name === 'class' || name === 'className') {
            applySerializeAttr(el, 'class', mergeClassParts(raw));
            return;
        }
        if (name === 'style') {
            applySerializeAttr(el, 'style', mergeStyleParts(raw));
            return;
        }
        applySerializeAttr(el, name, raw);
    },
    bindComponentProp() {
        /* SSR: props already resolved into the child instance at create */
    },
    bindComponentProps() {
        /* SSR: `...api.spreadProps()` already delivered the object props at create */
    },
    bindComponentEvents() {
        /* component events attach only on the client */
    },
    bindObjectListeners() {
        /* object listeners attach only on the client */
    },
    spreadProps(source) {
        const out: Record<string, unknown> = Object.create(null);
        if (source && typeof source === 'object') {
            for (const key of Object.keys(source as Record<string, unknown>)) {
                if (!key || key.startsWith('#')) continue;
                out[key] = (source as Record<string, unknown>)[key];
            }
        }
        return out;
    },
    projectDefaultSlot(hostEl, node) {
        if (!hostEl || node == null) return;
        // serializeApi.component returns a serialize el tree (or island shell).
        const root = hostEl.__kind === 'el' ? hostEl : null;
        // Prefer searching the component body (first child of host wrapper).
        let target = null;
        if (root) {
            for (const c of root.children || []) {
                if (c && c.__kind === 'el' && c.attrs && c.attrs['data-vmz'] != null) continue;
                target = findOwnedSerializeSlotTarget(c, null);
                if (target) break;
            }
            if (!target) target = findOwnedSerializeSlotTarget(root, null);
        }
        if (target) {
            if (target.tag === 'slot') {
                target.__rawHtml = null;
                if (!Array.isArray(target.children)) target.children = [];
                // The client replaces the live `<slot>` with the first projected node,
                // which discards its fallback children. Drop the fallback on the first
                // projection too, then accumulate later projections as siblings.
                if (!filledSerializeSlots.has(target)) {
                    filledSerializeSlots.add(target);
                    target.children.length = 0;
                }
                target.children.push(node);
                return;
            }
            if (!Array.isArray(target.children)) target.children = [];
            target.children.push(node);
            return;
        }
        // No default slot in this render: children belong to a branch that is not
        // mounted (closed overlay, loading skeleton). Mirror the browser runtime and
        // drop them instead of painting them into the component root.
    },
    /**
     * Project parent children into a nested component's `<slot name="…">` outlet.
     *
     * Named projections are name-only (scope-slot values are not passed yet). Only an
     * outlet with the exact `name` accepts the node — a missing name drops it instead
     * of landing in the default slot. Fallback children stop rendering once the outlet
     * has projected content.
     */
    projectNamedSlot(hostEl, name, node) {
        if (!hostEl || node == null) return;
        const key = name == null ? '' : String(name);
        if (!key || key === 'default') {
            serializeApi.projectDefaultSlot(hostEl, node);
            return;
        }
        const root = hostEl.__kind === 'el' ? hostEl : null;
        let target = null;
        if (root) {
            for (const c of root.children || []) {
                if (c && c.__kind === 'el' && c.attrs && c.attrs['data-vmz'] != null) continue;
                target = findOwnedSerializeSlotTarget(c, key);
                if (target) break;
            }
            if (!target) target = findOwnedSerializeSlotTarget(root, key);
        }
        if (!target) return;
        target.__rawHtml = null;
        if (!Array.isArray(target.children)) target.children = [];
        if (!filledSerializeSlots.has(target)) {
            filledSerializeSlots.add(target);
            target.children.length = 0;
        }
        target.children.push(node);
    },
    setHtml(el, value) {
        if (!el || el.__kind !== 'el') return;
        el.__rawHtml = value == null ? '' : String(value);
        el.children = [];
    },
    // Emitted `v-html` write. SSR always records the payload, and the open tag
    // gains `data-vmz-html-hash` from that exact string at serialize time.
    html(el, value) {
        serializeApi.setHtml(el, value);
    },
    setText(el, value) {
        if (!el || el.__kind !== 'el') return;
        replaceSerializeText(el, value);
    },
    setShow(el, condition) {
        if (!el || el.__kind !== 'el') return;
        if (!el.style || typeof el.style !== 'object') el.style = {};
        el.style.display = condition ? '' : 'none';
    },
    bindHtml(inst, bindingId, deps, get, el) {
        serializeApi.trackPatch(
            inst,
            deps || [],
            function bindHtmlPatch() {
                let raw;
                try {
                    raw = get.call(inst);
                } catch {
                    raw = '';
                }
                serializeApi.setHtml(el, raw);
            },
            bindingId,
        );
    },
    component(hostInst, nameOrCtor, props, client, key ?) {
        const name = typeof nameOrCtor === 'function' ? nameOrCtor.__vmzTag || nameOrCtor.name || 'Component' : nameOrCtor;
        const Ctor = typeof nameOrCtor === 'function' ? nameOrCtor : getRegisteredComponent(name);
        if (!Ctor) {
            return serializeUnknownComponentNode(name);
        }

        const rawProps = (props || {}) as Record<string, unknown>;
        // `id` / `data-*` / `aria-*` belong on the host element, matching the
        // browser `api.component` fallthrough.
        const hostAttrs = rawProps.__hostAttrs as Record<string, unknown> | undefined;
        const resolved = {};
        for (const [k, v] of Object.entries(rawProps)) {
            if (k === '__hostAttrs') continue;
            const onKey = typeof v === 'function' ? eventPropHandlerName(k) : null;
            if (onKey) continue;
            else if (typeof v === 'function') resolved[k] = v.call(hostInst);
            else resolved[k] = v;
        }
        const applyHostAttrs = (attrs: Record<string, string>) => {
            if (!hostAttrs) return attrs;
            for (const [k, v] of Object.entries(hostAttrs)) {
                if (v == null || v === false) continue;
                attrs[k] = v === true ? '' : String(v);
            }
            return attrs;
        };
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
            const attrs: Record<string, string> = {
                'data-vmz': name,
                'data-vmz-island': name,
                'data-vmz-client': String(client),
                'data-vmz-props': JSON.stringify(stripFns(resolved)),
                'data-vmz-resume': JSON.stringify(resume),
            };
            const boxStyle = directHostBoxStyleAttr(name, Ctor);
            if (boxStyle) attrs.style = boxStyle;
            applyHostAttrs(attrs);
            if (key != null) attrs['data-vmz-key'] = String(key);
            if (isEventEntryStrategy(String(client))) {
                attrs['data-vmz-entry'] = 'event';
            }
            return {
                __kind: 'el',
                tag: resolveDirectHostTag(name, Ctor),
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
            // A child nested inside the parent's `v-for` must not feed the parent
            // item patch sink: those patches belong to the child instance (`this`).
            // Replaying them with the parent's each host clears child output
            // (innerHTML / text) that was already correct at create time.
            const prevItemPatches = serializeApi._itemPatches;
            serializeApi._inst = child;
            serializeApi._itemPatches = null;
            try {
                const node = Ctor.__vmzCreate.call(child, serializeApi);
                const attrs: Record<string, string> = { 'data-vmz': name };
                const boxStyle = directHostBoxStyleAttr(name, Ctor);
                if (boxStyle) attrs.style = boxStyle;
                applyHostAttrs(attrs);
                if (key != null) attrs['data-vmz-key'] = String(key);
                return {
                    __kind: 'el',
                    tag: resolveDirectHostTag(name, Ctor),
                    attrs,
                    children: node ? [node] : [],
                    appendChild(c) {
                        if (c != null) this.children.push(c);
                    },
                };
            } finally {
                serializeApi._inst = prev;
                serializeApi._itemPatches = prevItemPatches;
            }
        }
        throw new Error(`vmz:dom serialize component <${name}> requires __vmzCreate (rebuild child with Direct)`);
    },
    /**
     * `<component :is>` on the server: `is` and props are evaluated once at
     * create time, so the dynamic boundary serializes exactly like the resolved
     * static component.
     */
    dynamicComponent(hostInst, bindingId, deps, getCtor, getProps, key ?) {
        let Ctor = null;
        try {
            Ctor = getCtor.call(hostInst);
        } catch {
            Ctor = null;
        }
        let props = {};
        try {
            props = getProps.call(hostInst) || {};
        } catch {
            props = {};
        }
        return serializeApi.component(hostInst, Ctor, props, null, key);
    },
};

function applySerializeAttr(el, name, value) {
    if (!el || el.__kind !== 'el') return;
    const key = name === 'className' ? 'class' : name;
    if (key === 'class') {
        const s = mergeClassParts(value);
        if (s) el.attrs[key] = s;
        else delete el.attrs[key];
        return;
    }
    if (key === 'style') {
        const s = mergeStyleParts(value);
        if (s) el.attrs[key] = s;
        else delete el.attrs[key];
        return;
    }
    if (BOOLEAN_HTML_ATTRS.has(String(key).toLowerCase())) {
        if (value === false || value == null || value === '') delete el.attrs[key];
        else el.attrs[key] = value === true ? '' : String(value);
        return;
    }
    // A `multiple` select model is a list. Stringifying it here would emit one
    // `value="c,a"` attribute, so `markSelectSelection` could never match an
    // option and SSR shipped a select with nothing selected.
    if (key === 'value' && String(el.tag || '').toLowerCase() === 'select' && Array.isArray(value)) {
        el.attrs[key] = value.map((item) => String(item));
        return;
    }
    if (value == null || value === false) delete el.attrs[key];
    else el.attrs[key] = value === true ? '' : String(value);
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        // The HTML input stream normalizes a literal CR (and CRLF) to LF before
        // tokenization, so a raw `\r` would not survive the parse. Emit a character
        // reference instead: hydration then keeps the exact server value.
        .replace(/\r/g, '&#13;');
}

/** `<pre>` / `<textarea>` drop one leading LF after their start tag (HTML spec). */
function dropsLeadingLF(tag) {
    return tag === 'pre' || tag === 'textarea';
}

/** Does the first token inside `node` start with LF? Comments and tags do not. */
function firstTokenStartsWithLF(node) {
    if (node == null || node === false) return false;
    if (typeof node === 'string') return node.startsWith('\n');
    if (node.__kind === 'text') return String(node.value ?? '').startsWith('\n');
    if (node.__kind === 'comment') return false;
    if (node.__kind === 'frag') {
        if (node.__rawHtml != null) return String(node.__rawHtml).startsWith('\n');
        for (const c of node.children || []) {
            if (c == null || c === false) continue;
            return firstTokenStartsWithLF(c);
        }
    }
    return false;
}

/**
 * A value that itself starts with LF needs one sacrificial newline: the parser
 * discards the first LF token, leaving the real one in the DOM.
 */
function needsSacrificialLF(node, lowerTag, control) {
    if (!dropsLeadingLF(lowerTag)) return false;
    if (lowerTag === 'textarea' && control != null) return String(control).startsWith('\n');
    if (node.__rawHtml != null) return String(node.__rawHtml).startsWith('\n');
    for (const c of node.children || []) {
        if (c == null || c === false) continue;
        return firstTokenStartsWithLF(c);
    }
    return false;
}

