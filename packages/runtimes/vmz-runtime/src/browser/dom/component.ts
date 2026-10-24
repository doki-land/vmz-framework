import { mergeClassParts, mergeStyleParts } from '../../shared/dom-attr-normalize.js';
import type { BindingId, DirectInstance, PatchFn } from '../direct-api.types.js';
import { applyDirectHostBox } from '../direct-host-box.js';
import type {
    ComponentCtor,
    EachCtx,
    PrecisionState,
    ReactiveEntry,
    ResumeAdoptCtx,
    TraceBuffer,
    VmzContainer,
    VmzDomElement,
    VmzDomNode,
} from '../dom-core.types.js';
import { createUnknownComponentElement } from '../unknown-component.js';
import { precision } from '../diagnostics/precision-trace.js';
import { emitComponentEvent } from './attributes.js';
import { directApi } from './direct-api.js';
import { __vmzCancelTasks } from './lifecycle.js';
import { flushPending } from '../reactivity/patch-scheduler.js';
import {
    __vmzAllowShared,
    __vmzArrayItemCompoundStride,
    __vmzArrayMutate,
    __vmzListTranspose,
    __vmzReadPath,
    __vmzTakeShared,
    __vmzWritePath,
    __vmzWritePathCompound,
    __vmzWritePathCompoundItem,
    __vmzWritePathItem,
    __vmzWritePathLogical,
    makeReactive,
} from '../reactivity/write-barrier.js';

export async function mount(Component, container, props: any = {}) {
    if (container.__vmzInst) {
        destroy(container.__vmzInst);
        container.__vmzInst = null;
    }
    const inst = createInstance(Component, props);
    inst.__vmzBinders = Object.create(null);
    inst.__vmzBindings = Object.create(null);
    inst.__vmzDepToBindings = Object.create(null);
    container.replaceChildren();
    const node = await createFromComponent(Component, inst);
    if (node) {
        inst.__vmzDomRoot = node;
        container.appendChild(node);
    }
    if (typeof inst.onMount === 'function') {
        await inst.onMount();
    }
    await settlePendingChildMounts(inst);
    container.__vmzInst = inst;
    return inst;
}

export async function settlePendingChildMounts(inst) {
    if (!inst || !Array.isArray(inst.__vmzPendingChildMounts) || !inst.__vmzPendingChildMounts.length) return;
    await Promise.all(inst.__vmzPendingChildMounts);
    inst.__vmzPendingChildMounts = [];
    const hosts = [];
    const root = inst.__vmzDomRoot;
    if (root && root.nodeType === 1) {
        if (root.__vmzInst) hosts.push(root.__vmzInst);
        for (const el of root.querySelectorAll('[data-vmz]')) {
            if (el.__vmzInst) hosts.push(el.__vmzInst);
        }
    }
    for (const child of hosts) {
        await flushPending(child);
        await settlePendingChildMounts(child);
    }
}

async function createFromComponent(Component, inst) {
    if (Component && Component.__vmzDirect && typeof Component.__vmzCreate === 'function') {
        return runDirectCreate(Component, inst);
    }
    throw new Error(`vmz:dom mount requires __vmzCreate (Direct); blueprint render() removed (production Direct emit)`);
}

export function runDirectCreate(Component, inst) {
    // Nested component creates (e.g. Button inside parent ifBlock branch) must not
    // leak bindAttr/bindText into the parent's `_branchBinds` / `_itemPatches` sink ??    // that steals numeric BindingIds (0) and corrupts parent deps (density ??type).
    const prevInst = directApi._inst;
    const prevBranch = directApi._branchBinds;
    const prevItems = directApi._itemPatches;
    const prevEach = directApi._eachCtx;
    directApi._inst = inst;
    directApi._branchBinds = null;
    directApi._itemPatches = null;
    directApi._eachCtx = null;
    try {
        return Component.__vmzCreate.call(inst, directApi);
    } finally {
        directApi._inst = prevInst;
        directApi._branchBinds = prevBranch;
        directApi._itemPatches = prevItems;
        directApi._eachCtx = prevEach;
    }
}

export function findOwnedDefaultSlot(root) {
    if (!root || root.nodeType !== 1) return null;
    const tag = String(root.tagName || '').toLowerCase();
    if (tag === 'slot' && !root.getAttribute('name')) return root;
    const kids = root.children;
    if (!kids || !kids.length) return null;
    for (let i = 0; i < kids.length; i++) {
        const c = kids[i];
        if (c.nodeType !== 1) continue;
        if (c.hasAttribute('data-vmz')) continue;
        const hit = findOwnedDefaultSlot(c);
        if (hit) return hit;
    }
    return null;
}

export function findOwnedDefaultSlotTarget(root) {
    const slot = findOwnedDefaultSlot(root);
    if (slot) return slot;
    if (!root || root.nodeType !== 1) return null;
    const walk = (el) => {
        if (!el || el.nodeType !== 1) return null;
        const tag = String(el.tagName || '').toLowerCase();
        if ((tag === 'button' || tag === 'a') && el.getAttribute('data-vmz-ui') === 'button') return el;
        if (el.hasAttribute('data-vmz')) return null;
        const kids = el.children;
        if (!kids || !kids.length) return null;
        for (let i = 0; i < kids.length; i++) {
            const hit = walk(kids[i]);
            if (hit) return hit;
        }
        return null;
    };
    return walk(root);
}

export function createInstance(Component, props: any = {}) {
    if (precision.enabled) precision.componentExecs++;
    const inst = new Component(props || {});
    if (typeof inst.__vmzApplyProps === 'function' && !Component.__vmzCtorAppliesProps) {
        inst.__vmzApplyProps(props || {});
    }
    inst.__vmzBinders = Object.create(null);
    inst.__vmzBindings = Object.create(null);
    inst.__vmzDepToBindings = Object.create(null);
    inst.__vmzComponentListeners = Object.create(null);
    // Compiler intrinsic surface: `this.emit('submit', payload)` ??not a string bus.
    inst.emit = function emit(eventName, ...payload) {
        return emitComponentEvent(inst, eventName, ...payload);
    };
    makeReactive(inst, Component.__vmzState || []);
    makeReactive(inst, Component.__vmzProps || []);
    // WriteBarrier: install Component helpers once (no import needed in emitted code).
    if (!Component.__vmzWBInstalled) {
        Component.__vmzWBInstalled = true;
        Component.__vmzWritePath = __vmzWritePath;
        Component.__vmzWritePathItem = __vmzWritePathItem;
        Component.__vmzWritePathCompound = __vmzWritePathCompound;
        Component.__vmzWritePathCompoundItem = __vmzWritePathCompoundItem;
        Component.__vmzWritePathLogical = __vmzWritePathLogical;
        Component.__vmzReadPath = __vmzReadPath;
        Component.__vmzArrayMutate = __vmzArrayMutate;
        Component.__vmzArrayItemCompoundStride = __vmzArrayItemCompoundStride;
        Component.__vmzListTranspose = __vmzListTranspose;
        Component.__vmzAllowShared = __vmzAllowShared;
        Component.__vmzTakeShared = __vmzTakeShared;
    }
    return inst;
}

export function destroy(inst) {
    if (!inst || inst.__vmzDestroyed) return;
    inst.__vmzDestroyed = true;
    inst.__vmzFlushScheduled = false;
    // async cancel: abort in-flight tasks before tearing down DOM.
    __vmzCancelTasks(inst);
    if (inst.__vmzDomRoot) {
        disposeDomTree(inst.__vmzDomRoot);
        inst.__vmzDomRoot = null;
    }
    if (inst.__vmzDirtyNotices) inst.__vmzDirtyNotices.length = 0;
    if (inst.__vmzDirtyTrie) inst.__vmzDirtyTrie = Object.create(null);
    if (inst.__vmzDirty) inst.__vmzDirty.clear();
    inst.__vmzBinders = Object.create(null);
    inst.__vmzBindings = Object.create(null);
    inst.__vmzDepToBindings = Object.create(null);
    if (typeof inst.onDestroy === 'function') {
        try {
            inst.onDestroy();
        } catch (err) {
            console.error('vmz:dom onDestroy', err);
        }
    }
}

/**
 * DocumentFragment anchors are emptied by insertion (children move out, the
 * fragment keeps no parentNode), so a projected fragment must anchor on its
 * last child. Capture before inserting.
 */
export function slotAnchorFor(node) {
    return node && node.nodeType === 11 ? node.lastChild : node;
}

export function insertProjectedSlotNode(target, node) {
    if (!target || !node) return null;
    const anchor = slotAnchorFor(node);
    if (String(target.tagName || '').toLowerCase() === 'slot') {
        target.replaceWith(node);
        return anchor;
    }
    target.appendChild(node);
    return anchor;
}

/**
 * Hold projected children until the component's default slot exists.
 *
 * A slot inside an unmounted `v-if` branch (closed drawer/dialog, loading
 * skeleton) is absent at projection time. Appending to the component root would
 * paint the child into the live page, so keep it detached and splice it in when
 * the slot is mounted.
 */
export function parkSlotNode(hostEl, node) {
    if (!hostEl || !node) return;
    if (typeof MutationObserver === 'undefined') {
        // Non-browser DOM (unit hosts): preserve the legacy root fallback.
        const child = hostEl.__vmzInst;
        const root = (child && child.__vmzDomRoot) || hostEl;
        if (root && root.nodeType === 1 && typeof root.appendChild === 'function') root.appendChild(node);
        else if (typeof hostEl.appendChild === 'function') hostEl.appendChild(node);
        return;
    }
    const parked = hostEl.__vmzSlotParked || (hostEl.__vmzSlotParked = []);
    parked.push(node);
    if (hostEl.__vmzSlotObserver) return;
    hostEl.__vmzSlotObserver = new MutationObserver(() => {
        flushParkedSlotNodes(hostEl);
    });
    const scope = (hostEl.__vmzInst && hostEl.__vmzInst.__vmzDomRoot) || hostEl;
    if (scope && scope.nodeType === 1) {
        hostEl.__vmzSlotObserver.observe(scope, { childList: true, subtree: true });
    }
}

/** Move parked children into the now-mounted default slot. Returns true when drained. */
export function flushParkedSlotNodes(hostEl) {
    if (!hostEl) return false;
    const parked = hostEl.__vmzSlotParked;
    if (!parked || !parked.length) return false;
    const child = hostEl.__vmzInst;
    const root = (child && child.__vmzDomRoot) || hostEl;
    if (!root || root.nodeType !== 1) return false;
    const target = findOwnedDefaultSlotTarget(root);
    if (!target || !target.parentNode) return false;
    if (hostEl.__vmzSlotObserver) {
        hostEl.__vmzSlotObserver.disconnect();
        hostEl.__vmzSlotObserver = null;
    }
    hostEl.__vmzSlotParked = [];
    const anchor = slotAnchorFor(parked[parked.length - 1]);
    const tag = String(target.tagName || '').toLowerCase();
    if (tag === 'slot') {
        const frag = typeof document !== 'undefined' ? document.createDocumentFragment() : null;
        if (!frag) {
            target.replaceWith(parked[0]);
            hostEl.__vmzSlotAnchor = anchor;
            return true;
        }
        for (const node of parked) frag.appendChild(node);
        target.replaceWith(frag);
        hostEl.__vmzSlotAnchor = anchor;
        return true;
    }
    for (const node of parked) target.appendChild(node);
    hostEl.__vmzSlotAnchor = anchor;
    return true;
}

export function disposeDomTree(root) {
    if (!root) return;
    const seen = new Set();
    const visit = (node) => {
        if (!node || seen.has(node)) return;
        seen.add(node);
        if (typeof node.__vmzDispose === 'function') {
            try {
                node.__vmzDispose();
            } catch (err) {
                console.error('vmz:dom __vmzDispose', err);
            }
            node.__vmzDispose = null;
        }
        if (node.__vmzInst) {
            const child = node.__vmzInst;
            node.__vmzInst = null;
            destroy(child);
        }
        if (node.__vmzSlotObserver) {
            node.__vmzSlotObserver.disconnect();
            node.__vmzSlotObserver = null;
        }
        if (node.__vmzSlotParked) node.__vmzSlotParked = [];
        if (node.__vmzSlotAnchor) node.__vmzSlotAnchor = null;
        let child = node.firstChild;
        while (child) {
            const next = child.nextSibling;
            visit(child);
            child = next;
        }
    };
    visit(root);
}

export function snapshotInstanceState(inst) {
    if (!inst || inst.__vmzDestroyed) return null;
    const Ctor = inst.constructor;
    const keys = [...(Ctor.__vmzState || []), ...(Ctor.__vmzProps || [])];

    const out = {};
    for (const key of keys) {
        if (!key || String(key).startsWith('__')) continue;
        try {
            out[key] = inst[key];
        } catch {
            /* ignore accessors that throw */
        }
    }
    return out;
}

export function applyPreservedState(inst, state) {
    if (!inst || !state) return;
    for (const [key, value] of Object.entries(state)) {
        try {
            inst[key] = value;
        } catch {
            /* ignore */
        }
    }
}

export function stripFns(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj || {})) {
        if (typeof v === 'function') continue;
        out[k] = v;
    }
    return out;
}
