/**
 * Direct DOM API types for `@vmz/core` browser runtime.
 */

export type BindingId = number | string | null;

export type PatchFn = (this: DirectInstance) => void;

export type DirectBranchCreate = (api: DirectApi) => Node;

export type DirectIfBranch = {
    cond?: PatchFn;
    create: DirectBranchCreate;
};

export type DirectEachSpec = {
    as?: string;
    list: PatchFn;
    key?: PatchFn;
    createItem: DirectBranchCreate;
    serializeItem?: DirectBranchCreate;
};

export type BinderEntry = {
    deps: string[];
    fn: PatchFn;
    bindingId?: BindingId;
};

export type DirtyTrieNode = {
    [seg: string]: DirtyTrieNode | true | undefined;
};

export type ComponentListenerBag = Record<string, Array<(detail?: unknown) => void>>;

export type VmzPlan = {
    schema?: string;
    root_ids?: Array<string | number>;
    [key: string]: unknown;
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

export type DirtyNotice = { type: 'replace'; root: string } | { type: 'path'; root: string; segs: string[] };

/** Runtime instance shape mounted by Direct create / hydrate / resume. */
export type DirectInstance = {
    [key: string]: unknown;
    __vmzDestroyed?: boolean;
    __vmzDomRoot?: (Node & { __vmzInst?: DirectInstance | null }) | null;
    __vmzFlushTrie?: DirtyTrieNode | null;
    __vmzFlushScheduled?: boolean;
    __vmzFlushSync?: boolean;
    __vmzDirtyTrie?: DirtyTrieNode | null;
    __vmzDirty?: Set<string>;
    __vmzDirtyNotices?: DirtyNotice[];
    __vmzLeafDirty?: Array<{ root: string; field: string; idxs: number[] }>;
    __vmzDrainLeafDirty?: boolean;
    __vmzBinders?: Record<string, BinderEntry | PatchFn>;
    __vmzBindings?: Record<string, BinderEntry | PatchFn>;
    __vmzDepToBindings?: Record<string, Array<string | number>>;
    __vmzPendingChildMounts?: Array<Promise<unknown>>;
    __vmzComponentListeners?: ComponentListenerBag;
    __vmzOnParentProp?: (propName: string, value: unknown) => void;
    __vmzApplyProps?: (props: object) => void;
    __vmzTasks?: Record<string, TaskEntry>;
    __vmzPlan?: VmzPlan | null;
    __vmzCtor?: ComponentCtorLike | null;
    __vmzQuiet?: boolean;
    __vmzEventDepth?: number;
    __vmzEachApplyLeaf?: unknown;
    __vmzEachCompoundStride?: unknown;
    __vmzEachTranspose?: unknown;
    onMount?: () => void | Promise<void>;
    onDestroy?: () => void | Promise<void>;
};

export type ComponentCtorLike = (new (
    props?: object,
) => DirectInstance) & {
    __vmzDirect?: boolean;
    __vmzCreate?: (this: DirectInstance, api: DirectApi) => Node;
    __vmzSerialize?: (this: DirectInstance, api: DirectApi) => unknown;
    __vmzPlan?: VmzPlan | unknown;
    __vmzHostBox?: string;
    __vmzTag?: string;
    __vmzState?: string[];
    __vmzProps?: string[];
    __vmzWBInstalled?: boolean;
    __vmzCtorAppliesProps?: boolean;
    name?: string;
};

export type DirectEachCtx = {
    noteItemBind: (bindingId: BindingId, deps: string[], fn: PatchFn) => void;
    needDelegate: (type: string) => void;
};

/** Browser + generated artifact platform surface (0.2.0 thin runtime). */
export type DirectApi = {
    _inst: DirectInstance | null;
    _branchBinds: Array<{ deps: string[]; fn: PatchFn; bindingId?: BindingId }> | null;
    _itemPatches: PatchFn[] | null;
    _eachCtx: DirectEachCtx | null;
    _resumeAdopt: null | Record<string, unknown>;
    el: (tag: string) => Element;
    text: (value?: unknown) => Text;
    frag: () => DocumentFragment;
    comment: (value?: string) => Comment;
    attr: (el: Element, name: string, value: unknown) => void;
    mergeClass: (...parts: unknown[]) => string;
    mergeStyle: (...parts: unknown[]) => string;
    insertBefore: (parent: Node, node: Node, ref: Node | null) => void;
    removeNode: (node: Node) => void;
    trackPatch: (inst: DirectInstance, deps: string[], patch: PatchFn, bindingId?: BindingId) => void;
    specFieldText: (inst: DirectInstance, bindingId: BindingId, fieldName: string, textNode: Text) => void;
    specFieldAttr: (inst: DirectInstance, bindingId: BindingId, fieldName: string, el: Element, name: string) => void;
    on: (el: Element, type: string, handler: EventListener | PatchFn) => void;
    onMethod: (el: Element, type: string, method: string) => void;
    onComponentEvent: (el: Element, type: string, method: string) => void;
    adoptEnter: (node: Element) => boolean;
    adoptLeave: () => void;
    projectDefaultSlot: (hostEl: HTMLElement, node: Node) => void;
    setHtml: (el: Element, value: unknown) => void;
    bindHtml: (inst: DirectInstance, bindingId: BindingId, deps: string[], get: PatchFn, el: Element) => void;
    bindComponentProp: (
        inst: DirectInstance,
        bindingId: BindingId,
        deps: string[],
        get: PatchFn,
        hostInst: DirectInstance,
        propName: string,
    ) => void;
    component: (Ctor: ComponentCtorLike | string, props?: object) => HTMLElement;
};
