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

export function noteDomCreate() {
    if (precision.enabled) precision.domCreates++;
}

export function noteDomRemove() {
    if (precision.enabled) precision.domRemoves++;
}

export function noteDomMove() {
    if (precision.enabled) precision.domMoves++;
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
