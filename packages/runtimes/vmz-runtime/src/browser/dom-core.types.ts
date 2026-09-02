/**
 * Internal types for `@vmz/core` browser DOM runtime (`dom-core.ts`).
 */

import type { DirectApi, DirectInstance, PatchFn, BindingId } from './direct-api.types.js';

export type { DirectApi, DirectInstance, PatchFn, BindingId };

export type ComponentCtor = (new (
    props?: object,
) => DirectInstance) & {
    __vmzDirect?: boolean;
    __vmzCreate?: (this: DirectInstance, api: DirectApi) => Node;
    __vmzSerialize?: (this: DirectInstance, api: DirectApi) => unknown;
    __vmzPlan?: unknown;
    __vmzHostBox?: string;
    __vmzTag?: string;
    __vmzState?: string[];
    __vmzProps?: string[];
    __vmzWBInstalled?: boolean;
    __vmzCtorAppliesProps?: boolean;
    name?: string;
    [key: string]: unknown;
};

export type VmzDomElement = Element & {
    __vmzEvt?: Record<string, EventListener>;
    __vmzInst?: DirectInstance;
    __vmzPropBindSeq?: number;
    __vmzDispose?: (() => void) | null;
    value?: string;
    options?: HTMLOptionsCollection;
};

export type VmzDomNode = Node & {
    __vmzDispose?: (() => void) | null;
    __vmzInst?: DirectInstance;
};

export type VmzContainer = Element & {
    __vmzInst?: DirectInstance | null;
};

export type ReactiveOwner = {
    report: (segs: string[] | null) => void;
    baseSegs: string[];
    inst?: DirectInstance | null;
};

export type ReactiveEntry = {
    proxy: object;
    owners: ReactiveOwner[];
    kind: 'barrier' | 'proxy';
};

export type DirtyNotice = { type: 'replace'; root: string } | { type: 'path'; root: string; segs: string[] };

export type TraceEvent = {
    kind: string;
    stableId: { kind: string; id: string };
    dep?: string;
    t?: number;
    chunkId?: string | null;
};

export type PrecisionState = {
    enabled: boolean;
    writes: number;
    bindingEvals: number;
    patchExecs: number;
    domCreates: number;
    domMoves: number;
    domRemoves: number;
    componentExecs: number;
    writesByRoot: Record<string, number>;
    bindingEvalsByDep: Record<string, number>;
    patchesByDep: Record<string, number>;
    bindingEvalsByBinding: Record<string, number>;
    patchesByBinding: Record<string, number>;
};

export type TraceBuffer = {
    enabled: boolean;
    events: TraceEvent[];
};

export type ResumeAdoptCtx = {
    el: (tag: string) => Element;
    text: (value?: unknown) => Text;
    componentHost?: (name: string) => HTMLElement | null;
    enter?: (node: Element) => boolean;
    leave?: () => void;
    scopeDepth?: () => number;
    rewindScope?: (depth: number) => void;
    beginBranchScope?: () => () => void;
    _enterBalance?: number;
    inst?: DirectInstance;
};

export type EachCtx = {
    noteItemBind: (bindingId: BindingId, deps: string[], fn: PatchFn) => void;
    needDelegate: (type: string) => void;
    inst?: DirectInstance;
};

export type TaskStatus = 'pending' | 'success' | 'error' | 'cancelled';

export type TaskEntry = {
    generation: number;
    controller: AbortController | { signal: { aborted: boolean }; abort: () => void };
    status: TaskStatus;
    result?: unknown;
    error?: unknown;
    promise?: Promise<unknown>;
};

export type WbSharedEntry = {
    owners: ReactiveOwner[];
};

export type WbDiagnostic = {
    kind: string;
    message: string;
};

export type LogicalAssignKind = '||' | '&&' | '??';

export type LeafDirty = {
    root: string;
    field: string;
    idxs: number[];
};

export type UnknownComponentErrorDetail = {
    kind: string;
    component: string;
    via: string;
};

export type SerializeTreeNode = {
    __kind: 'el' | 'text';
    tag?: string;
    attrs?: Record<string, string>;
    children?: SerializeTreeNode[];
    value?: string;
    appendChild?: (c: SerializeTreeNode | null | undefined) => void;
};
