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

function createResumeAdopt(pool, rootEl) {
    const used = new WeakSet();

    const scopeStack = [pool];

    const walkTexts = (root, visit) => {
        if (!root) return;
        if (root.nodeType === 3) {
            visit(root);
            return;
        }
        if (root.nodeType !== 1) return;
        for (let c = root.firstChild; c; c = c.nextSibling) walkTexts(c, visit);
    };

    const currentScope = () => scopeStack[scopeStack.length - 1] || pool;

    const markElement = (n) => {
        used.add(n);
        if (typeof n.getAttribute === 'function') {
            const k = n.getAttribute('data-vmz-key');
            if (k != null && n.__vmzKey == null) n.__vmzKey = k;
        }
        // Private child pool ??never dump into the parent/global pool (that let
        // if branches reclaim Drawer/sibling hosts parked as uncles).
        const childPool = document.createDocumentFragment();
        while (n.firstChild) childPool.appendChild(n.firstChild);
        n.__vmzResumePool = childPool;
        return n;
    };

    function* elementCandidates() {
        const scope = currentScope();
        if (scope === pool && rootEl && !used.has(rootEl)) yield rootEl;
        // Snapshot ??adopt may move nodes out of scope while iterating.
        const kids = [...scope.childNodes];
        for (const n of kids) {
            if (n.nodeType === 1 && !used.has(n)) {
                yield n;
            }
        }
    }

    function* textCandidates() {
        const scope = currentScope();
        const kids = [...scope.childNodes];
        for (const n of kids) {
            const found = [];
            walkTexts(n, (t) => {
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

    const componentHost = (name) => {
        const want = String(name || '');
        for (const el of elementCandidates()) {
            if (String(el.tagName).toLowerCase() !== 'div') continue;
            if (el.getAttribute('data-vmz') !== want) continue;
            return markElement(el);
        }
        return null;
    };

    const enter = (node) => {
        if (!node || !node.__vmzResumePool) return false;
        scopeStack.push(node.__vmzResumePool);
        return true;
    };

    const leave = () => {
        if (scopeStack.length <= 1) return;
        scopeStack.pop();
    };

    const scopeDepth = () => scopeStack.length;

    const rewindScope = (depth) => {
        const d = Math.max(1, Number(depth) || 1);
        while (scopeStack.length > d) scopeStack.pop();
    };

    /**
     * Isolate the next top-level SSR sibling as the only candidates for an
     * if/else branch create (commercial Card: Empty branch must not adopt Drawer).
     */
    const beginBranchScope = () => {
        const parent = currentScope();
        const branchPool = document.createDocumentFragment();
        for (const n of [...parent.childNodes]) {
            if (n.nodeType === 1 && !used.has(n)) {
                branchPool.appendChild(n);
                break;
            }
        }
        scopeStack.push(branchPool);
        const depth = scopeStack.length;
        return () => {
            while (branchPool.firstChild) branchPool.removeChild(branchPool.firstChild);
            rewindScope(depth - 1);
        };
    };

    return {
        el: adoptElement,
        text: adoptText,
        componentHost,
        enter,
        leave,
        scopeDepth,
        rewindScope,
        beginBranchScope,
    };
}

export function runDirectResume(Component, inst, container) {
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
