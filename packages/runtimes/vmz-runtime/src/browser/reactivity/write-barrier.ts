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
import { promoteLeafDirtyToTrie, scheduleRefresh } from './patch-scheduler.js';

const wbSharedOwners = new WeakMap();

const wbAllowShared = new WeakSet();

const wbCrossComponentDiags = [];

export function __vmzAllowShared(value) {
    if (value != null && typeof value === 'object') wbAllowShared.add(value);
    return value;
}

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

function tryInlineLeafApply(inst, root, idx, leaf, item) {
    const hook = inst.__vmzEachApplyLeaf && inst.__vmzEachApplyLeaf[root];
    if (typeof hook !== 'function') return false;
    return hook(+idx, leaf, item) === true;
}

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

export function makeReactive(inst, stateKeys) {
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

export function __vmzIsWriteBarrierOwned(value) {
    return writeBarrierOwned.has(value);
}

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
