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
import { _ssrDocumentLastError, ensureSsrDocument } from './document.js';

function runDirectSerializeTree(Component, inst) {
    serializeApi._inst = inst;
    try {
        return Component.__vmzCreate.call(inst, serializeApi);
    } finally {
        serializeApi._inst = null;
    }
}

export async function runDirectSerializeTreeWithMounts(Component, inst) {
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

export function flattenSerializeNode(node) {
    if (node == null || node === false) return '';
    if (typeof node === 'string' || typeof node === 'number') return escapeHtml(node);
    if (node.__kind === 'text') return escapeHtml(node.value);
    if (node.__kind === 'comment') return '';
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

function makeVirtualEl(tag) {
    const node = {
        __kind: 'el',
        tag: tag || 'div',
        attrs: {},
        children: [],
        style: {},
        __rawHtml: null,
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
    return node;
}

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
    el(tag) {
        const node = makeVirtualEl(tag) as ReturnType<typeof makeVirtualEl> & { namespaceURI?: string };
        if (String(tag || '').toLowerCase() === 'svg') {
            node.namespaceURI = 'http://www.w3.org/2000/svg';
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
    projectDefaultSlot(hostEl, node) {
        if (!hostEl || node == null) return;
        // serializeApi.component returns a serialize el tree (or island shell).
        const root = hostEl.__kind === 'el' ? hostEl : null;
        const findOwnedSlot = (n) => {
            if (!n || typeof n !== 'object') return null;
            if (n.__kind === 'frag') {
                for (const c of n.children || []) {
                    const hit = findOwnedSlot(c);
                    if (hit) return hit;
                }
                return null;
            }
            if (n.__kind !== 'el') return null;
            if (n.tag === 'slot' && !(n.attrs && n.attrs.name)) return n;
            for (const c of n.children || []) {
                if (c && c.__kind === 'el' && c.attrs && c.attrs['data-vmz'] != null) continue;
                const hit = findOwnedSlot(c);
                if (hit) return hit;
            }
            return null;
        };
        const findOwnedSlotTarget = (n) => {
            const slot = findOwnedSlot(n);
            if (slot) return slot;
            if (!n || n.__kind !== 'el') return null;
            const tag = String(n.tag || '').toLowerCase();
            if ((tag === 'button' || tag === 'a') && n.attrs && n.attrs['data-vmz-ui'] === 'button') return n;
            if (n.attrs && n.attrs['data-vmz'] != null) return null;
            for (const c of n.children || []) {
                if (c && c.__kind === 'el' && c.attrs && c.attrs['data-vmz'] != null) continue;
                const hit = findOwnedSlotTarget(c);
                if (hit) return hit;
            }
            return null;
        };
        // Prefer searching the component body (first child of host wrapper).
        let target = null;
        if (root) {
            for (const c of root.children || []) {
                if (c && c.__kind === 'el' && c.attrs && c.attrs['data-vmz'] != null) continue;
                target = findOwnedSlotTarget(c);
                if (target) break;
            }
            if (!target) target = findOwnedSlotTarget(root);
        }
        if (target) {
            if (target.tag === 'slot') {
                target.__rawHtml = null;
                if (!Array.isArray(target.children)) target.children = [];
                // Append ??multiple projectDefaultSlot calls must accumulate (SSR).
                // Client path replaces the live <slot> then appends siblings; serialize must push.
                target.children.push(node);
                return;
            }
            if (!Array.isArray(target.children)) target.children = [];
            target.children.push(node);
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
    component(hostInst, nameOrCtor, props, client) {
        const name = typeof nameOrCtor === 'function' ? nameOrCtor.__vmzTag || nameOrCtor.name || 'Component' : nameOrCtor;
        const Ctor = typeof nameOrCtor === 'function' ? nameOrCtor : getRegisteredComponent(name);
        if (!Ctor) {
            return serializeUnknownComponentNode(name);
        }

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
            const attrs: Record<string, string> = {
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
                const attrs: Record<string, string> = { 'data-vmz': name };
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
    if (value == null || value === false) delete el.attrs[key];
    else el.attrs[key] = value === true ? '' : String(value);
}

function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
