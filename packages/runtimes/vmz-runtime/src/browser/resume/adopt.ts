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
import { HTML_HASH_ATTR } from '../../shared/html-digest.js';
import { ROW_END_MARKER_PREFIX, ROW_MARKER_PREFIX, rowEndMarker, rowMarker } from '../../shared/row-key.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function createResumeAdopt(pool, rootEl) {
    const used = new WeakSet();

    const scopeStack = [pool];

    const currentScope = () => scopeStack[scopeStack.length - 1] || pool;

    /** `rootEl`'s children were parked into `pool` before create — see bottom. */
    let rootElTookPool = false;

    const markElement = (n) => {
        used.add(n);
        if (typeof n.getAttribute === 'function') {
            const k = n.getAttribute('data-vmz-key');
            if (k != null && n.__vmzKey == null) n.__vmzKey = k;
        }
        // `runDirectResume` parks `rootEl`'s children into the top-level pool
        // before create. Adopting `rootEl` must hand that same pool to it as the
        // child scope: making a fresh (empty) child pool here would leave every
        // SSR descendant unreachable and silently recreate the whole subtree.
        let childPool;
        if (n === rootEl && !rootElTookPool) {
            rootElTookPool = true;
            childPool = pool;
        } else {
            // Private child pool ??never dump into the parent/global pool (that let
            // if branches reclaim Drawer/sibling hosts parked as uncles).
            childPool = document.createDocumentFragment();
            while (n.firstChild) childPool.appendChild(n.firstChild);
        }
        n.__vmzResumePool = childPool;
        return n;
    };

    /**
     * Component hosts are claimed only by `componentHost`, never by plain element
     * adoption. Hosts may be `<span>` (phrasing inline chips) or `<div>` (block
     * surfaces), so tag matching alone would let a page `<span>` steal a chip host
     * and force a rebuild.
     */
    const isComponentHost = (el) =>
        typeof el.getAttribute === 'function' && el.getAttribute('data-vmz') != null;

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

    /**
     * Text bindings always belong to the element whose scope is active, so only
     * direct text children are candidates. Recursing into element children
     * lets an earlier binding steal the text of a sibling that has not been
     * adopted yet (soft navigation lost the landing CTA label this way).
     */
    function* textCandidates() {
        const scope = currentScope();
        for (const n of [...scope.childNodes]) {
            if (n.nodeType === 3 && !used.has(n)) yield n;
        }
    }

    const adoptElement = (tag, svg = false, key = null) => {
        const want = String(tag || 'div').toLowerCase();
        // Keyed non-kernel rows (`component`, `v-once`, `v-memo`) carry their key on
        // the root, so reclaim by identity. Falling back to tag order reuses a node
        // that belongs to another key as soon as list order diverges from SSR.
        if (key != null) {
            const wanted = String(key);
            for (const el of elementCandidates()) {
                if (String(el.tagName).toLowerCase() !== want) continue;
                if (typeof el.getAttribute !== 'function') continue;
                if (el.getAttribute('data-vmz-key') !== wanted) continue;
                return markElement(el);
            }
            noteDomCreate();
            const fresh = svg ? document.createElementNS(SVG_NS, tag || 'svg') : document.createElement(tag || 'div');
            (fresh as any).__vmzKey = wanted;
            return fresh;
        }
        for (const el of elementCandidates()) {
            if (String(el.tagName).toLowerCase() === want && !isComponentHost(el)) return markElement(el);
        }
        noteDomCreate();
        const fresh = svg ? document.createElementNS(SVG_NS, tag || 'svg') : document.createElement(tag || 'div');
        // Direct SSR flattens `<slot/>` away and writes the projected children in
        // place, so a rebuilt outlet has no SSR counterpart: its projection stays
        // in the enclosing scope. Share that scope as the outlet pool so a later
        // `adoptEnter(host)` can still reclaim the projected subtree.
        if (want === 'slot') (fresh as any).__vmzResumePool = currentScope();
        return fresh;
    };

    const adoptElementNS = (ns, tag) => {
        const want = String(tag || 'g');
        for (const el of elementCandidates()) {
            if (el.namespaceURI === ns && String(el.localName) === want) return markElement(el);
        }
        noteDomCreate();
        return document.createElementNS(ns || SVG_NS, want);
    };

    /**
     * Reclaim the SSR row root for one keyed-each key.
     *
     * Tag-order adoption cannot distinguish rows when the client list is already
     * ahead of the SSR order (persisted state, re-filtered store): the first
     * `<li>` would be reused for whichever key the client renders first, so the
     * retained DOM node (focus, caret, typed value) belongs to another key.
     * Keyed rows carry `data-vmz-key` on the server, so match it exactly and leave
     * unmatched SSR rows for the pool teardown. `null` means "not present in SSR"
     * and the caller creates a fresh row.
     */
    const claimKeyed = (tag, key) => {
        if (key == null) return null;
        const want = String(tag || '').toLowerCase();
        const wanted = String(key);
        if (!want) return null;
        for (const el of elementCandidates()) {
            if (String(el.tagName).toLowerCase() !== want) continue;
            if (typeof el.getAttribute !== 'function') continue;
            if (el.getAttribute('data-vmz-key') !== wanted) continue;
            // Row kernels own the whole row subtree (no nested each/component), and
            // `hydrate` reads `root.firstChild` for its text slots. Do not stash the
            // row's children into a resume pool here: the row must keep its SSR
            // structure as-is.
            used.add(el);
            const k = el.getAttribute('data-vmz-key');
            if (k != null && el.__vmzKey == null) el.__vmzKey = k;
            return el;
        }
        return null;
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

    const componentHost = (name, key = null) => {
        const want = String(name || '');
        const wanted = key == null ? null : String(key);
        for (const el of elementCandidates()) {
            if (el.getAttribute('data-vmz') !== want) continue;
            if (wanted != null && el.getAttribute('data-vmz-key') !== wanted) continue;
            return markElement(el);
        }
        return null;
    };

    /** Any parked SSR node in `frag` that no earlier create has claimed. */
    const hasUnusedNode = (frag) => {
        for (const n of frag.childNodes) {
            if (!used.has(n)) return true;
        }
        return false;
    };

    const enter = (node) => {
        if (!node) return false;
        // `adoptEnter(host)` in the parent template wraps the *projection*, not the
        // component's own internals (its host pool was consumed by the component
        // create). The parked projection lives under the default `<slot/>` outlet,
        // so entering the host must push that outlet's pool.
        const owner = node.__vmzInst;
        if (owner) {
            const slot = findOwnedDefaultSlot(owner.__vmzDomRoot);
            const slotPool = slot && slot.__vmzResumePool;
            if (slotPool && hasUnusedNode(slotPool)) {
                scopeStack.push(slotPool);
                return true;
            }
        }
        // Emitted `adoptEnter` is always paired with `adoptLeave`, but a node that
        // has no SSR counterpart (fresh element or fresh component host) has no
        // parked pool. Returning without pushing made that paired leave pop the
        // caller's scope instead, so each rebuilt node drifted the stack one level
        // up and later projection siblings (slot roots 2..n) lost their pool.
        // Push an isolated empty scope: the rebuilt subtree has no SSR counterpart
        // to reclaim, and its children must not steal the enclosing siblings.
        scopeStack.push(node.__vmzResumePool || document.createDocumentFragment());
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

    /**
     * `v-html` on a reclaimed element. `markElement` parked its SSR children, so
     * the live element reads empty. SSR stamped the digest of the exact payload
     * string it wrote on the host (`HTML_HASH_ATTR`), so compare that marker with
     * the digest of the string this create would write: equal means the parked
     * subtree already *is* that payload, and moving it back keeps every SSR node.
     * A different digest drops the parked payload so the normal write replaces it.
     */
    const reclaimHtml = (el, digest) => {
        if (!used.has(el)) return false;
        const childPool = el.__vmzResumePool;
        const stamp = String(el.getAttribute(HTML_HASH_ATTR) || '');
        if (stamp !== digest) {
            // A different payload replaces this host, so parked SSR children can
            // never be adopted afterwards. Drop them now instead of leaving a
            // stale pool for a later identical patch to resurrect.
            if (childPool) while (childPool.firstChild) childPool.removeChild(childPool.firstChild);
            return false;
        }
        if (childPool) while (childPool.firstChild) el.appendChild(childPool.firstChild);
        return true;
    };

    /**
     * Scope adoption to one multi-root `<template v-for>` row.
     *
     * The row has no element root to carry `data-vmz-key`, so SSR wrote a
     * `<!--vmz-row:KEY-->…<!--vmz-row-end:KEY-->` pair around its nodes. Claim
     * exactly that pair, move its inner nodes into a private scope, and drop the
     * markers so the resumed DOM matches a client-created row. A missing or
     * unbalanced pair means "this row is not in SSR": push an empty scope so the
     * row is built fresh instead of stealing a sibling row's nodes.
     */
    const rowStart = (key) => {
        const scope = currentScope();
        const rowPool = document.createDocumentFragment();
        let claimed = false;
        if (key != null) {
            const wanted = rowMarker(key);
            const wantedEnd = rowEndMarker(key);
            const nodes: Node[] = [...scope.childNodes];
            let start = -1;
            for (let i = 0; i < nodes.length; i++) {
                const n = nodes[i];
                if (n.nodeType !== 8) continue;
                if (String(n.nodeValue || '') === wanted) {
                    start = i;
                    break;
                }
            }
            let end = -1;
            if (start >= 0) {
                // Nested rows directly inside this row contribute their own pair at
                // the same sibling level, so pairing is depth-counted.
                let depth = 0;
                for (let i = start + 1; i < nodes.length; i++) {
                    const n = nodes[i];
                    if (n.nodeType !== 8) continue;
                    const data = String(n.nodeValue || '');
                    if (data.startsWith(ROW_MARKER_PREFIX)) {
                        depth += 1;
                    } else if (data.startsWith(ROW_END_MARKER_PREFIX)) {
                        if (depth === 0) {
                            if (data === wantedEnd) end = i;
                            break;
                        }
                        depth -= 1;
                    }
                }
            }
            if (end > start) {
                const startMarker = nodes[start];
                const endMarker = nodes[end];
                for (let i = start + 1; i < end; i++) rowPool.appendChild(nodes[i]);
                if (startMarker.parentNode === scope) scope.removeChild(startMarker);
                if (endMarker.parentNode === scope) scope.removeChild(endMarker);
                claimed = true;
            }
        }
        scopeStack.push(rowPool);
        return claimed;
    };

    const rowEnd = () => {
        if (scopeStack.length <= 1) return;
        scopeStack.pop();
    };

    return {
        el: adoptElement,
        elNS: adoptElementNS,
        claimKeyed,
        rowStart,
        rowEnd,
        text: adoptText,
        componentHost,
        enter,
        leave,
        scopeDepth,
        rewindScope,
        beginBranchScope,
        reclaimHtml,
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
    const prevNsDepth = directApi.nsScopeDepth();
    directApi._inst = inst;
    directApi._branchBinds = null;
    directApi._itemPatches = null;
    directApi._eachCtx = null;
    directApi._resumeAdopt = createResumeAdopt(pool, rootEl);
    try {
        return Component.__vmzCreate.call(inst, directApi);
    } finally {
        directApi.rewindNsScope(prevNsDepth);
        directApi._resumeAdopt = prevAdopt;
        directApi._inst = prevInst;
        directApi._branchBinds = prevBranch;
        directApi._itemPatches = prevItems;
        directApi._eachCtx = prevEach;
        while (pool.firstChild) pool.removeChild(pool.firstChild);
    }
}
