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
import { applyDomAttr, eventPropHandlerName } from './attributes.js';
import { createInstance, disposeDomTree, findOwnedDefaultSlotTarget, runDirectCreate, stripFns } from './component.js';
import { isEventEntryStrategy, noteDomCreate, noteDomRemove, scheduleClientOn } from './lifecycle.js';
import { components, resolveComponent } from './registry.js';
import {
    beginEventFlush,
    endEventFlush,
    inferHandlerMethod,
    methodAllowsSyncEventFlush,
    registerBind,
    runDomEventHandler,
    runPatch,
    scheduleRefresh,
    unregisterBind,
} from '../reactivity/patch-scheduler.js';

let directPropBindSeq = 0;

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
    elNS(ns, tag) {
        if (directApi._resumeAdopt && typeof directApi._resumeAdopt.elNS === 'function') {
            return directApi._resumeAdopt.elNS(ns, tag);
        }
        noteDomCreate();
        return document.createElementNS(ns || 'http://www.w3.org/2000/svg', tag || 'g');
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
            if (!directApi._itemPatches.includes(patch)) {
                directApi._itemPatches.push(patch);
            }
            if (directApi._eachCtx) {
                directApi._eachCtx.noteItemBind(bindingId, deps || [], patch);
            }
            // Also register on the instance so outer field writes (`selected` in
            // `selected === item.id`) wake item patches — keyed-each only re-runs
            // create/apply on list deps, not host fields referenced inside items.
            registerBind(inst, deps || [], patch, bindingId);
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
    mergeClass(...parts) {
        return mergeClassParts(...parts);
    },
    mergeStyle(...parts) {
        return mergeStyleParts(...parts);
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
                    const s = mergeClassParts(raw);
                    if (s) el.setAttribute('class', s);
                    else if (el.hasAttribute('class')) el.removeAttribute('class');
                } else if (name === 'style') {
                    const s = mergeStyleParts(raw);
                    if (s) el.setAttribute('style', s);
                    else if (el.hasAttribute('style')) el.removeAttribute('style');
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
                const { resume } = await import('../../ssr/dom-ssr.js');
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

        const target = root && root.nodeType === 1 ? findOwnedDefaultSlotTarget(root) : null;
        if (target && target.parentNode) {
            if (String(target.tagName || '').toLowerCase() === 'slot') {
                target.replaceWith(node);
                return;
            }
            target.appendChild(node);
            return;
        }
        if (root && root.nodeType === 1 && typeof root.appendChild === 'function') root.appendChild(node);
        else hostEl.appendChild(node);
    },
};
