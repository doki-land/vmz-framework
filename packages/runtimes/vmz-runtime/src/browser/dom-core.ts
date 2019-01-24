/**
 * VMZ DOM client runtime ??precise patches, no VDOM diff (SSR lives in dom-ssr).
 *
 *
 * Direct components expose `__vmzCreate` / `__vmzSerialize` / `__vmzPlan`.
 * Mount and client patches run that same schedule (SSR/hydrate/resume in dom-ssr).
 * Field writes only run registered dep patches ??never re-create structure.
 */

import { applyDirectHostBox } from './direct-host-box.js';
import { createUnknownComponentElement } from './unknown-component.js';
import type { BindingId, DirectInstance, PatchFn } from './direct-api.types.js';
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
} from './dom-core.types.js';

export { applyDirectHostBox, INLINE_HOST_CONTENTS, resolveDirectHostBox } from './direct-host-box.js';
export {
    createUnknownComponentElement,
    markUnknownComponentHost,
    serializeUnknownComponentNode,
    UNKNOWN_COMPONENT_ERROR,
} from './unknown-component.js';

const components: Record<string, ComponentCtor> = Object.create(null);

/**
 * Precision lab counters (test / MCP / benchmarks — not a user API).
 * Primary keys: BindingId (IR). `*ByDep` is transitional stable-string adapter.
 */
const precision: PrecisionState = {
    enabled: false,
    writes: 0,
    bindingEvals: 0,
    patchExecs: 0,
    domCreates: 0,
    domMoves: 0,
    domRemoves: 0,
    componentExecs: 0,

    writesByRoot: Object.create(null),

    bindingEvalsByDep: Object.create(null),

    patchesByDep: Object.create(null),

    bindingEvalsByBinding: Object.create(null),

    patchesByBinding: Object.create(null),
};

const TRACE_CAP = 256;

const traceBuf: TraceBuffer = {
    enabled: false,
    events: [],
};

function pushTrace(kind, stableKind, stableId, dep = null) {
    if (!traceBuf.enabled && !precision.enabled) return;
    traceBuf.events.push({
        kind,
        stableId: { kind: stableKind, id: String(stableId) },
        dep: dep == null ? undefined : String(dep),
        t: Date.now(),
    });
    if (traceBuf.events.length > TRACE_CAP) {
        traceBuf.events.splice(0, traceBuf.events.length - TRACE_CAP);
    }
}

function bumpMap(map, key, n = 1) {
    if (key == null || key === '') return;
    map[key] = (map[key] || 0) + n;
}

export function __vmzPrecisionEnable(on = true) {
    precision.enabled = !!on;
}

export function __vmzTraceEnable(on = true) {
    traceBuf.enabled = !!on;
}

export function __vmzPrecisionReset() {
    precision.writes = 0;
    precision.bindingEvals = 0;
    precision.patchExecs = 0;
    precision.domCreates = 0;
    precision.domMoves = 0;
    precision.domRemoves = 0;
    precision.componentExecs = 0;
    precision.writesByRoot = Object.create(null);
    precision.bindingEvalsByDep = Object.create(null);
    precision.patchesByDep = Object.create(null);
    precision.bindingEvalsByBinding = Object.create(null);
    precision.patchesByBinding = Object.create(null);
}

export function __vmzTraceReset() {
    traceBuf.events = [];
}

/**
 * StableId event snapshot (`vmz.dx.trace.v0` shape without schema stamp ?? * host may wrap via ingestRuntimeTrace).
 */
export function __vmzTraceSnapshot() {
    const events = traceBuf.events.map((e) => ({ ...e, stableId: { ...e.stableId } }));
    return {
        schema: 'vmz.dx.trace.v0',
        events,
        status: events.length ? 'ready' : 'empty',
    };
}

export function __vmzPrecisionSnapshot() {
    return {
        enabled: precision.enabled,
        writes: precision.writes,
        bindingEvals: precision.bindingEvals,
        patchExecs: precision.patchExecs,
        domCreates: precision.domCreates,
        domMoves: precision.domMoves,
        domRemoves: precision.domRemoves,
        componentExecs: precision.componentExecs,
        writesByRoot: { ...precision.writesByRoot },
        bindingEvalsByDep: { ...precision.bindingEvalsByDep },
        patchesByDep: { ...precision.patchesByDep },
        bindingEvalsByBinding: { ...precision.bindingEvalsByBinding },
        patchesByBinding: { ...precision.patchesByBinding },
    };
}

function runPatch(inst, fn, depKey = null, bindingId = null) {
    if (precision.enabled) {
        // Specialized trackPatch runs are both patch execs and binding evals (0.2.0).
        precision.patchExecs++;
        precision.bindingEvals++;
        if (depKey) {
            bumpMap(precision.patchesByDep, depKey);
            bumpMap(precision.bindingEvalsByDep, depKey);
        }
        if (bindingId != null) {
            const id = String(bindingId);
            bumpMap(precision.patchesByBinding, id);
            bumpMap(precision.bindingEvalsByBinding, id);
        }
    }
    if (bindingId != null) {
        pushTrace('patch', 'binding', bindingId, depKey);
    }
    return fn.call(inst);
}

export function noteDomCreate() {
    if (precision.enabled) precision.domCreates++;
}

function noteDomRemove() {
    if (precision.enabled) precision.domRemoves++;
}

function noteDomMove() {
    if (precision.enabled) precision.domMoves++;
}

export function registerComponents(map) {
    Object.assign(components, map);
}

export function getRegisteredComponent(name) {
    return components[name] || null;
}

/**
 * Lazy component loader for EventEntry mixed packs (set by entry-client / entry-event).
 */
export async function resolveComponent(name) {
    let Ctor = components[name];
    if (!Ctor && typeof globalThis.__vmzLoadComponent === 'function') {
        Ctor = await globalThis.__vmzLoadComponent(name);
        if (Ctor) registerComponents({ [name]: Ctor });
    }
    return Ctor || null;
}

/**
 * Mount once; later updates are dep patches only (never re-run structure).
 * Requires compiler `__vmzCreate` (production Direct emit ??no blueprint fallback).
 */
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

/**
 * Nested Direct `component` schedules child onMount asynchronously; drain before return
 * so SSR/hydrate callers see post-mount DOM (e.g. UserCard Ada, not Loading??.
 */
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

/**
 * Direct create only (production Direct emit).
 */
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

/**
 * First default `<slot>` owned by this component tree ??skip nested `[data-vmz]`
 * hosts (Button/Link/Empty label slots). `querySelector('slot')` steals those and
 * projects parent siblings into the wrong host (commercial Drawer into Create btn).
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
        if (c.hasAttribute('data-vmz')) continue;
        const hit = findOwnedDefaultSlot(c);
        if (hit) return hit;
    }
    return null;
}

export const directApi = {
    _inst: null as DirectInstance | null,
    _branchBinds: null as Array<{ deps: string[]; fn: PatchFn; bindingId?: BindingId }> | null,
    _itemPatches: null as PatchFn[] | null,
    _eachCtx: null as EachCtx | null,
    _resumeAdopt: null as ResumeAdoptCtx | null,
    el(tag) {
        if (directApi._resumeAdopt) return directApi._resumeAdopt.el(tag);
        noteDomCreate();
        return document.createElement(tag || 'div');
    },
    text(value) {
        if (directApi._resumeAdopt) return directApi._resumeAdopt.text(value);
        noteDomCreate();
        return document.createTextNode(value == null ? '' : String(value));
    },

    adoptEnter(node) {
        const adopt = directApi._resumeAdopt;
        if (adopt && typeof adopt.enter === 'function') {
            const ok = adopt.enter(node);
            if (ok) adopt._enterBalance = (adopt._enterBalance || 0) + 1;
            return ok;
        }
        return false;
    },
    adoptLeave() {
        const adopt = directApi._resumeAdopt;
        // Emit always pairs leave after enter; if enter failed (fresh node, no
        // pool), do not pop ??unbalanced leave previously stole parent scopes
        // and projected siblings into nested Button slots.
        if (!adopt || typeof adopt.leave !== 'function') return;
        if ((adopt._enterBalance || 0) <= 0) return;
        adopt._enterBalance -= 1;
        adopt.leave();
    },
    frag() {
        noteDomCreate();
        return document.createDocumentFragment();
    },
    comment(value) {
        noteDomCreate();
        return document.createComment(value == null ? '' : String(value));
    },
    insertBefore(parent, node, ref) {
        if (!parent || node == null) return;
        parent.insertBefore(node, ref);
    },
    removeNode(node) {
        if (!node || !node.parentNode) return;
        noteDomRemove();
        node.remove();
    },
    /**
     * Register a generated per-binding patch (0.2.0). No generic get/cf interpreter.
     */
    trackPatch(inst, deps, patch, bindingId = null) {
        if (typeof patch !== 'function') return;
        if (directApi._branchBinds) {
            directApi._branchBinds.push({ deps: deps || [], fn: patch, bindingId });
            try {
                patch.call(inst);
            } catch (err) {
                console.error('vmz:dom trackPatch branch', err);
            }
            return;
        }
        if (directApi._itemPatches) {
            patch.__vmzItemLocal = true;
            directApi._itemPatches.push(patch);
            if (directApi._eachCtx) {
                directApi._eachCtx.noteItemBind(bindingId, deps || [], patch);
            }
            try {
                patch.call(inst);
            } catch (err) {
                console.error('vmz:dom trackPatch item', err);
            }
            return;
        }
        registerBind(inst, deps || [], patch, bindingId);
        try {
            runPatch(inst, patch, (deps && deps[0]) || null, bindingId ?? null);
        } catch (err) {
            console.error('vmz:dom trackPatch', err);
        }
    },
    untrackPatch(inst, deps, patch, bindingId = null) {
        if (typeof patch !== 'function') return;
        unregisterBind(inst, deps || [], patch, bindingId);
    },
    disposeTree(root) {
        disposeDomTree(root);
    },
    attr(el, name, value) {
        applyDomAttr(el, name, value);
    },
    on(el, type, handler) {
        const inst = directApi._inst;
        if (directApi._eachCtx && typeof handler === 'function') {
            const bag = el.__vmzEvt || (el.__vmzEvt = Object.create(null));
            const methodHint = inferHandlerMethod(handler);
            const listener = (ev: Event) => {
                if (type === 'submit' && ev && typeof (ev as SubmitEvent).preventDefault === 'function') {
                    (ev as SubmitEvent).preventDefault();
                }
                if (methodHint && methodAllowsSyncEventFlush(inst, methodHint)) {
                    runDomEventHandler(inst, methodHint, () => {
                        const m = inst[methodHint];
                        if (typeof m === 'function') return m.call(inst, ev);
                        return handler.call(inst, ev);
                    });
                    return;
                }
                runDomEventHandler(inst, methodHint, () => handler.call(inst, ev));
            };
            bag[type] = listener;
            directApi._eachCtx.needDelegate(type);
            el.addEventListener(type, listener);
            return;
        }
        // Infer once at bind time ??never Function#toString on the click hot path.
        const methodHint = typeof handler === 'function' ? inferHandlerMethod(handler) : null;
        if (methodHint && methodAllowsSyncEventFlush(inst, methodHint)) {
            // Direct method bind: skip arrow wrapper + nested handler.call.
            el.addEventListener(type, (ev) => {
                if (type === 'submit' && ev && typeof ev.preventDefault === 'function') {
                    ev.preventDefault();
                }
                runDomEventHandler(inst, methodHint, () => {
                    const m = inst[methodHint];
                    if (typeof m === 'function') return m.call(inst, ev);
                    return handler.call(inst, ev);
                });
            });
            return;
        }
        el.addEventListener(type, (ev) => {
            // Belt-and-suspenders: form submit must not navigate before handler runs.
            if (type === 'submit' && ev && typeof ev.preventDefault === 'function') {
                ev.preventDefault();
            }
            if (typeof handler === 'function') {
                runDomEventHandler(inst, methodHint, () => handler.call(inst, ev));
            }
        });
    },
    /**
     * Bind a named instance method (no arrow / Function#toString).
     * Learns `skipFlush` after a sync invocation that schedules no dirty work
     * (stride / transpose self-apply DOM).
     */
    onMethod(el, type, methodName, opts) {
        // Prefer each-block owner: item create often runs during flush when `_inst` is unset.
        const eachOwner = directApi._eachCtx && directApi._eachCtx.inst;
        const inst = eachOwner || directApi._inst;
        if (!inst) return;
        let skipFlush = !!(opts && opts.skipFlush);
        const invoke = (ev) => {
            if (type === 'submit' && ev && typeof ev.preventDefault === 'function') {
                ev.preventDefault();
            }
            const m = inst[methodName];
            if (typeof m !== 'function') return;
            if (skipFlush) {
                m.call(inst, ev);
                return;
            }
            beginEventFlush(inst);
            try {
                m.call(inst, ev);
            } finally {
                const scheduled = !!inst.__vmzFlushScheduled;
                endEventFlush(inst);
                // Barrier-owned methods (stride/transpose) never schedule ??skip frame next time.
                if (!scheduled && methodAllowsSyncEventFlush(inst, methodName)) {
                    skipFlush = true;
                }
            }
        };
        if (directApi._eachCtx) {
            const bag = el.__vmzEvt || (el.__vmzEvt = Object.create(null));
            const listener = (ev: Event) => invoke(ev);
            bag[type] = listener;
            directApi._eachCtx.needDelegate(type);
            el.addEventListener(type, listener);
            return;
        }
        el.addEventListener(type, (ev) => invoke(ev));
    },
    /**
     * Specialized single-field attr bind (0.1.29): compile-time field name, no generic get closure in artifact.
     */
    specFieldAttr(inst, bindingId, fieldName, el, name) {
        directApi.trackPatch(
            inst,
            [fieldName],
            function specFieldAttrPatch() {
                const raw = this[fieldName];
                if (name === 'class' || name === 'className') {
                    const s = String(raw ?? '');
                    if (s) el.setAttribute('class', s);
                    else if (el.hasAttribute('class')) el.removeAttribute('class');
                } else {
                    applyDomAttr(el, name, raw);
                }
            },
            bindingId,
        );
    },
    /**
     * Specialized single-field text bind (0.1.29): compile-time field name in generated artifact.
     */
    specFieldText(inst, bindingId, fieldName, textNode) {
        directApi.trackPatch(
            inst,
            [fieldName],
            function specFieldTextPatch() {
                textNode.textContent = String(this[fieldName] ?? '');
            },
            bindingId,
        );
    },
    setHtml(el, value) {
        el.innerHTML = value == null ? '' : String(value);
    },
    bindHtml(inst, bindingId, deps, get, el) {
        directApi.trackPatch(
            inst,
            deps || [],
            function bindHtmlPatch() {
                let raw;
                try {
                    raw = get.call(inst);
                } catch {
                    raw = '';
                }
                el.innerHTML = raw == null ? '' : String(raw);
            },
            bindingId,
        );
    },
    /**
     * Nested component (sync Direct child or island schedule).
     */
    component(hostInst, nameOrCtor, props, client) {
        const name = typeof nameOrCtor === 'function' ? nameOrCtor.__vmzTag || nameOrCtor.name || 'Component' : nameOrCtor;

        let host = null;
        if (directApi._resumeAdopt && typeof directApi._resumeAdopt.componentHost === 'function') {
            host = directApi._resumeAdopt.componentHost(name);
        }
        if (!host) {
            noteDomCreate();
            host = document.createElement('div');
            host.setAttribute('data-vmz', name);
        }

        const resolved = {};
        for (const [k, v] of Object.entries(props || {})) {
            // Function props that already look like `onXxx` stay as handlers.
            // Component `@event` never arrives here (emit uses onComponentEvent).
            const onKey = typeof v === 'function' ? eventPropHandlerName(k) : null;
            if (onKey) resolved[onKey] = v;
            else if (typeof v === 'function') resolved[k] = v.call(hostInst);
            else resolved[k] = v;
        }
        if (client) {
            host.setAttribute('data-vmz-island', name);
            host.setAttribute('data-vmz-client', String(client));
            host.setAttribute('data-vmz-props', JSON.stringify(stripFns(resolved)));
            if (isEventEntryStrategy(String(client))) {
                host.setAttribute('data-vmz-entry', 'event');
            }
            // resume: resume on schedule; EventEntry may lazy-load chunk via __vmzLoadComponent.
            scheduleClientOn(host, String(client), async () => {
                const Ctor = typeof nameOrCtor === 'function' ? nameOrCtor : await resolveComponent(name);
                if (!Ctor) {
                    // Replace placeholder island with leaf error node (do not throw page).
                    const err = createUnknownComponentElement(name, 'island');
                    host.replaceWith(err);
                    return;
                }
                const { resume } = await import('../ssr/dom-ssr.js');
                await resume(Ctor, host, { props: resolved, state: {} });
            });
            return host;
        }
        // Static Ctor import path: use Function directly (no registry lookup).
        const Ctor = typeof nameOrCtor === 'function' ? nameOrCtor : components[name];
        if (!Ctor) {
            return createUnknownComponentElement(name, 'client');
        }
        // Inline chips ??`display: contents` (`ui-direct-host-box`). Block surfaces
        // keep a real box (DataTable select timed out when defaulting everything).
        applyDirectHostBox(host, name, Ctor);
        const child = createInstance(Ctor, resolved);
        if (!(Ctor.__vmzDirect && typeof Ctor.__vmzCreate === 'function')) {
            throw new Error(`vmz:dom direct component <${name}> requires __vmzCreate (rebuild child with Direct)`);
        }
        // Nested resume: keep parent `_resumeAdopt` so child reclaim parked SSR nodes.
        // Enter the host's private child pool so nested create cannot see uncle siblings.
        const adopt = directApi._resumeAdopt;
        const entered = adopt && typeof adopt.enter === 'function' ? adopt.enter(host) : false;
        let node;
        try {
            node = runDirectCreate(Ctor, child);
        } finally {
            if (entered && adopt && typeof adopt.leave === 'function') adopt.leave();
        }
        if (node) {
            // ifBlock/eachBlock roots are DocumentFragments: appendChild moves
            // children into `host` and empties the fragment. Keep a live Element
            // root so projectDefaultSlot can find `<slot>` (Button v-if/v-else).
            child.__vmzDomRoot = node.nodeType === 11 ? host : node;
            host.appendChild(node);
        }
        host.__vmzInst = child;
        if (typeof child.onMount === 'function') {
            const pending = Promise.resolve().then(() => {
                if (!child.__vmzDestroyed) return child.onMount();
            });
            const bag = hostInst.__vmzPendingChildMounts || (hostInst.__vmzPendingChildMounts = []);
            bag.push(pending);
        }
        return host;
    },
    /**
     * Subscribe to a child component event (`@submit` ??event name `submit`).
     * Orthogonal to function props (`:on-submit` ??prop `onSubmit`).
     */
    onComponentEvent(hostEl, eventName, handler) {
        const child = hostEl && hostEl.__vmzInst;
        if (!child || typeof eventName !== 'string' || !eventName) return;
        if (typeof handler !== 'function') return;
        const bag = child.__vmzComponentListeners || (child.__vmzComponentListeners = Object.create(null));
        const list = bag[eventName] || (bag[eventName] = []);
        list.push(handler);
    },
    /**
     * Keep nested Direct child props live with parent field writes.
     */
    bindComponentProp(hostInst, hostEl, propName, deps, get) {
        if (hostEl && hostEl.__vmzPropBindSeq == null) {
            hostEl.__vmzPropBindSeq = ++directPropBindSeq;
        }
        const seq = hostEl && hostEl.__vmzPropBindSeq != null ? hostEl.__vmzPropBindSeq : ++directPropBindSeq;
        const bindingId = `pc:${seq}:${propName}`;
        directApi.trackPatch(
            hostInst,
            deps || [],
            function bindComponentPropPatch() {
                let raw;
                try {
                    raw = get.call(hostInst);
                } catch {
                    raw = null;
                }
                const child = hostEl && hostEl.__vmzInst;
                if (!child || child.__vmzDestroyed) return;
                if (typeof propName !== 'string' || !propName || propName.startsWith('#')) return;
                child[propName] = raw;
                if (typeof child.__vmzOnParentProp === 'function') {
                    try {
                        child.__vmzOnParentProp(propName, raw);
                    } catch (err) {
                        console.error('vmz:dom __vmzOnParentProp', err);
                    }
                }
                scheduleRefresh(child, { type: 'replace', root: propName });
            },
            bindingId,
        );
    },
    /**
     * Project parent children into nested Direct component default `<slot>`.
     * Uses {@link findOwnedDefaultSlot} so nested Button/Link slots are not stolen.
     */
    projectDefaultSlot(hostEl, node) {
        if (!hostEl || node == null) return;
        const child = hostEl.__vmzInst;
        let root = (child && child.__vmzDomRoot) || hostEl;
        // Emptied DocumentFragment after append must not receive slot kids.
        if (!root || root.nodeType !== 1) root = hostEl;

        let slot = null;
        if (root && root.nodeType === 1) {
            slot = findOwnedDefaultSlot(root);
        }
        if (slot && slot.parentNode) {
            slot.replaceWith(node);
            return;
        }
        if (root && root.nodeType === 1 && typeof root.appendChild === 'function') root.appendChild(node);
        else hostEl.appendChild(node);
    },
};

/**
 * Function prop wire: only `onXxx` camelCase is a handler prop.
 * Component `@event` must never normalize here ??that channel is `onComponentEvent`.
 */
export function eventPropHandlerName(name) {
    if (typeof name !== 'string' || !name) return null;
    if (/^on[A-Z]/.test(name)) return name;
    return null;
}

/**
 * Dispatch a component event to parent subscribers registered via `onComponentEvent`.
 * Installed on every Direct instance as `inst.emit`.
 */
export function emitComponentEvent(inst, eventName, ...payload) {
    if (!inst || typeof eventName !== 'string' || !eventName) return;
    const bag = inst.__vmzComponentListeners;
    const list = bag && bag[eventName];
    if (!Array.isArray(list) || list.length === 0) return;
    for (const fn of list) {
        if (typeof fn === 'function') fn(...payload);
    }
}

export function isEventPropName(name) {
    return eventPropHandlerName(name) != null;
}

let directPropBindSeq = 0;

export const BOOLEAN_HTML_ATTRS = new Set([
    'disabled',
    'checked',
    'selected',
    'readonly',
    'required',
    'multiple',
    'hidden',
    'autofocus',
    'autoplay',
    'controls',
    'loop',
    'muted',
    'open',
    'novalidate',
    'formnovalidate',
    'defer',
    'async',
    'ismap',
    'default',
    'inert',
]);

export function applyDomAttr(el, name, value) {
    const key = name === 'className' ? 'class' : name;
    if (BOOLEAN_HTML_ATTRS.has(String(key).toLowerCase())) {
        if (value === false || value == null || value === '') {
            el.removeAttribute(key);
        } else {
            el.setAttribute(key, value === true ? '' : String(value));
        }
        return;
    }
    // <textarea value="??> as an attribute does not update visible text; INPUT/SELECT
    // also need the IDL `.value` property so controlled updates stay in sync after switches.
    // linkedom `<select>.value` is getter-only ??sync via `option.selected` instead of throwing.
    if (key === 'value' && el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.tagName === 'SELECT')) {
        const next = value == null || value === false ? '' : String(value);
        if (el.tagName === 'SELECT') {
            const opts = el.options || el.querySelectorAll?.('option') || [];
            for (const opt of opts) {
                opt.selected = String(opt.value ?? '') === next;
            }
        } else if (el.value !== next) {
            el.value = next;
        }
        if (value == null || value === false) el.removeAttribute('value');
        else el.setAttribute('value', next);
        return;
    }
    if (value == null || value === false) el.removeAttribute(key);
    else el.setAttribute(key, value === true ? '' : String(value));
}

export function stripFns(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj || {})) {
        if (typeof v === 'function') continue;
        out[k] = v;
    }
    return out;
}

/**
 * Marker range host for Direct keyed-each IIFE (insert before end comment).
 */
function eachHostApi(start, end) {
    return {
        insert(dom) {
            if (dom.parentNode) noteDomMove();
            end.parentNode.insertBefore(dom, end);
        },
        childrenBetween() {
            const out = [];
            let n = start.nextSibling;
            while (n && n !== end) {
                if (n.nodeType === 1) out.push(n);
                n = n.nextSibling;
            }
            return out;
        },
    };
}

/**
 * Snapshot plain state/prop field values for Island HMR (session).
 */
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

/**
 * Tear down binders and stop patches. Safe to call more than once.
 * Field writes after destroy no longer update DOM (values may still change).
 *: also dispose owned DOM trees (child __vmzInst / region __vmzDispose).
 */
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
 *: walk a DOM subtree and run lifetime dispose hooks + nested instance destroy.
 * Does not mark the *calling* parent destroyed; safe from destroy(inst).
 */
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
        let child = node.firstChild;
        while (child) {
            const next = child.nextSibling;
            visit(child);
            child = next;
        }
    };
    visit(root);
}

export function scheduleClient(strategy, fn) {
    scheduleClientOn(null, strategy, fn);
}

export function isEventEntryStrategy(strategy) {
    const s = String(strategy || '');
    return s === 'event' || s.startsWith('event:') || s === 'click';
}

function eventEntryType(strategy) {
    const s = String(strategy || 'event');
    if (s.startsWith('event:')) return s.slice(6) || 'click';
    if (s === 'click') return 'click';
    return 'click';
}

export function scheduleClientOn(el, strategy, fn) {
    const run = () => {
        Promise.resolve(fn()).catch((err) => console.error('vmz:dom island', err));
    };
    if (isEventEntryStrategy(strategy)) {
        if (!el || typeof el.addEventListener !== 'function') {
            run();
            return;
        }
        const type = eventEntryType(strategy);
        const once = () => {
            el.removeEventListener(type, once);
            run();
        };
        el.addEventListener(type, once);
        return;
    }
    if (strategy === 'idle') {
        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(() => run(), { timeout: 2000 });
        } else {
            setTimeout(run, 1);
        }
        return;
    }
    if (strategy === 'visible' && el && typeof IntersectionObserver === 'function') {
        const io = new IntersectionObserver((entries) => {
            if (entries.some((e) => e.isIntersecting)) {
                io.disconnect();
                run();
            }
        });
        io.observe(el);
        return;
    }
    run();
}

/**
 * AsyncTask cancel protocol (first slice): keyed generation + AbortSignal.
 * Superseded runs and `destroy(inst)` abort prior work; stale results must not apply.
 */
export function __vmzRunTask(inst, key, fn) {
    if (!inst) throw new Error('vmz:dom __vmzRunTask requires inst');
    const k = String(key || 'default');
    if (!inst.__vmzTasks) inst.__vmzTasks = Object.create(null);
    const prev = inst.__vmzTasks[k];
    if (prev) {
        prev.generation += 1;
        try {
            prev.controller.abort();
        } catch {
            /* ignore */
        }
        prev.status = 'cancelled';
    }
    const controller =
        typeof AbortController !== 'undefined'
            ? new AbortController()
            : {
                  signal: { aborted: false },
                  abort() {
                      this.signal.aborted = true;
                  },
              };
    const generation = (prev?.generation || 0) + 1;

    const entry = {
        generation,
        controller,
        status: 'pending',
        result: undefined as any,
        error: undefined as any,
        promise: undefined as any,
    };
    inst.__vmzTasks[k] = entry;

    // Invoke synchronously so event handlers can call preventDefault before
    // the browser continues the default action (form submit ??native navigation).
    // Async work still continues via the returned Promise.
    let syncResult;
    let syncErr;
    let threw = false;
    try {
        syncResult = fn(controller.signal, { generation });
    } catch (err) {
        threw = true;
        syncErr = err;
    }

    const settleOk = (result) => {
        if (inst.__vmzDestroyed || controller.signal.aborted || inst.__vmzTasks[k] !== entry) {
            entry.status = 'cancelled';
            return undefined;
        }
        entry.status = 'success';
        entry.result = result;
        return result;
    };
    const settleErr = (err) => {
        if (inst.__vmzDestroyed || controller.signal.aborted || inst.__vmzTasks[k] !== entry) {
            entry.status = 'cancelled';
            return undefined;
        }
        entry.status = 'error';
        entry.error = err;
        throw err;
    };

    if (threw) {
        const promise = Promise.resolve().then(() => settleErr(syncErr));
        entry.promise = promise;
        return promise;
    }

    const promise = Promise.resolve(syncResult).then(settleOk, settleErr);
    entry.promise = promise;
    return promise;
}

export function __vmzCancelTasks(inst) {
    const tasks = inst?.__vmzTasks;
    if (!tasks) return;
    for (const key of Object.keys(tasks)) {
        const t = tasks[key];
        t.generation += 1;
        try {
            t.controller.abort();
        } catch {
            /* ignore */
        }
        t.status = 'cancelled';
    }
}

export function __vmzTaskStatus(inst, key) {
    const t = inst?.__vmzTasks?.[String(key || 'default')];
    return t ? t.status : null;
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

const wbSharedOwners = new WeakMap();

const wbAllowShared = new WeakSet();

const wbCrossComponentDiags = [];

/**
 * Mark a plain object as intentionally shared across ownership boundaries.
 */
export function __vmzAllowShared(value) {
    if (value != null && typeof value === 'object') wbAllowShared.add(value);
    return value;
}

/**
 * Take exclusive ownership intent: clear multi-owner registry for this object.
 * Subsequent field assigns re-register from the assigning instance only.
 */
export function __vmzTakeShared(value) {
    if (value != null && typeof value === 'object') {
        wbSharedOwners.delete(value);
        wbAllowShared.delete(value);
    }
    return value;
}

export function __vmzSharedCrossComponentDiagnostics() {
    return wbCrossComponentDiags.slice();
}

export function __vmzSharedCrossComponentDiagnosticsReset() {
    wbCrossComponentDiags.length = 0;
}

function registerWbOwner(value, report, baseSegs = [], inst = null) {
    if (value == null || typeof value !== 'object') return;
    let entry = wbSharedOwners.get(value);
    if (!entry) {
        entry = { owners: [] };
        wbSharedOwners.set(value, entry);
    }
    if (entry.owners.some((o) => o.report === report && sameSegs(o.baseSegs, baseSegs))) {
        return;
    }
    entry.owners.push({ report, baseSegs: baseSegs.slice(), inst });
    // Cross-component share without explicit allow ??diagnose (13 ).
    if (!wbAllowShared.has(value) && inst) {
        const other = entry.owners.find((o) => o.inst && o.inst !== inst);
        if (other) {
            const msg = 'vmz: shared plain object written from multiple components without allowShared';
            if (!wbCrossComponentDiags.some((d) => d.message === msg)) {
                wbCrossComponentDiags.push({ kind: 'shared_cross_component', message: msg });
            }
        }
    }
}

/**
 * Notify all registered owners of a shared plain object after a barrier write.
 */
function notifyWbShared(rootObj, localSegs) {
    const entry = rootObj && typeof rootObj === 'object' ? wbSharedOwners.get(rootObj) : null;
    if (!entry || !entry.owners.length) return false;
    for (const o of entry.owners) {
        if (localSegs == null) {
            o.report(o.baseSegs.length ? o.baseSegs.slice() : null);
        } else {
            o.report([...o.baseSegs, ...localSegs]);
        }
    }
    return true;
}

/**
 * Read a nested path under a field root (for compound / update expansion).
 */
export function __vmzReadPath(inst, root, segs) {
    if (!inst || !root) return undefined;
    let obj = inst[root];
    if (!Array.isArray(segs) || segs.length === 0) return obj;
    for (let i = 0; i < segs.length; i++) {
        if (obj == null || typeof obj !== 'object') return undefined;
        obj = obj[segs[i]];
    }
    return obj;
}

/**
 * Short-circuit logical path assign (`||=` / `&&=` / `??=`).
 */
export function __vmzWritePathLogical(inst, root, segs, kind, rhs) {
    const cur = __vmzReadPath(inst, root, segs);
    if (kind === '||') {
        if (cur) return cur;
    } else if (kind === '&&') {
        if (!cur) return cur;
    } else if (kind === '??') {
        if (cur != null) return cur;
    } else {
        return cur;
    }
    return __vmzWritePath(inst, root, segs, rhs);
}

/**
 * Mutates a plain owned object/array and schedules the same path notice Proxy would.
 *
 * Root-array index assigns (`tags[0] = x`) notify as field replace (structural),
 * matching the transitional Proxy wrapArray behavior.
 * Shared multi-owner: writing through one field notifies all owners of the same raw object.
 *
 */
/**
 * Apply a binary compound/update op without a separate ReadPath call.
 */
function applyCompoundOp(op, cur, rhs) {
    switch (op) {
        case '+':
            return cur + rhs;
        case '-':
            return cur - rhs;
        case '*':
            return cur * rhs;
        case '/':
            return cur / rhs;
        case '%':
            return cur % rhs;
        case '**':
            return cur ** rhs;
        case '<<':
            return cur << rhs;
        case '>>':
            return cur >> rhs;
        case '>>>':
            return cur >>> rhs;
        case '|':
            return cur | rhs;
        case '^':
            return cur ^ rhs;
        case '&':
            return cur & rhs;
        default:
            return cur;
    }
}

/**
 * Schedule leaf refresh after an array-item field mutate (event leaf-batch or trie).
 */
function notifyArrayItemLeaf(inst, root, idx, leaf) {
    if (typeof inst.__vmzDrainLeafDirty === 'function' && ((inst.__vmzEventDepth || 0) > 0 || inst.__vmzFlushSync)) {
        const i = +idx;
        const ld = inst.__vmzLeafDirty;
        if (!ld) {
            inst.__vmzLeafDirty = { root, field: leaf, idxs: [i] };
        } else if (ld.root === root && ld.field === leaf) {
            ld.idxs.push(i);
        } else {
            promoteLeafDirtyToTrie(inst);
            scheduleRefresh(inst, { type: 'path', root, segs: [String(idx), leaf] });
            return;
        }
        inst.__vmzFlushScheduled = true;
        return;
    }
    scheduleRefresh(inst, { type: 'path', root, segs: [String(idx), leaf] });
}

export function __vmzWritePath(inst, root, segs, value) {
    if (!inst || inst.__vmzDestroyed) return value;
    if (!root || !Array.isArray(segs) || segs.length === 0) return value;

    // Hot path: array item field write (`rows[i].label`) ??no map/slice, no shared-owner walk.
    if (segs.length === 2) {
        return __vmzWritePathItem(inst, root, segs[0], segs[1], value);
    }

    const normSegs = segs.map((s) => String(s));
    let obj = inst[root];
    if (obj == null || typeof obj !== 'object') return value;
    for (let i = 0; i < normSegs.length - 1; i++) {
        obj = obj[normSegs[i]];
        if (obj == null || typeof obj !== 'object') return value;
    }
    const leaf = normSegs[normSegs.length - 1];
    if (Object.is(obj[leaf], value)) return value;
    obj[leaf] = value;
    // Register newly assigned nested objects under this field for future shared writes.
    if (value != null && typeof value === 'object') {
        const report = (local) => {
            if (!local || local.length === 0) {
                scheduleRefresh(inst, { type: 'replace', root });
            } else {
                scheduleRefresh(inst, { type: 'path', root, segs: local });
            }
        };
        registerWbOwner(value, report, normSegs.slice(), inst);
    }
    const rootObj = inst[root];
    const rootArr = rootObj;
    const isRootIndex = normSegs.length === 1 && Array.isArray(rootArr) && leaf !== 'length' && String(Number(leaf)) === leaf;
    if (isRootIndex) {
        if (!notifyWbShared(rootObj, null)) {
            scheduleRefresh(inst, { type: 'replace', root });
        }
    } else if (!notifyWbShared(rootObj, normSegs)) {
        scheduleRefresh(inst, { type: 'path', root, segs: normSegs });
    }
    return value;
}

/**
 * Array-item leaf write without segs array alloc (`rows[i].label = v`).
 */
export function __vmzWritePathItem(inst, root, idx, leaf, value) {
    if (!inst || inst.__vmzDestroyed) return value;
    if (!root || leaf == null) return value;
    const arr = inst[root];
    if (!Array.isArray(arr)) return value;
    const item = arr[idx];
    if (item == null || typeof item !== 'object') return value;
    if (Object.is(item[leaf], value)) return value;
    item[leaf] = value;
    if (tryInlineLeafApply(inst, root, idx, leaf, item)) return value;
    notifyArrayItemLeaf(inst, root, idx, leaf);
    return value;
}

/**
 * In-place two-index swap on an owned list field (WriteBarrier Slice 5).
 * Prefers eachBlock O(1) DOM transpose hook; otherwise schedules a list replace.
 */
export function __vmzListTranspose(inst, root, ia, ib) {
    if (!inst || inst.__vmzDestroyed || !root) return;
    const arr = inst[root];
    if (!Array.isArray(arr)) return;
    const a = +ia;
    const b = +ib;
    if (a === b || a < 0 || b < 0 || a >= arr.length || b >= arr.length) return;
    const tmp = arr[a];
    arr[a] = arr[b];
    arr[b] = tmp;
    const hook = inst.__vmzEachTranspose && inst.__vmzEachTranspose[root];
    if (typeof hook === 'function' && hook(a, b) === true) return;
    scheduleRefresh(inst, { type: 'replace', root });
}

/**
 * Compound leaf write (`rows[i].label += x`) ??one item touch, no separate ReadPath.
 */
export function __vmzWritePathCompound(inst, root, segs, op, rhs) {
    if (!inst || inst.__vmzDestroyed) return undefined;
    if (!root || !Array.isArray(segs) || segs.length === 0) return undefined;

    if (segs.length === 2) {
        return __vmzWritePathCompoundItem(inst, root, segs[0], segs[1], op, rhs);
    }

    const cur = __vmzReadPath(inst, root, segs);
    const value = applyCompoundOp(op, cur, rhs);
    return __vmzWritePath(inst, root, segs, value);
}

/**
 * Array-item compound without segs array alloc (`rows[i].label += x`).
 */
export function __vmzWritePathCompoundItem(inst, root, idx, leaf, op, rhs) {
    if (!inst || inst.__vmzDestroyed) return undefined;
    if (!root || leaf == null) return undefined;
    const arr = inst[root];
    if (!Array.isArray(arr)) return undefined;
    const item = arr[idx];
    if (item == null || typeof item !== 'object') return undefined;
    const cur = item[leaf];
    const value = applyCompoundOp(op, cur, rhs);
    if (Object.is(cur, value)) return value;
    item[leaf] = value;
    if (tryInlineLeafApply(inst, root, idx, leaf, item)) return value;
    notifyArrayItemLeaf(inst, root, idx, leaf);
    return value;
}

/**
 * Stride compound over an owned array (`for (i=start; i<n; i+=step) arr[i].leaf op= rhs`).
 * Mutates + applies DOM in one pass when eachBlock leaf hook is installed (update-every-Nth).
 */
export function __vmzArrayItemCompoundStride(inst, root, leaf, op, rhs, start, step) {
    if (!inst || inst.__vmzDestroyed || !root || leaf == null) return;
    // Prefer eachBlock-owned loop (hoisted applyByField, no per-index hook lookup).
    const owned = inst.__vmzEachCompoundStride && inst.__vmzEachCompoundStride[root];
    if (typeof owned === 'function' && owned(leaf, op, rhs, start, step) === true) return;

    const arr = inst[root];
    if (!Array.isArray(arr)) return;
    const s = +start || 0;
    const st = +step || 0;
    if (st <= 0) return;
    const n = arr.length;
    const canInline =
        typeof inst.__vmzEachApplyLeaf === 'object' &&
        typeof inst.__vmzEachApplyLeaf[root] === 'function' &&
        ((inst.__vmzEventDepth || 0) > 0 || inst.__vmzFlushSync);
    const applyLeaf = canInline ? inst.__vmzEachApplyLeaf[root] : null;

    // Hot path: string `+=` with inline DOM ??no switch / Object.is / idxs.
    if (op === '+' && applyLeaf) {
        for (let i = s; i < n; i += st) {
            const item = arr[i];
            if (item == null || typeof item !== 'object') continue;
            item[leaf] = item[leaf] + rhs;
            applyLeaf(i, leaf, item);
        }
        return;
    }

    const idxs = [];
    for (let i = s; i < n; i += st) {
        const item = arr[i];
        if (item == null || typeof item !== 'object') continue;
        const cur = item[leaf];
        const value = applyCompoundOp(op, cur, rhs);
        if (Object.is(cur, value)) continue;
        item[leaf] = value;
        if (applyLeaf && applyLeaf(i, leaf, item) === true) continue;
        idxs.push(i);
    }
    if (!idxs.length) return;
    if (typeof inst.__vmzDrainLeafDirty === 'function' && ((inst.__vmzEventDepth || 0) > 0 || inst.__vmzFlushSync)) {
        inst.__vmzLeafDirty = { root, field: leaf, idxs };
        inst.__vmzFlushScheduled = true;
        return;
    }
    for (let k = 0; k < idxs.length; k++) {
        notifyArrayItemLeaf(inst, root, idxs[k], leaf);
    }
}

/**
 * Apply a list-item leaf via eachBlock rowKernel hook when installed.
 */
function tryInlineLeafApply(inst, root, idx, leaf, item) {
    const hook = inst.__vmzEachApplyLeaf && inst.__vmzEachApplyLeaf[root];
    if (typeof hook !== 'function') return false;
    return hook(+idx, leaf, item) === true;
}

/**
 * Compiler-inserted array mutator barrier (push/pop/splice/??.
 * Applies the mutator on the plain array and schedules a structural notice
 * at `root` + `baseSegs` (empty baseSegs ??field replace).
 *
 */
export function __vmzArrayMutate(inst, root, baseSegs, method, args) {
    if (!inst || inst.__vmzDestroyed) return undefined;
    if (!root || typeof method !== 'string') return undefined;
    const segs = Array.isArray(baseSegs) ? baseSegs.map((s) => String(s)) : [];
    let arr = inst[root];
    if (arr == null || typeof arr !== 'object') return undefined;
    for (let i = 0; i < segs.length; i++) {
        arr = arr[segs[i]];
        if (arr == null || typeof arr !== 'object') return undefined;
    }
    if (!Array.isArray(arr) || typeof arr[method] !== 'function') return undefined;
    const list = Array.isArray(args) ? args : [];
    const ret = arr[method](...list);
    const rootObj = inst[root];
    if (segs.length === 0) {
        if (!notifyWbShared(rootObj, null)) {
            scheduleRefresh(inst, { type: 'replace', root });
        }
    } else if (!notifyWbShared(rootObj, segs)) {
        scheduleRefresh(inst, { type: 'path', root, segs: segs.slice() });
    }
    return ret;
}

function makeReactive(inst, stateKeys) {
    const barrier = !!inst.constructor.__vmzWriteBarrier;
    for (const key of stateKeys) {
        if (!key || key.startsWith('#')) continue;
        const desc = Object.getOwnPropertyDescriptor(inst, key);
        if (desc && desc.set && desc.get && !desc.writable) continue;

        const report = (segs) => {
            if (!segs || segs.length === 0) {
                scheduleRefresh(inst, { type: 'replace', root: key });
            } else {
                scheduleRefresh(inst, { type: 'path', root: key, segs });
            }
        };
        // WriteBarrier components keep plain objects ??nested writes go through __vmzWritePath.
        let value = barrier ? inst[key] : wrapReactive(inst[key], report, []);
        if (barrier) registerWbOwner(value, report, [], inst);
        Object.defineProperty(inst, key, {
            configurable: true,
            enumerable: true,
            get() {
                return value;
            },
            set(next) {
                const wrapped = barrier ? next : wrapReactive(next, report, []);
                if (Object.is(value, wrapped)) return;
                value = wrapped;
                if (barrier) registerWbOwner(value, report, [], inst);
                report(null);
            },
        });
    }
}

const reactiveProxies = new WeakMap();

const writeBarrierOwned = new WeakSet();

/**
 * WriteBarrier: true when value is an owned plain object with path barriers (no Proxy).
 */
export function __vmzIsWriteBarrierOwned(value) {
    return writeBarrierOwned.has(value);
}

/**
 * True when value is the Proxy wrapper from array (or residual) reactive wrap.
 */
export function __vmzIsReactiveProxy(value) {
    const e = reactiveProxies.get(value);
    return !!(e && e.kind === 'proxy' && e.proxy === value);
}

const ARRAY_MUTATORS = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin']);

function sameSegs(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

function addOwner(entry, report, baseSegs) {
    if (entry.owners.some((o) => o.report === report && sameSegs(o.baseSegs, baseSegs))) {
        return;
    }
    entry.owners.push({
        report,
        baseSegs: baseSegs.slice(),
    });
}

function notifyOwners(owners, localSegs) {
    for (const o of owners) {
        if (localSegs == null) {
            o.report(o.baseSegs.length ? o.baseSegs.slice() : null);
        } else {
            o.report([...o.baseSegs, ...localSegs]);
        }
    }
}

/**
 * Field-owned write traps for plain objects / arrays on state fields.
 * Plain objects: WriteBarrier via defineProperty (no Proxy).
 * Arrays: transitional Proxy tracks list identity/mutators only; elements stay plain
 * (no per-item wrap on large assign ??nested notifies via `__vmzWritePath`).
 * Shared raw objects notify **all** current owners.
 *
 */
function wrapReactive(value, report, pathSegs = []) {
    if (value == null || typeof value !== 'object') return value;
    const existing = reactiveProxies.get(value);
    if (existing) {
        addOwner(existing, report, pathSegs);
        return existing.proxy;
    }
    if (Array.isArray(value)) return wrapArray(value, report, pathSegs);
    if (isPlainObject(value)) return wrapOwnedObject(value, report, pathSegs);
    return value;
}

function isPlainObject(value) {
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

/**
 * Path-level write barrier for owned plain objects (no Proxy).
 */
function wrapOwnedObject(obj, report, pathSegs) {
    const existing = reactiveProxies.get(obj);
    if (existing) {
        addOwner(existing, report, pathSegs);
        return existing.proxy;
    }

    const entry = {
        proxy: obj,
        owners: [],
        kind: 'barrier',
    };
    addOwner(entry, report, pathSegs);
    writeBarrierOwned.add(obj);
    reactiveProxies.set(obj, entry);

    for (const prop of Object.keys(obj)) {
        installOwnedProp(obj, prop, entry);
    }
    return obj;
}

function installOwnedProp(obj, prop, entry) {
    const desc = Object.getOwnPropertyDescriptor(obj, prop);
    if (!desc || !desc.configurable) return;
    if (desc.get || desc.set) return;

    let current = obj[prop];
    for (const o of entry.owners) {
        current = wrapReactive(current, o.report, [...o.baseSegs, prop]);
    }

    Object.defineProperty(obj, prop, {
        configurable: true,
        enumerable: desc.enumerable !== false,
        get() {
            return current;
        },
        set(next) {
            const local = [prop];
            let wrapped = next;
            for (const o of entry.owners) {
                wrapped = wrapReactive(next, o.report, [...o.baseSegs, ...local]);
            }
            if (Object.is(current, wrapped)) return;
            current = wrapped;
            notifyOwners(entry.owners, local);
        },
    });
}

/**
 * Transitional array Proxy: track list identity / mutators only.
 * Elements stay plain ??no per-item defineProperty on `this.rows = largeArray`
 * (design: WriteBarrier / list replace must not wrap 1k items). Nested field
 * notifies go through `__vmzWritePath` or whole-array replace.
 */
function wrapArray(arr, report, pathSegs) {
    const existing = reactiveProxies.get(arr);
    if (existing) {
        addOwner(existing, report, pathSegs);
        return existing.proxy;
    }

    const entry = {
        proxy: null,
        owners: [],
        kind: 'proxy',
    };
    addOwner(entry, report, pathSegs);

    const isArrayIndex = (prop) => typeof prop === 'string' && prop !== 'length' && String(Number(prop)) === prop;

    const proxy = new Proxy(arr, {
        get(target, prop, receiver) {
            if (typeof prop === 'string' && ARRAY_MUTATORS.has(prop)) {
                const fn = target[prop];
                return (...args) => {
                    const ret = fn.apply(target, args);
                    notifyOwners(entry.owners, null);
                    return ret;
                };
            }
            // Indices / length / methods: return as-is (plain elements).
            return Reflect.get(target, prop, receiver);
        },
        set(target, prop, next, receiver) {
            const prev = target[prop];
            if (Object.is(prev, next)) return true;
            const ok = Reflect.set(target, prop, next, receiver);
            if (ok) {
                if (prop === 'length' || isArrayIndex(prop)) notifyOwners(entry.owners, null);
                else if (typeof prop === 'string') notifyOwners(entry.owners, [prop]);
                else notifyOwners(entry.owners, null);
            }
            return ok;
        },
        deleteProperty(target, prop) {
            if (!(prop in target)) return true;
            const ok = Reflect.deleteProperty(target, prop);
            if (ok) {
                notifyOwners(entry.owners, typeof prop === 'string' ? [prop] : null);
            }
            return ok;
        },
    });
    entry.proxy = proxy;
    reactiveProxies.set(arr, entry);
    reactiveProxies.set(proxy, entry);
    return proxy;
}

/**
 * Coalesce field/path patches in the same turn via a dirty path trie.
 * Still precise deps ??never a full-tree re-render. Flush runs as a microtask by default;
 * DOM event handlers drain synchronously via beginEventFlush/endEventFlush when methodRw
 * proves the handler is sync (`async: false`, `opaque: false`).
 * Call `await flushPending(inst)` (may return void or a Promise) for tests / immediate UI.
 *
 *
 * string form is transitional field-root alias for replace.
 */
function scheduleRefresh(inst, notice) {
    if (!inst || inst.__vmzDestroyed || inst.__vmzQuiet) return;
    const n = typeof notice === 'string' ? { type: 'replace', root: notice } : notice;
    if (!n || !n.root) return;
    if (precision.enabled) {
        precision.writes++;
        bumpMap(precision.writesByRoot, n.root);
    }
    pushTrace('write', 'field', n.root, n.root);
    if (!inst.__vmzDirtyTrie) inst.__vmzDirtyTrie = Object.create(null);
    insertDirtyNotice(inst.__vmzDirtyTrie, n);
    // Transitional: keep notice list for flush loop emptiness check / compat.
    if (!inst.__vmzDirtyNotices) inst.__vmzDirtyNotices = [];
    inst.__vmzDirtyNotices.push(n);
    // Inside a UI event (or its sync flush): coalesce; endEventFlush drains without microtask hop.
    if ((inst.__vmzEventDepth || 0) > 0 || inst.__vmzFlushSync) {
        inst.__vmzFlushScheduled = true;
        return;
    }
    if (inst.__vmzFlushScheduled) return;
    inst.__vmzFlushScheduled = true;
    queueMicrotask(() => {
        inst.__vmzFlushScheduled = false;
        const p = flushPending(inst);
        if (p && typeof p.then === 'function') {
            p.catch((err) => console.error('vmz:dom flush', err));
        }
    });
}

/**
 * Infer `this.<method>(...)` from a compiled click arrow / bag handler.
 */
function inferHandlerMethod(handler) {
    if (typeof handler !== 'function') return null;
    if (Object.hasOwn(handler, '__vmzMethod')) {
        return handler.__vmzMethod;
    }
    let name = null;
    try {
        const src = Function.prototype.toString.call(handler);
        const m = src.match(/this\.([A-Za-z_$][\w$]*)\s*\(/);
        name = m ? m[1] : null;
    } catch {
        name = null;
    }
    try {
        handler.__vmzMethod = name;
    } catch {
        /* non-extensible function */
    }
    return name;
}

/**
 * Sync event flush only when `__vmzMethodRw` proves the method is non-async / non-opaque.
 * Missing summary ??sync (Direct UI default). Async/opaque ??microtask coalesce.
 */
function methodAllowsSyncEventFlush(inst, methodName) {
    if (!inst) return false;
    if (!methodName) return true;
    const table = inst.constructor && inst.constructor.__vmzMethodRw;
    const rw = table && table[methodName];
    if (!rw) return true;
    if (rw.async || rw.opaque) return false;
    return true;
}

function runDomEventHandler(inst, methodHint, fn) {
    const sync = methodAllowsSyncEventFlush(inst, methodHint);
    if (sync) beginEventFlush(inst);
    try {
        return fn();
    } finally {
        if (sync) endEventFlush(inst);
    }
}

function beginEventFlush(inst) {
    if (!inst) return;
    inst.__vmzEventDepth = (inst.__vmzEventDepth || 0) + 1;
}

function endEventFlush(inst) {
    if (!inst) return;
    inst.__vmzEventDepth = Math.max(0, (inst.__vmzEventDepth || 0) - 1);
    if (inst.__vmzEventDepth !== 0 || !inst.__vmzFlushScheduled) return;
    // Keep __vmzFlushSync so nested writes during flush stay off the microtask path.
    inst.__vmzFlushSync = true;
    try {
        inst.__vmzFlushScheduled = false;
        const ret = flushPending(inst);
        if (ret && typeof ret.then === 'function') {
            ret.catch((err) => console.error('vmz:dom flush', err));
        }
    } finally {
        inst.__vmzFlushSync = false;
        // Async binder left dirties: fall back to microtask coalesce.
        if (inst.__vmzFlushScheduled) {
            const again = inst.__vmzFlushScheduled;
            inst.__vmzFlushScheduled = false;
            if (again) {
                inst.__vmzFlushScheduled = true;
                queueMicrotask(() => {
                    inst.__vmzFlushScheduled = false;
                    const p = flushPending(inst);
                    if (p && typeof p.then === 'function') {
                        p.catch((err) => console.error('vmz:dom flush', err));
                    }
                });
            }
        }
    }
}

/**
 * Promote an abandoned leaf batch into the dirty trie so mixed writes stay correct.
 */
function promoteLeafDirtyToTrie(inst) {
    const ld = inst.__vmzLeafDirty;
    if (!ld || !ld.idxs || !ld.idxs.length) {
        inst.__vmzLeafDirty = null;
        return;
    }
    inst.__vmzLeafDirty = null;
    if (!inst.__vmzDirtyTrie) inst.__vmzDirtyTrie = Object.create(null);
    if (!inst.__vmzDirtyNotices) inst.__vmzDirtyNotices = [];
    const field = ld.field;
    const root = ld.root;
    for (let k = 0; k < ld.idxs.length; k++) {
        const segs = [String(ld.idxs[k]), field];
        insertDirtyNotice(inst.__vmzDirtyTrie, { type: 'path', root, segs });
        inst.__vmzDirtyNotices.push({ type: 'path', root, segs });
    }
    inst.__vmzFlushScheduled = true;
}

function insertDirtyNotice(trie, notice) {
    if (notice.type === 'replace') {
        trie[notice.root] = { replace: true };
        return;
    }
    const segs = notice.segs || [];
    let node = trie[notice.root];
    if (node && node.replace) return;
    if (!node) {
        node = { children: Object.create(null) };
        trie[notice.root] = node;
    }
    if (!segs.length) {
        trie[notice.root] = { replace: true };
        return;
    }
    if (!node.children) node.children = Object.create(null);
    let cur = node;
    for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        if (cur.dirty) return; // ancestor already dirty
        if (!cur.children) cur.children = Object.create(null);
        if (i === segs.length - 1) {
            cur.children[seg] = { dirty: true };
            return;
        }
        let next = cur.children[seg];
        if (!next) {
            next = { children: Object.create(null) };
            cur.children[seg] = next;
        } else if (next.dirty) {
            return;
        } else if (!next.children) {
            next.children = Object.create(null);
        }
        cur = next;
    }
}

export function flushPending(inst) {
    if (!inst || inst.__vmzDestroyed) return undefined;
    inst.__vmzFlushScheduled = false;
    // rowKernel leaf batch (event update): apply before trie emptiness check.
    if (typeof inst.__vmzDrainLeafDirty === 'function') {
        try {
            inst.__vmzDrainLeafDirty();
        } catch (err) {
            console.error('vmz:dom leafDirty', err);
        }
    }
    let guard = 0;
    while (
        !inst.__vmzDestroyed &&
        (dirtyTrieHasEntries(inst.__vmzDirtyTrie) || (inst.__vmzDirtyNotices && inst.__vmzDirtyNotices.length > 0)) &&
        guard++ < 64
    ) {
        const trie = inst.__vmzDirtyTrie || Object.create(null);
        inst.__vmzDirtyTrie = Object.create(null);
        if (inst.__vmzDirtyNotices) inst.__vmzDirtyNotices.length = 0;
        inst.__vmzFlushTrie = trie;

        const jobs = [];
        // Prefer BindingId scheduling (IR). String `__vmzBinders` is adapter-only.
        // Pass `trie` into refresh ??dirty map is cleared above before patches run.
        try {
            const bindingIds = bindingIdsMatchingTrie(inst, trie);
            const coveredDeps = Object.create(null);
            for (const id of bindingIds) {
                const entry = inst.__vmzBindings && inst.__vmzBindings[id];
                if (entry) {
                    for (const d of entry.deps || []) coveredDeps[d] = true;
                }
                jobs.push(...refreshBinding(inst, id, trie));
            }
            for (const key of binderKeysMatchingTrie(inst, trie)) {
                if (coveredDeps[key] || (inst.__vmzDepToBindings && inst.__vmzDepToBindings[key]?.length)) {
                    // BindingId path already flushed IR patches for this dep.
                    // Still run binder-only patches (bindComponentProp uses bindingId null).
                    jobs.push(...refreshFieldBinderOnly(inst, key));
                    continue;
                }
                jobs.push(...refreshField(inst, key));
            }
            const pending = jobs.filter((j) => j && typeof j.then === 'function');
            if (pending.length) {
                // Async binders: resume after they settle (default microtask path after).
                return Promise.all(pending).then(() => flushPending(inst));
            }
        } finally {
            inst.__vmzFlushTrie = null;
        }
    }
    return undefined;
}

function dirtyTrieHasEntries(trie) {
    if (!trie) return false;
    for (const _ in trie) return true;
    return false;
}

function bindingIdsMatchingTrie(inst, trie) {
    const index = inst.__vmzDepToBindings;
    if (!index) return [];
    const out = [];
    const seen = Object.create(null);
    for (const key of Object.keys(index)) {
        if (!depMatchesTrie(trie, key)) continue;
        for (const id of index[key]) {
            const k = String(id);
            if (seen[k]) continue;
            seen[k] = true;
            out.push(id);
        }
    }
    return out;
}

function binderKeysMatchingTrie(inst, trie) {
    const binders = inst.__vmzBinders;
    if (!binders) return [];
    const out = [];
    for (const key of Object.keys(binders)) {
        if (depMatchesTrie(trie, key)) out.push(key);
    }
    return out;
}

function depMatchesTrie(trie, key) {
    const root = depRootField(key);
    const node = trie[root];
    if (!node) return false;
    if (node.replace) {
        return key === root || key === `${root}.*` || key.startsWith(`${root}.`) || key.startsWith(`${root}[`);
    }
    if (key === `${root}.*`) {
        // Bare `field.*` soft/structure channel: item replace / array structure only ??        // NOT deep leaf writes (`tags.0.label`); those use `tags.*.label` BindingId.
        return structureStarMatches(node);
    }
    // Bare field: replace-only.
    if (key === root) return false;

    // Path channel: `tags.*.label` ??wildcard index under list root.
    const starPrefix = `${root}.*`;
    if (key === starPrefix || key.startsWith(`${starPrefix}.`)) {
        const rest =
            key === starPrefix
                ? []
                : key
                      .slice(starPrefix.length + 1)
                      .split('.')
                      .filter(Boolean);
        return wildcardIndexDirtyCovers(node, rest);
    }

    // Stable ListItem form `tags[key=?].label` ??treat `[key=?]` as wildcard index.
    if (key.startsWith(`${root}[`)) {
        const afterBracket = key.indexOf(']');
        if (afterBracket > root.length) {
            const rest =
                key.length > afterBracket + 1 && key[afterBracket + 1] === '.'
                    ? key
                          .slice(afterBracket + 2)
                          .split('.')
                          .filter(Boolean)
                    : [];
            return wildcardIndexDirtyCovers(node, rest);
        }
    }

    const segs = key
        .slice(root.length + 1)
        .split('.')
        .filter(Boolean);
    return pathDirtyCovers(node, segs);
}

function structureStarMatches(node) {
    if (!node) return false;
    if (node.replace || node.dirty) return true;
    if (!node.children) return false;
    for (const idx of Object.keys(node.children)) {
        const child = node.children[idx];
        // Index node dirty/replace ??item identity changed.
        if (child && (child.replace || child.dirty)) return true;
    }
    return false;
}

function wildcardIndexDirtyCovers(node, restSegs) {
    if (!node || node.replace) return !!node?.replace;
    if (node.dirty) return true;
    if (!node.children) return false;
    for (const idx of Object.keys(node.children)) {
        const child = node.children[idx];
        if (restSegs.length === 0) {
            if (trieHasAnyDirty(child)) return true;
        } else if (pathDirtyCovers(child, restSegs)) {
            return true;
        }
    }
    return false;
}

function trieHasAnyDirty(node) {
    if (!node || node.replace) return !!node;
    if (node.dirty) return true;
    if (!node.children) return false;
    for (const k of Object.keys(node.children)) {
        if (trieHasAnyDirty(node.children[k])) return true;
    }
    return false;
}

/**
 * Wake if write is at/under dep, or dep is under write (parent covers children).
 */
function pathDirtyCovers(node, depSegs) {
    let cur = node;
    for (let i = 0; i < depSegs.length; i++) {
        if (!cur || cur.replace) return !!cur?.replace;
        if (cur.dirty) return true; // write parent covers this dep
        if (!cur.children) return false;
        const next = cur.children[depSegs[i]];
        if (!next) {
            // No write along this dep path ??but a write under a prefix?
            return false;
        }
        cur = next;
    }
    // Reached dep node: wake if dirty here or any dirty descendant (write under dep).
    return trieHasAnyDirty(cur);
}

/**
 * Dual-track match retained for tests / tooling.
 */
function noticeMatchesDepKey(notice, key) {
    const trie = Object.create(null);
    insertDirtyNotice(trie, notice);
    return depMatchesTrie(trie, key);
}

function depRootField(dep) {
    if (!dep) return '';
    const star = dep.indexOf('.*');
    if (star >= 0) return dep.slice(0, star);
    const dot = dep.indexOf('.');
    if (dot >= 0) return dep.slice(0, dot);
    const bracket = dep.indexOf('[');
    if (bracket >= 0) return dep.slice(0, bracket);
    return dep;
}

function refreshBinding(inst, bindingId, dirtyTrie = null) {
    const entry = inst.__vmzBindings && inst.__vmzBindings[bindingId];
    const jobs = [];
    if (!inst || inst.__vmzDestroyed || bindingId == null || !entry) {
        return jobs;
    }
    const depKey = (entry.deps && entry.deps[0]) || null;
    const trie = dirtyTrie || inst.__vmzDirtyTrie;
    const allowIdx = itemIndicesAllowedForDeps(trie, entry.deps);
    for (const fn of entry.patches) {
        if (allowIdx && !patchMatchesDirtyIndex(fn, allowIdx)) continue;
        try {
            const ret = runPatch(inst, fn, depKey, bindingId);
            if (ret && typeof ret.then === 'function') jobs.push(ret);
        } catch (err) {
            console.error('vmz:dom patch', err);
        }
    }
    return jobs;
}

/**
 * For ListItem path-channel deps (`tags.*.label`), restrict to dirty indices.
 */
function itemIndicesAllowedForDeps(trie, deps) {
    if (!trie || !deps || !deps.length) return null;
    let sawListChannel = false;

    let allow = null;
    for (const dep of deps) {
        const root = depRootField(dep);
        if (!root) continue;
        const starPrefix = `${root}.*`;
        const isListChannel = dep === starPrefix || dep.startsWith(`${starPrefix}.`) || (dep.startsWith(`${root}[`) && dep.includes(']'));
        if (!isListChannel) return null;
        sawListChannel = true;
        const node = trie[root];
        if (!node) continue;
        if (node.replace || node.dirty) return null; // whole list
        if (!node.children) continue;
        if (!allow) allow = new Set();
        for (const idx of Object.keys(node.children)) {
            const child = node.children[idx];
            if (!child) continue;
            if (child.replace || child.dirty || trieHasAnyDirty(child)) {
                allow.add(String(idx));
            }
        }
    }
    if (!sawListChannel) return null;
    return allow && allow.size ? allow : null;
}

/**
 * If every allowed list index is dirty on exactly the same single item field, return that field.
 * Used to hoist one monomorphic `applyByField[field]` across the update batch.
 */
function soleDirtyItemField(trie, listRoot, allowIdx) {
    if (!trie || !listRoot || !allowIdx || !allowIdx.size) return null;
    const node = trie[listRoot];
    if (!node || node.replace || node.dirty || !node.children) return null;
    // Peek first index for the sole dirty field, then verify the rest match.
    // Fast path: index child has a single key (typical WritePath leaf) ??no sibling scan.
    let field = null;
    for (const idx of allowIdx) {
        const child = node.children[String(idx)];
        if (!child || child.replace || child.dirty || !child.children) return null;
        const kids = child.children;
        const keys = Object.keys(kids);
        if (keys.length === 1) {
            const f = keys[0];
            const n = kids[f];
            if (!n || !(n.dirty || n.replace || trieHasAnyDirty(n))) return null;
            if (field == null) field = f;
            else if (field !== f) return null;
            continue;
        }
        if (field == null) {
            for (let k = 0; k < keys.length; k++) {
                const f = keys[k];
                const n = kids[f];
                if (n && (n.dirty || n.replace || trieHasAnyDirty(n))) {
                    if (field != null) return null;
                    field = f;
                }
            }
            if (field == null) return null;
            continue;
        }
        const n = kids[field];
        if (!n || !(n.dirty || n.replace || trieHasAnyDirty(n))) return null;
        for (let k = 0; k < keys.length; k++) {
            const f = keys[k];
            if (f === field) continue;
            const o = kids[f];
            if (o && (o.dirty || o.replace || trieHasAnyDirty(o))) return null;
        }
    }
    return field;
}

/**
 * Dirty item field names at list index (`rows.3.label` ??`["label"]`).
 */
function dirtyItemFieldsAt(trie, listRoot, idx) {
    if (!trie || !listRoot) return null;
    const node = trie[listRoot];
    if (!node) return [];
    if (node.replace || node.dirty) return null;
    const child = node.children && node.children[String(idx)];
    if (!child) return [];
    if (child.replace || child.dirty) return null;
    if (!child.children) return null;

    const out = [];
    for (const field of Object.keys(child.children)) {
        const n = child.children[field];
        if (n && (n.dirty || n.replace || trieHasAnyDirty(n))) out.push(field);
    }
    return out;
}

function patchMatchesDirtyIndex(fn, allowIdx) {
    const idx = fn && fn.__vmzItemIndex;
    if (idx == null || idx === '') return true;
    return allowIdx.has(String(idx));
}

function refreshField(inst, field) {
    const binders = inst.__vmzBinders;
    const jobs = [];
    if (!inst || inst.__vmzDestroyed || !field || !binders || !binders[field]) {
        return jobs;
    }
    for (const fn of binders[field]) {
        try {
            const ret = runPatch(inst, fn, field, null);
            if (ret && typeof ret.then === 'function') jobs.push(ret);
        } catch (err) {
            console.error('vmz:dom patch', err);
        }
    }
    return jobs;
}

/**
 * Run `__vmzBinders` patches that are not owned by a BindingId entry.
 * Needed so `bindComponentProp` (bindingId null) still flushes when the same
 * dep also has IR bindText/bindAttr BindingIds.
 */
function refreshFieldBinderOnly(inst, field) {
    const binders = inst.__vmzBinders;
    const jobs = [];
    if (!inst || inst.__vmzDestroyed || !field || !binders || !binders[field]) {
        return jobs;
    }
    for (const fn of binders[field]) {
        if (patchHasBindingId(inst, fn)) continue;
        try {
            const ret = runPatch(inst, fn, field, null);
            if (ret && typeof ret.then === 'function') jobs.push(ret);
        } catch (err) {
            console.error('vmz:dom patch', err);
        }
    }
    return jobs;
}

function reindexBindingDeps(inst, bindingId, deps) {
    if (!inst.__vmzDepToBindings) inst.__vmzDepToBindings = Object.create(null);
    const entry = inst.__vmzBindings[bindingId];
    if (!entry) return;
    for (const dep of entry.deps || []) {
        const list = inst.__vmzDepToBindings[dep];
        if (!list) continue;
        const j = list.indexOf(bindingId);
        if (j >= 0) list.splice(j, 1);
        if (list.length === 0) delete inst.__vmzDepToBindings[dep];
    }
    entry.deps = [...(deps || [])];
    for (const dep of entry.deps) {
        if (!inst.__vmzDepToBindings[dep]) inst.__vmzDepToBindings[dep] = [];
        if (!inst.__vmzDepToBindings[dep].includes(bindingId)) {
            inst.__vmzDepToBindings[dep].push(bindingId);
        }
    }
}

function registerBind(inst, deps, fn, bindingId = null) {
    if (!inst.__vmzBinders) inst.__vmzBinders = Object.create(null);
    for (const dep of deps || []) {
        if (!inst.__vmzBinders[dep]) inst.__vmzBinders[dep] = [];
        inst.__vmzBinders[dep].push(fn);
    }
    if (bindingId == null) return;
    if (!inst.__vmzBindings) inst.__vmzBindings = Object.create(null);
    let entry = inst.__vmzBindings[bindingId];
    if (!entry) {
        entry = { id: bindingId, deps: [], patches: [] };
        inst.__vmzBindings[bindingId] = entry;
    }
    if (!entry.patches.includes(fn)) entry.patches.push(fn);
    reindexBindingDeps(inst, bindingId, deps || []);
}

function unregisterBind(inst, deps, fn, bindingId = null) {
    const binders = inst.__vmzBinders;
    if (binders) {
        for (const dep of deps || []) {
            const list = binders[dep];
            if (!list) continue;
            const i = list.indexOf(fn);
            if (i >= 0) list.splice(i, 1);
            if (list.length === 0) delete binders[dep];
        }
    }
    if (bindingId == null || !inst.__vmzBindings) return;
    const entry = inst.__vmzBindings[bindingId];
    if (!entry) return;
    const i = entry.patches.indexOf(fn);
    if (i >= 0) entry.patches.splice(i, 1);
    if (entry.patches.length === 0) {
        reindexBindingDeps(inst, bindingId, []);
        delete inst.__vmzBindings[bindingId];
    }
}

/**
 * True when the container already has meaningful DOM (SSR / resume shell).
 */
export function hasMeaningfulChild(el) {
    for (const n of el.childNodes) {
        if (n.nodeType === 1) return true;
        if (n.nodeType === 3 && String(n.textContent).trim() !== '') return true;
    }
    return false;
}

function patchHasBindingId(inst, fn) {
    const bindings = inst && inst.__vmzBindings;
    if (!bindings) return false;
    for (const id of Object.keys(bindings)) {
        const patches = bindings[id].patches;
        if (patches && patches.includes(fn)) return true;
    }
    return false;
}

function tagItemPatches(patches, index) {
    if (!patches) return;
    const idx = String(index);
    for (const p of patches) {
        if (typeof p === 'function') p.__vmzItemIndex = idx;
    }
}
