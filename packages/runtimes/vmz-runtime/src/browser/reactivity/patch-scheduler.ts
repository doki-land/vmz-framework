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
import { bumpMap, precision, pushTrace } from '../diagnostics/precision-trace.js';

export function runPatch(inst, fn, depKey = null, bindingId = null) {
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

export function scheduleRefresh(inst, notice) {
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

export function inferHandlerMethod(handler) {
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

export function methodAllowsSyncEventFlush(inst, methodName) {
    if (!inst) return false;
    if (!methodName) return true;
    const table = inst.constructor && inst.constructor.__vmzMethodRw;
    const rw = table && table[methodName];
    if (!rw) return true;
    if (rw.async || rw.opaque) return false;
    return true;
}

export function runDomEventHandler(inst, methodHint, fn) {
    const sync = methodAllowsSyncEventFlush(inst, methodHint);
    if (sync) beginEventFlush(inst);
    try {
        return fn();
    } finally {
        if (sync) endEventFlush(inst);
    }
}

export function beginEventFlush(inst) {
    if (!inst) return;
    inst.__vmzEventDepth = (inst.__vmzEventDepth || 0) + 1;
}

export function endEventFlush(inst) {
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

export function promoteLeafDirtyToTrie(inst) {
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
    // Snapshot: keyed-each items share IR BindingIds; cf patches may untrack/retrack
    // mid-flush and mutate `entry.patches` (would skip sibling item attrs like aria-selected).
    const patches = entry.patches.slice();
    for (const fn of patches) {
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
    // Snapshot: patches may untrack/retrack and mutate the binder list mid-loop.
    const list = binders[field].slice();
    for (const fn of list) {
        try {
            const ret = runPatch(inst, fn, field, null);
            if (ret && typeof ret.then === 'function') jobs.push(ret);
        } catch (err) {
            console.error('vmz:dom patch', err);
        }
    }
    return jobs;
}

function refreshFieldBinderOnly(inst, field) {
    const binders = inst.__vmzBinders;
    const jobs = [];
    if (!inst || inst.__vmzDestroyed || !field || !binders || !binders[field]) {
        return jobs;
    }
    const list = binders[field].slice();
    for (const fn of list) {
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

export function registerBind(inst, deps, fn, bindingId = null) {
    if (!inst.__vmzBinders) inst.__vmzBinders = Object.create(null);
    for (const dep of deps || []) {
        if (!inst.__vmzBinders[dep]) inst.__vmzBinders[dep] = [];
        // Dedup: cf untrack/retrack with identical deps must not grow the binder list.
        if (!inst.__vmzBinders[dep].includes(fn)) inst.__vmzBinders[dep].push(fn);
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

export function unregisterBind(inst, deps, fn, bindingId = null) {
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
