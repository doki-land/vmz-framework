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
    // Intentionally never call onMount ??SSR already completed that work.

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
                markUnknownComponentHost(el as HTMLElement, name, 'resume');
                return;
            }
            await resume(Ctor, el);
        });
    }
}

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
                markUnknownComponentHost(el as HTMLElement, name, 'event-entry');
                return;
            }
            await resume(Ctor, el);
        });
    }
}
