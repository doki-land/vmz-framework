/**
 * Direct DOM API types for `@vmz/core` browser runtime.
 */

export type BindingId = number | string | null;

export type DirectInstance = Record<string, unknown> & {
    __vmzDestroyed?: boolean;
    __vmzDomRoot?: Node | null;
    __vmzFlushTrie?: Record<string, unknown> | null;
};

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

/** Browser + generated artifact platform surface (0.2.0 thin runtime). */
export type DirectApi = {
    _inst: DirectInstance | null;
    _branchBinds: Array<{ deps: string[]; fn: PatchFn; bindingId?: BindingId }> | null;
    _itemPatches: PatchFn[] | null;
    _eachCtx: null | {
        noteItemBind: (bindingId: BindingId, deps: string[], fn: PatchFn) => void;
        needDelegate: (type: string) => void;
    };
    _resumeAdopt: null | Record<string, unknown>;
    el: (tag: string) => Element;
    text: (value?: unknown) => Text;
    frag: () => DocumentFragment;
    comment: (value?: string) => Comment;
    attr: (el: Element, name: string, value: unknown) => void;
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
    component: (Ctor: new (props?: object) => DirectInstance, props?: object) => HTMLElement;
    [key: string]: unknown;
};
