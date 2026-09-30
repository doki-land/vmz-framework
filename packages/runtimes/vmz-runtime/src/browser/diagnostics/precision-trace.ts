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

export function pushTrace(kind, stableKind, stableId, dep = null) {
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

export function bumpMap(map, key, n = 1) {
    if (key == null || key === '') return;
    map[key] = (map[key] || 0) + n;
}

export const precision: PrecisionState = {
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
