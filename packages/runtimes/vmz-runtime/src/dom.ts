// @ts-nocheck
/**
 * VMZ DOM / SSR runtime — precise patches, no VDOM diff.
 *
 *
 * Direct components expose `__vmzCreate` / `__vmzSerialize` / `__vmzPlan`.
 * Mount, SSR, hydrate, and resume all run that same schedule.
 * Field writes only run registered dep patches — never re-create structure.
 */

/** @type {Record<string, new (props?: object) => any>} */
const components = Object.create(null);

/**
 * Precision lab counters (test / MCP / benchmarks — not a user API).
 * Primary keys: BindingId (IR). `*ByDep` is transitional stable-string adapter.
 */
const precision = {
    enabled: false,
    writes: 0,
    bindingEvals: 0,
    patchExecs: 0,
    domCreates: 0,
    domMoves: 0,
    domRemoves: 0,
    componentExecs: 0,
    /** @type {Record<string, number>} */
    writesByRoot: Object.create(null),
    /** @type {Record<string, number>} */
    bindingEvalsByDep: Object.create(null),
    /** @type {Record<string, number>} */
    patchesByDep: Object.create(null),
    /** @type {Record<string, number>} BindingId → count */
    bindingEvalsByBinding: Object.create(null),
    /** @type {Record<string, number>} BindingId → count */
    patchesByBinding: Object.create(null),
};

/** optional StableId event ring (enabled with precision or __vmzTraceEnable). */
const TRACE_CAP = 256;
/** @type {{ enabled: boolean, events: Array<{ kind: string, stableId: { kind: string, id: string }, dep?: string|null, t?: number, chunkId?: string|null }> }} */
const traceBuf = {
    enabled: false,
    events: [],
};

function pushTrace(kind, stableKind, stableId, dep = null) {
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

function bumpMap(map, key, n = 1) {
    if (key == null || key === '') return;
    map[key] = (map[key] || 0) + n;
}

/** @param {boolean} [on] */
export function __vmzPrecisionEnable(on = true) {
    precision.enabled = !!on;
}

/** @param {boolean} [on] */
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

/**
 * StableId event snapshot (`vmz.dx.trace.v0` shape without schema stamp —
 * host may wrap via ingestRuntimeTrace).
 * @returns {{ schema: string, events: typeof traceBuf.events, status: string }}
 */
export function __vmzTraceSnapshot() {
    const events = traceBuf.events.map((e) => ({ ...e, stableId: { ...e.stableId } }));
    return {
        schema: 'vmz.dx.trace.v0',
        events,
        status: events.length ? 'ready' : 'empty',
    };
}

/** @returns {typeof precision} */
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

/**
 * @param {() => any} fn
 * @param {string | null} [depKey]
 * @param {number | string | null} [bindingId]
 */
function runPatch(fn, depKey = null, bindingId = null) {
    if (precision.enabled) {
        precision.patchExecs++;
        if (depKey) bumpMap(precision.patchesByDep, depKey);
        if (bindingId != null) bumpMap(precision.patchesByBinding, String(bindingId));
    }
    if (bindingId != null) {
        pushTrace('patch', 'binding', bindingId, depKey);
    }
    return fn();
}

function noteDomCreate() {
    if (precision.enabled) precision.domCreates++;
}

function noteDomRemove() {
    if (precision.enabled) precision.domRemoves++;
}

function noteDomMove() {
    if (precision.enabled) precision.domMoves++;
}

/** @param {Record<string, any>} map */
export function registerComponents(map) {
    Object.assign(components, map);
}

/**
 * Lazy component loader for EventEntry mixed packs (set by entry-client / entry-event).
 * @param {string} name
 * @returns {Promise<any>}
 */
async function resolveComponent(name) {
    let Ctor = components[name];
    if (!Ctor && typeof globalThis.__vmzLoadComponent === 'function') {
        Ctor = await globalThis.__vmzLoadComponent(name);
        if (Ctor) registerComponents({ [name]: Ctor });
    }
    return Ctor || null;
}

/**
 * @param {new (props?: object) => any} Component
 * @param {object} [props]
 */
export async function renderToString(Component, props = {}, opts = {}) {
    const signal = opts && opts.signal;
    if (signal && signal.aborted) return '';
    const inst = createInstance(Component, props);
    if (typeof inst.onMount === 'function') {
        await inst.onMount();
    }
    if (signal && signal.aborted) return '';
    // production Direct emit: SSR only via Direct serialize schedule — never `render`.
    if (!(Component && Component.__vmzDirect && typeof Component.__vmzCreate === 'function')) {
        throw new Error(`vmz:dom renderToString() requires __vmzCreate (Direct); blueprint render() removed (production Direct emit)`);
    }
    const root = await runDirectSerializeTreeWithMounts(Component, inst);
    if (opts && opts.slotHtml != null) injectDefaultSlotHtml(root, opts.slotHtml);
    return flattenSerializeNode(root);
}

/**
 * Stream SSR via the same Direct serialize schedule as `renderToString`.
 * Yields HTML chunks (open tag → children → close). Joining chunks equals `renderToString`.
 * Supports AbortSignal for cancel; consumers should respect backpressure (await between chunks).
 * @param {new (props?: object) => any} Component
 * @param {object} [props]
 * @param {{ signal?: AbortSignal, slotHtml?: string }} [opts]
 * @returns {AsyncGenerator<string, void, void>}
 */
export async function* renderToStream(Component, props = {}, opts = {}) {
    const signal = opts && opts.signal;
    const aborted = () => Boolean(signal && signal.aborted);
    if (aborted()) return;
    const inst = createInstance(Component, props);
    try {
        if (typeof inst.onMount === 'function') {
            await inst.onMount();
        }
        if (aborted()) return;
        if (!(Component && Component.__vmzDirect && typeof Component.__vmzCreate === 'function')) {
            throw new Error(`vmz:dom renderToStream() requires __vmzCreate (Direct); blueprint render() removed (production Direct emit)`);
        }
        const root = await runDirectSerializeTreeWithMounts(Component, inst);
        if (opts && opts.slotHtml != null) injectDefaultSlotHtml(root, opts.slotHtml);
        if (aborted()) return;
        for (const chunk of streamSerializeChunks(root)) {
            if (aborted()) return;
            yield chunk;
            // Allow consumers / HTTP hosts to flush between chunks (backpressure point).
            await Promise.resolve();
        }
    } finally {
        // Abort and normal completion both dispose the SSR instance (lifetime).
        destroy(inst);
    }
}

/**
 * Fill the layout-owned default `<slot>` with pre-rendered HTML (layout SSR wrap).
 * Skips nested component hosts (`data-vmz`) — their slots are for child projection
 * (e.g. Button label), not the page outlet. Without this, DFS hits LocaleToggle→Button
 * before Layout's `<main><slot>`, and the entire page HTML lands inside a button.
 * @param {any} node
 * @param {string} html
 */
function injectDefaultSlotHtml(node, html) {
    if (!node || typeof node !== 'object') return false;
    if (node.__kind === 'el' && node.tag === 'slot' && !(node.attrs && node.attrs.name)) {
        node.__rawHtml = String(html ?? '');
        node.children = [];
        return true;
    }
    // Nested Direct component wrapper from serializeApi.component — do not search inside.
    if (node.__kind === 'el' && node.attrs && node.attrs['data-vmz'] != null) {
        return false;
    }
    const kids = node.children;
    if (Array.isArray(kids)) {
        for (const c of kids) {
            if (injectDefaultSlotHtml(c, html)) return true;
        }
    }
    return false;
}

/**
 * Live-DOM counterpart: first default `<slot>` owned by this tree, not by a nested
 * `[data-vmz]` component (Button/Link labels, etc.).
 * @param {Element | null | undefined} root
 * @returns {Element | null}
 */
export function findOwnedDefaultSlot(root) {
    if (!root || root.nodeType !== 1) return null;
    const tag = String(root.tagName || '').toLowerCase();
    if (tag === 'slot' && !root.getAttribute('name')) return root;
    const kids = root.children;
    if (!kids || !kids.length) return null;
    for (let i = 0; i < kids.length; i++) {
        const c = kids[i];
        if (c.nodeType !== 1) continue;
        // Nested component host — its slots are not the layout page outlet.
        if (c.hasAttribute('data-vmz')) continue;
        const hit = findOwnedDefaultSlot(c);
        if (hit) return hit;
    }
    return null;
}

/**
 * Hydrate/mount a file-route page inside an optional layout chain (outer → inner).
 * Mirrors SSR `slotHtml` wrapping: each layout's owned default slot becomes the
 * outlet for the next layout or the page. Retains layout instances on `container`
 * so SPA transitions can dispose only the page host.
 * @param {new (props?: object) => any} Page
 * @param {Element} container
 * @param {object} [props]
 * @param {Array<new (props?: object) => any>} [layoutCtors] outer → inner
 * @param {{ preserveState?: boolean | Record<string, unknown>, skipOnMount?: boolean }} [opts]
 */
export async function hydrateRoute(Page, container, props = {}, layoutCtors = [], opts = {}) {
    if (typeof document === 'undefined') {
        throw new Error('vmz:dom hydrateRoute() requires a document (browser)');
    }
    if (container.__vmzInst) {
        destroy(container.__vmzInst);
        container.__vmzInst = null;
    }
    container.__vmzPageHost = null;
    container.__vmzLayoutInsts = null;

    /** @type {object[]} */
    const layoutInsts = [];
    let host = container;
    const ctors = Array.isArray(layoutCtors) ? layoutCtors.filter(Boolean) : [];

    for (const Layout of ctors) {
        const inst = await mount(Layout, host, {});
        layoutInsts.push(inst);
        const slot = findOwnedDefaultSlot(inst.__vmzDomRoot);
        const outlet = document.createElement('div');
        outlet.setAttribute('data-vmz-outlet', '');
        if (slot && slot.parentNode) slot.replaceWith(outlet);
        else if (inst.__vmzDomRoot && typeof inst.__vmzDomRoot.appendChild === 'function') {
            inst.__vmzDomRoot.appendChild(outlet);
        } else {
            host.appendChild(outlet);
        }
        host = outlet;
    }

    const pageInst = await hydrate(Page, host, props, opts);
    container.__vmzPageHost = host;
    container.__vmzLayoutInsts = layoutInsts;
    // Outer layout (or page if no layouts) owns the #app instance for destroy().
    container.__vmzInst = layoutInsts[0] || pageInst;
    return pageInst;
}

/**
 * Mount once; later updates are dep patches only (never re-run structure).
 * Requires compiler `__vmzCreate` (production Direct emit — no blueprint fallback).
 * @param {new (props?: object) => any} Component
 * @param {Element} container
 * @param {object} [props]
 */
export async function mount(Component, container, props = {}) {
    if (container.__vmzInst) {
        destroy(container.__vmzInst);
        container.__vmzInst = null;
    }
    const inst = createInstance(Component, props);
    inst.__vmzBinders = Object.create(null);
    inst.__vmzBindings = Object.create(null);
    inst.__vmzDepToBindings = Object.create(null);
    container.replaceChildren();
    const node = await createFromComponent(Component, inst);
    if (node) {
        inst.__vmzDomRoot = node;
        container.appendChild(node);
    }
    if (typeof inst.onMount === 'function') {
        await inst.onMount();
    }
    await settlePendingChildMounts(inst);
    container.__vmzInst = inst;
    return inst;
}

/**
 * Nested Direct `component` schedules child onMount asynchronously; drain before return
 * so SSR/hydrate callers see post-mount DOM (e.g. UserCard Ada, not Loading…).
 * @param {object} inst
 */
async function settlePendingChildMounts(inst) {
    if (!inst || !Array.isArray(inst.__vmzPendingChildMounts) || !inst.__vmzPendingChildMounts.length) return;
    await Promise.all(inst.__vmzPendingChildMounts);
    inst.__vmzPendingChildMounts = [];
    const hosts = [];
    const root = inst.__vmzDomRoot;
    if (root && root.nodeType === 1) {
        if (root.__vmzInst) hosts.push(root.__vmzInst);
        for (const el of root.querySelectorAll('[data-vmz]')) {
            if (el.__vmzInst) hosts.push(el.__vmzInst);
        }
    }
    for (const child of hosts) {
        await flushPending(child);
        await settlePendingChildMounts(child);
    }
}

/**
 * Direct create only (production Direct emit).
 * @param {new (props?: object) => any} Component
 * @param {object} inst
 */
async function createFromComponent(Component, inst) {
    if (Component && Component.__vmzDirect && typeof Component.__vmzCreate === 'function') {
        return runDirectCreate(Component, inst);
    }
    throw new Error(`vmz:dom mount requires __vmzCreate (Direct); blueprint render() removed (production Direct emit)`);
}

/**
 * @param {new (props?: object) => any} Component
 * @param {object} inst
 */
function runDirectCreate(Component, inst) {
    // Nested component creates (e.g. Button inside parent ifBlock branch) must not
    // leak bindAttr/bindText into the parent's `_branchBinds` / `_itemPatches` sink —
    // that steals numeric BindingIds (0) and corrupts parent deps (density → type).
    const prevInst = directApi._inst;
    const prevBranch = directApi._branchBinds;
    const prevItems = directApi._itemPatches;
    const prevEach = directApi._eachCtx;
    directApi._inst = inst;
    directApi._branchBinds = null;
    directApi._itemPatches = null;
    directApi._eachCtx = null;
    try {
        return Component.__vmzCreate.call(inst, directApi);
    } finally {
        directApi._inst = prevInst;
        directApi._branchBinds = prevBranch;
        directApi._itemPatches = prevItems;
        directApi._eachCtx = prevEach;
    }
}

/**
 * SSR: run the same __vmzCreate schedule against a serialize host (no render).
 * @param {new (props?: object) => any} Component
 * @param {object} inst
 */
function runDirectSerializeTree(Component, inst) {
    serializeApi._inst = inst;
    try {
        return Component.__vmzCreate.call(inst, serializeApi);
    } finally {
        serializeApi._inst = null;
    }
}

/**
 * SSR child onMount: sync `__vmzCreate` cannot await nested mounts.
 * Expand rounds — reuse prior child instances, await newly discovered onMounts, re-emit.
 * @param {new (props?: object) => any} Component
 * @param {object} inst
 */
async function runDirectSerializeTreeWithMounts(Component, inst) {
    /** @type {object[]} */
    let preMounted = [];
    /** @type {any} */
    let tree = null;
    for (let round = 0; round < 32; round++) {
        serializeApi._ssrPreMounted = preMounted;
        serializeApi._ssrPreIdx = 0;
        serializeApi._ssrCollected = [];
        tree = runDirectSerializeTree(Component, inst);
        if (serializeApi._ssrPreIdx !== preMounted.length) {
            throw new Error(`vmz:dom SSR child mount queue desync (used ${serializeApi._ssrPreIdx}, had ${preMounted.length})`);
        }
        const collected = serializeApi._ssrCollected;
        serializeApi._ssrPreMounted = null;
        serializeApi._ssrCollected = null;
        if (!collected.length) return tree;
        for (const child of collected) {
            if (typeof child.onMount === 'function') {
                await child.onMount();
            }
        }
        preMounted = preMounted.concat(collected);
    }
    throw new Error('vmz:dom SSR child onMount expansion exceeded 32 rounds');
}

function serializeOpenTag(node) {
    const tag = node.tag || 'div';
    let attrs = '';
    for (const [k, v] of Object.entries(node.attrs || {})) {
        if (v == null || v === false) continue;
        if (k === 'className') attrs += ` class="${escapeHtml(v)}"`;
        else attrs += ` ${k}="${escapeHtml(v)}"`;
    }
    return { tag, open: `<${tag}${attrs}>` };
}

function flattenSerializeNode(node) {
    if (node == null || node === false) return '';
    if (typeof node === 'string' || typeof node === 'number') return escapeHtml(node);
    if (node.__kind === 'text') return escapeHtml(node.value);
    if (node.__kind === 'frag') {
        return (node.children || []).map(flattenSerializeNode).join('');
    }
    if (node.__kind === 'el') {
        const tag = node.tag || 'div';
        if (tag === 'slot') {
            if (node.__rawHtml != null) return String(node.__rawHtml);
            return (node.children || []).map(flattenSerializeNode).join('');
        }
        const { open } = serializeOpenTag(node);
        if (node.__rawHtml != null) {
            return `${open}${String(node.__rawHtml)}</${tag}>`;
        }
        const inner = (node.children || []).map(flattenSerializeNode).join('');
        return `${open}${inner}</${tag}>`;
    }
    return '';
}

/**
 * Progressive HTML chunks from a serialize tree (same nodes as flattenSerializeNode).
 * @param {any} node
 * @returns {Generator<string, void, void>}
 */
function* streamSerializeChunks(node) {
    if (node == null || node === false) return;
    if (typeof node === 'string' || typeof node === 'number') {
        yield escapeHtml(node);
        return;
    }
    if (node.__kind === 'text') {
        yield escapeHtml(node.value);
        return;
    }
    if (node.__kind === 'frag') {
        for (const c of node.children || []) yield* streamSerializeChunks(c);
        return;
    }
    if (node.__kind === 'el') {
        const tag = node.tag || 'div';
        if (tag === 'slot') {
            if (node.__rawHtml != null) {
                yield String(node.__rawHtml);
                return;
            }
            for (const c of node.children || []) yield* streamSerializeChunks(c);
            return;
        }
        const { open } = serializeOpenTag(node);
        yield open;
        if (node.__rawHtml != null) {
            yield String(node.__rawHtml);
        } else {
            for (const c of node.children || []) yield* streamSerializeChunks(c);
        }
        yield `</${tag}>`;
    }
}

/** Serialize host mirroring directApi — returns virtual nodes, not DOM. */
const serializeApi = {
    /** @type {object | null} */
    _inst: null,
    /** @type {null} */
    _branchBinds: null,
    /** @type {null} */
    _itemPatches: null,
    /** @type {object[] | null} reused child instances from prior SSR mount rounds */
    _ssrPreMounted: null,
    /** @type {number} */
    _ssrPreIdx: 0,
    /** @type {object[] | null} newly created child instances this round */
    _ssrCollected: null,
    /**
     * @param {new (props?: object) => any} Ctor
     * @param {object} resolved
     */
    _ssrChildInstance(Ctor, resolved) {
        const pre = serializeApi._ssrPreMounted;
        if (pre && serializeApi._ssrPreIdx < pre.length) {
            return pre[serializeApi._ssrPreIdx++];
        }
        const child = createInstance(Ctor, resolved);
        if (serializeApi._ssrCollected) serializeApi._ssrCollected.push(child);
        return child;
    },
    el(tag) {
        return {
            __kind: 'el',
            tag: tag || 'div',
            attrs: {},
            children: [],
            appendChild(c) {
                if (c != null) this.children.push(c);
            },
        };
    },
    text(value) {
        return { __kind: 'text', value: value == null ? '' : String(value) };
    },
    frag() {
        return {
            __kind: 'frag',
            children: [],
            appendChild(c) {
                if (c != null) this.children.push(c);
            },
        };
    },
    attr(el, name, value) {
        if (!el || el.__kind !== 'el') return;
        applySerializeAttr(el, name, value);
    },
    on() {
        /* events are no-ops during SSR */
    },
    bindText(inst, bindingId, deps, get, textNode) {
        let raw = '';
        try {
            raw = get.call(inst);
        } catch {
            raw = '';
        }
        textNode.value = String(raw ?? '');
    },
    bindAttr(inst, bindingId, deps, get, el, name) {
        let raw;
        try {
            raw = get.call(inst);
        } catch {
            raw = null;
        }
        applySerializeAttr(el, name, raw);
    },
    bindComponentProp() {
        /* SSR: props already resolved into the child instance at create */
    },
    projectDefaultSlot(hostEl, node) {
        if (!hostEl || node == null) return;
        // serializeApi.component returns a serialize el tree (or island shell).
        const root = hostEl.__kind === 'el' ? hostEl : null;
        const findSlot = (n) => {
            if (!n || n.__kind !== 'el') return null;
            if (n.tag === 'slot' && !(n.attrs && n.attrs.name)) return n;
            for (const c of n.children || []) {
                const hit = findSlot(c);
                if (hit) return hit;
            }
            return null;
        };
        // Prefer searching the component body (first child of host wrapper).
        let slot = null;
        if (root) {
            for (const c of root.children || []) {
                slot = findSlot(c);
                if (slot) break;
            }
            if (!slot) slot = findSlot(root);
        }
        if (slot) {
            slot.__rawHtml = null;
            if (!Array.isArray(slot.children)) slot.children = [];
            // Append — multiple projectDefaultSlot calls must accumulate (SSR).
            // Client path replaces the live <slot> then appends siblings; serialize must push.
            slot.children.push(node);
            return;
        }
        if (root) root.appendChild(node);
    },
    setHtml(el, value) {
        if (!el || el.__kind !== 'el') return;
        el.__rawHtml = value == null ? '' : String(value);
        el.children = [];
    },
    bindHtml(inst, bindingId, deps, get, el) {
        let raw = '';
        try {
            raw = get.call(inst);
        } catch {
            raw = '';
        }
        el.__rawHtml = raw == null ? '' : String(raw);
        el.children = [];
    },
    ifBlock(inst, bindingId, deps, branches) {
        const host = {
            __kind: 'el',
            tag: 'span',
            attrs: { 'data-vmz-if': '' },
            children: [],
            appendChild(c) {
                if (c != null) this.children.push(c);
            },
        };
        let idx = -1;
        for (let i = 0; i < branches.length; i++) {
            const b = branches[i];
            if (!b.cond) {
                idx = i;
                break;
            }
            try {
                if (b.cond.call(inst)) {
                    idx = i;
                    break;
                }
            } catch {
                /* continue */
            }
        }
        if (idx >= 0 && branches[idx].create) {
            const created = branches[idx].create.call(inst, serializeApi);
            if (created) host.children.push(created);
        }
        return host;
    },
    eachBlock(inst, bindingId, deps, spec) {
        const frag = serializeApi.frag();
        let list = [];
        try {
            list = spec.list.call(inst) || [];
        } catch {
            list = [];
        }
        if (!Array.isArray(list)) list = [...list];
        for (let i = 0; i < list.length; i++) {
            const box = { item: list[i], index: i };
            let k = i;
            if (typeof spec.key === 'function') {
                try {
                    k = spec.key.call(inst, box);
                } catch {
                    k = i;
                }
            }
            const dom = spec.createItem.call(inst, serializeApi, box);
            if (dom) {
                // SSR only: serialize key into HTML for hydrate/debug. Direct client does not write this attr.
                if (dom.__kind === 'el') serializeApi.attr(dom, 'data-vmz-key', String(k));
                frag.appendChild(dom);
            }
        }
        return frag;
    },
    component(hostInst, name, props, client) {
        const Ctor = components[name];
        if (!Ctor) throw new Error(`vmz:dom unknown component <${name} />`);
        /** @type {Record<string, any>} */
        const resolved = {};
        for (const [k, v] of Object.entries(props || {})) {
            if (typeof v === 'function' && isEventPropName(k)) continue;
            else if (typeof v === 'function') resolved[k] = v.call(hostInst);
            else resolved[k] = v;
        }
        if (client) {
            // resume: Island SSR includes body + ResumeEntry slice (same Direct schedule).
            const child = serializeApi._ssrChildInstance(Ctor, resolved);
            let body = null;
            if (Ctor.__vmzDirect && typeof Ctor.__vmzCreate === 'function') {
                const prev = serializeApi._inst;
                serializeApi._inst = child;
                try {
                    body = Ctor.__vmzCreate.call(child, serializeApi);
                } finally {
                    serializeApi._inst = prev;
                }
            }
            const state = snapshotInstanceState(child) || {};
            const plan = Ctor.__vmzPlan || null;
            const resume = {
                schema: 'vmz.resume.v0',
                component: name,
                strategy: String(client),
                props: stripFns(resolved),
                state,
                planSchema: plan?.schema || null,
                planRootIds: plan?.root_ids || [],
            };
            /** @type {Record<string, string>} */
            const attrs = {
                'data-vmz': name,
                'data-vmz-island': name,
                'data-vmz-client': String(client),
                'data-vmz-props': JSON.stringify(stripFns(resolved)),
                'data-vmz-resume': JSON.stringify(resume),
            };
            if (isEventEntryStrategy(String(client))) {
                attrs['data-vmz-entry'] = 'event';
            }
            return {
                __kind: 'el',
                tag: 'div',
                attrs,
                children: body ? [body] : [],
                appendChild(c) {
                    if (c != null) this.children.push(c);
                },
            };
        }
        const child = serializeApi._ssrChildInstance(Ctor, resolved);
        if (Ctor.__vmzDirect && typeof Ctor.__vmzCreate === 'function') {
            const prev = serializeApi._inst;
            serializeApi._inst = child;
            try {
                const node = Ctor.__vmzCreate.call(child, serializeApi);
                return {
                    __kind: 'el',
                    tag: 'div',
                    attrs: { 'data-vmz': name },
                    children: node ? [node] : [],
                    appendChild(c) {
                        if (c != null) this.children.push(c);
                    },
                };
            } finally {
                serializeApi._inst = prev;
            }
        }
        throw new Error(`vmz:dom serialize component <${name}> requires __vmzCreate (rebuild child with Direct)`);
    },
};

/** Host API for compiler-emitted `__vmzCreate` (direct path, Program IR B). */
const directApi = {
    /** @type {object | null} */
    _inst: null,
    /** @type {Array<{ deps: string[], fn: => any, bindingId?: number|string|null }> | null} */
    _branchBinds: null,
    /** @type {Array< => void> | null} */
    _itemPatches: null,
    /**
     * Active keyed-each context (/): item binds + event delegation.
     * @type {null | {
     * noteItemBind: (bindingId: number|string|null, deps: string[], fn: => void) => void,
     * needDelegate: (type: string) => void,
     * }}
     */
    _eachCtx: null,
    el(tag) {
        noteDomCreate();
        return document.createElement(tag || 'div');
    },
    text(value) {
        noteDomCreate();
        return document.createTextNode(value == null ? '' : String(value));
    },
    frag() {
        noteDomCreate();
        return document.createDocumentFragment();
    },
    attr(el, name, value) {
        applyDomAttr(el, name, value);
    },
    on(el, type, handler) {
        const inst = directApi._inst;
        if (directApi._eachCtx && typeof handler === 'function') {
            /** @type {Record<string, Function>} */
            const bag = el.__vmzEvt || (el.__vmzEvt = Object.create(null));
            bag[type] = handler;
            directApi._eachCtx.needDelegate(type);
            return;
        }
        el.addEventListener(type, (ev) => {
            // Belt-and-suspenders: form submit must not navigate before handler runs.
            if (type === 'submit' && ev && typeof ev.preventDefault === 'function') {
                ev.preventDefault();
            }
            if (typeof handler === 'function') handler.call(inst, ev);
        });
    },
    /**
     * @param {object} inst
     * @param {number|string|null} bindingId
     * @param {string[]} deps
     * @param {() => any} get
     * @param {Text} textNode
     * @param {{ stable: string[], branches: Array<{ cond?: => any, deps: string[] }> } | null | undefined} [cf]
     */
    bindText(inst, bindingId, deps, get, textNode, cf) {
        wireDirectBind(
            inst,
            bindingId,
            deps,
            get,
            (raw) => {
                textNode.textContent = String(raw ?? '');
            },
            cf,
        );
    },
    /**
     * @param {object} inst
     * @param {number|string|null} bindingId
     * @param {string[]} deps
     * @param {() => any} get
     * @param {Element} el
     * @param {string} name
     * @param {{ stable: string[], branches: Array<{ cond?: => any, deps: string[] }> } | null | undefined} [cf]
     */
    bindAttr(inst, bindingId, deps, get, el, name, cf) {
        wireDirectBind(
            inst,
            bindingId,
            deps,
            get,
            (raw) => {
                if (name === 'class' || name === 'className') {
                    const s = String(raw ?? '');
                    if (s) el.setAttribute('class', s);
                    else if (el.hasAttribute('class')) el.removeAttribute('class');
                } else {
                    applyDomAttr(el, name, raw);
                }
            },
            cf,
        );
    },
    setHtml(el, value) {
        el.innerHTML = value == null ? '' : String(value);
    },
    /**
     * Trusted HTML binding (`html={expr}`). Author/plugin responsibility.
     * @param {object} inst
     * @param {number|string|null} bindingId
     * @param {string[]} deps
     * @param {() => any} get
     * @param {Element} el
     * @param {{ stable: string[], branches: Array<{ cond?: => any, deps: string[] }> } | null | undefined} [cf]
     */
    bindHtml(inst, bindingId, deps, get, el, cf) {
        wireDirectBind(
            inst,
            bindingId,
            deps,
            get,
            (raw) => {
                el.innerHTML = raw == null ? '' : String(raw);
            },
            cf,
        );
    },
    /**
     * Nested component (sync Direct child or island schedule).
     * @param {object} hostInst
     * @param {string} name
     * @param {Record<string, any>} props
     * @param {string | null} client
     */
    component(hostInst, name, props, client) {
        noteDomCreate();
        const host = document.createElement('div');
        host.setAttribute('data-vmz', name);
        /** @type {Record<string, any>} */
        const resolved = {};
        for (const [k, v] of Object.entries(props || {})) {
            if (typeof v === 'function' && isEventPropName(k)) resolved[k] = v;
            else if (typeof v === 'function') resolved[k] = v.call(hostInst);
            else resolved[k] = v;
        }
        if (client) {
            host.setAttribute('data-vmz-island', name);
            host.setAttribute('data-vmz-client', String(client));
            host.setAttribute('data-vmz-props', JSON.stringify(stripFns(resolved)));
            if (isEventEntryStrategy(String(client))) {
                host.setAttribute('data-vmz-entry', 'event');
            }
            // resume: resume on schedule; EventEntry may lazy-load chunk via __vmzLoadComponent.
            scheduleClientOn(host, String(client), async () => {
                const Ctor = await resolveComponent(name);
                if (!Ctor) throw new Error(`vmz:dom unknown component <${name} />`);
                await resume(Ctor, host, { props: resolved, state: {} });
            });
            return host;
        }
        const Ctor = components[name];
        if (!Ctor) throw new Error(`vmz:dom unknown component <${name} />`);
        const child = createInstance(Ctor, resolved);
        if (!(Ctor.__vmzDirect && typeof Ctor.__vmzCreate === 'function')) {
            throw new Error(`vmz:dom direct component <${name}> requires __vmzCreate (rebuild child with Direct)`);
        }
        const node = runDirectCreate(Ctor, child);
        if (node) {
            child.__vmzDomRoot = node;
            host.appendChild(node);
        }
        host.__vmzInst = child;
        if (typeof child.onMount === 'function') {
            const pending = Promise.resolve().then(() => {
                if (!child.__vmzDestroyed) return child.onMount();
            });
            const bag = hostInst.__vmzPendingChildMounts || (hostInst.__vmzPendingChildMounts = []);
            bag.push(pending);
        }
        return host;
    },
    /**
     * Keep nested Direct child props live with parent field writes.
     * @param {object} hostInst
     * @param {HTMLElement} hostEl
     * @param {string} propName
     * @param {string[]} deps
     * @param {() => any} get
     */
    bindComponentProp(hostInst, hostEl, propName, deps, get) {
        // Use a stable BindingId so flushPending schedules this patch via the IR
        // path. A null bindingId only lands in `__vmzBinders` and was skipped when
        // the same parent field also had bindText/bindAttr BindingIds.
        if (hostEl && hostEl.__vmzPropBindSeq == null) {
            hostEl.__vmzPropBindSeq = ++directPropBindSeq;
        }
        const seq = hostEl && hostEl.__vmzPropBindSeq != null ? hostEl.__vmzPropBindSeq : ++directPropBindSeq;
        const bindingId = `pc:${seq}:${propName}`;
        wireDirectBind(hostInst, bindingId, deps, get, (raw) => {
            const child = hostEl && hostEl.__vmzInst;
            if (!child || child.__vmzDestroyed) return;
            if (typeof propName !== 'string' || !propName || propName.startsWith('#')) return;
            child[propName] = raw;
            scheduleRefresh(child, { type: 'replace', root: propName });
        });
    },
    /**
     * Project parent children into nested Direct component default `<slot>`.
     * @param {HTMLElement} hostEl
     * @param {Node} node
     */
    projectDefaultSlot(hostEl, node) {
        if (!hostEl || node == null) return;
        const child = hostEl.__vmzInst;
        const root = (child && child.__vmzDomRoot) || hostEl;
        /** @type {Element | null} */
        let slot = null;
        if (root && root.nodeType === 1) {
            if (String(root.tagName || '').toLowerCase() === 'slot' && !root.getAttribute('name')) {
                slot = root;
            } else if (typeof root.querySelector === 'function') {
                slot = root.querySelector('slot:not([name])');
            }
        }
        if (slot && slot.parentNode) {
            slot.replaceWith(node);
            return;
        }
        if (root && typeof root.appendChild === 'function') root.appendChild(node);
        else hostEl.appendChild(node);
    },
    /**
     * Direct if/else — no blueprint `kind: "if"` dispatch.
     * @param {object} inst
     * @param {number|string|null} bindingId
     * @param {string[]} deps
     * @param {Array<{ cond?: => any, create: (api: typeof directApi) => Node }>} branches
     * @param {number|string|null} [regionId]
     */
    ifBlock(inst, bindingId, deps, branches, regionId = null) {
        noteDomCreate();
        const host = document.createElement('span');
        host.setAttribute('data-vmz-if', '');
        if (regionId != null) host.setAttribute('data-vmz-region', String(regionId));
        /** @type {Array<Node | null>} */
        const cached = branches.map(() => null);
        /** @type {Array<Array<{ deps: string[], fn: => any, bindingId?: number|string|null }>>} */
        const branchBinds = branches.map(() => []);
        let active = -1;
        let gen = 0;

        const pick = () => {
            for (let i = 0; i < branches.length; i++) {
                const b = branches[i];
                if (!b.cond) return i;
                try {
                    if (b.cond.call(inst)) return i;
                } catch {
                    /* continue */
                }
            }
            return -1;
        };

        const wireBranch = (idx) => {
            if (idx < 0) return;
            for (const { deps: d, fn, bindingId: bid } of branchBinds[idx]) {
                registerBind(inst, d, fn, bid);
                try {
                    runPatch(fn, (d && d[0]) || null, bid ?? null);
                } catch (err) {
                    console.error('vmz:dom if branch', err);
                }
            }
        };
        const unwireBranch = (idx) => {
            if (idx < 0) return;
            for (const { deps: d, fn, bindingId: bid } of branchBinds[idx]) {
                unregisterBind(inst, d, fn, bid);
            }
        };

        const apply = () => {
            if (inst.__vmzDestroyed) return;
            const applied = ++gen;
            const next = pick();
            if (next === active) return;

            if (next >= 0 && !cached[next]) {
                const binds = [];
                const prevSink = directApi._branchBinds;
                const prevInst = directApi._inst;
                directApi._branchBinds = binds;
                directApi._inst = inst;
                let created = null;
                try {
                    created = branches[next].create.call(inst, directApi);
                } finally {
                    directApi._branchBinds = prevSink;
                    directApi._inst = prevInst;
                }
                if (applied !== gen || inst.__vmzDestroyed) return;
                if (!cached[next]) {
                    cached[next] = created;
                    branchBinds[next] = binds;
                }
            }
            if (applied !== gen || inst.__vmzDestroyed) return;

            if (active >= 0) {
                unwireBranch(active);
                if (cached[active] && cached[active].parentNode) {
                    noteDomRemove();
                    cached[active].remove();
                }
            }
            active = next;
            if (next < 0) return;
            wireBranch(next);
            if (cached[next]) host.appendChild(cached[next]);
        };

        registerBind(inst, deps || [], apply, bindingId);
        if (directApi._itemPatches) directApi._itemPatches.push(apply);
        // parent destroy disposes all cached branch trees (pause ≠ destroy on switch).
        host.__vmzDispose = () => {
            for (let i = 0; i < cached.length; i++) {
                unwireBranch(i);
                if (cached[i]) disposeDomTree(cached[i]);
                cached[i] = null;
            }
            active = -1;
        };
        apply();
        return host;
    },
    /**
     * Direct keyed each — no blueprint `kind: "each"` dispatch.
     * /: Set/Map + Fragment batch insert; item-local binds; host field dispatch; event delegate.
     * @param {object} inst
     * @param {number|string|null} bindingId
     * @param {string[]} deps
     * @param {{ as?: string, list: => any, key?: (box: {item:any,index:number}) => any, createItem: (api: typeof directApi, box: {item:any,index:number}) => Node }} spec
     * @param {number|string|null} [regionId]
     */
    eachBlock(inst, bindingId, deps, spec, regionId = null) {
        const start = document.createComment(`vmz-each:${spec.as || ''}`);
        const end = document.createComment('/vmz-each');
        if (regionId != null) start.__vmzRegion = regionId;
        const frag = document.createDocumentFragment();
        frag.appendChild(start);
        frag.appendChild(end);

        /** @type {Map<any, { box: { item: any, index: number }, dom: Node, patches: Array< => void> }>} */
        const keyed = new Map();
        let gen = 0;

        /** @type {Map<string, => void>} */
        const listDispatchers = new Map();
        /** @type {Set<string>} */
        const hostDispatchers = new Set();
        /** @type {Record<string, any>} */
        const hostPrev = Object.create(null);
        /** @type {Set<string>} */
        const delegateTypes = new Set();
        /** @type {Record<string, EventListener>} */
        const delegateListeners = Object.create(null);
        /** @type {Element | null} */
        let delegateRoot = null;

        const itemKey = (box) => {
            if (rowKeyField != null && box && box.item != null) {
                return box.item[rowKeyField];
            }
            if (typeof spec.key === 'function') {
                try {
                    return spec.key.call(inst, box);
                } catch {
                    return box.index;
                }
            }
            return box.index;
        };
        /** Reused for keyed lookups — avoid per-row `{item,index}` alloc on create/update. */
        const keyScratch = { item: null, index: 0 };
        const keyOf = (item, index) => {
            keyScratch.item = item;
            keyScratch.index = index;
            return itemKey(keyScratch);
        };

        const readList = () => {
            let list = [];
            try {
                list = spec.list.call(inst) || [];
            } catch {
                list = [];
            }
            if (!Array.isArray(list)) list = [...list];
            return list;
        };

        const runEntryPatches = (entry, depKey, onlyBindingId) => {
            if (!entry) return;
            if (entryIsBp(entry) && applyBp) {
                if (onlyBindingId != null && blueprintBindIds && !blueprintBindIds.has(String(onlyBindingId))) {
                    return;
                }
                try {
                    applyBp(entry);
                } catch (err) {
                    console.error('vmz:dom each item', err);
                }
                return;
            }
            if (!entry.patches) return;
            for (const p of entry.patches) {
                if (onlyBindingId != null) {
                    if (p.__vmzBindingIds) {
                        if (!p.__vmzBindingIds.has(String(onlyBindingId))) continue;
                    } else if (p.__vmzBindingId != null && String(p.__vmzBindingId) !== String(onlyBindingId)) {
                        continue;
                    }
                }
                try {
                    runPatch(p, depKey, onlyBindingId);
                } catch (err) {
                    console.error('vmz:dom each item', err);
                }
            }
        };

        const refreshByListIndex = (onlyBindingId, leafDeps, trie) => {
            const list = readList();
            const allowIdx = itemIndicesAllowedForDeps(trie, leafDeps);
            const runAt = (i) => {
                if (i < 0 || i >= list.length) return;
                const item = list[i];
                const k = rowKeyOf(item, i);
                const entry = keyed.get(k);
                if (!entry) return;
                if (entry.nodeType === 1) entry.__vmzBox = item;
                else {
                    entry.item = item;
                    entry.index = i;
                    if (entry.dom && entry.bp) entry.dom.__vmzBox = item;
                }
                if (entry.patches) tagItemPatches(entry.patches, i);
                runEntryPatches(entry, (leafDeps && leafDeps[0]) || null, onlyBindingId);
            };
            if (allowIdx) {
                for (const idx of allowIdx) runAt(Number(idx));
                return;
            }
            for (let i = 0; i < list.length; i++) runAt(i);
        };

        const refreshHostKeyed = (fields, onlyBindingId) => {
            for (const field of fields) {
                const next = inst[field];
                const prev = hostPrev[field];
                hostPrev[field] = next;
                const todo = [];
                if (prev !== undefined && prev !== null) todo.push(prev);
                if (next !== undefined && next !== null && next !== prev) todo.push(next);
                for (const k of todo) {
                    const entry = keyed.get(k);
                    if (!entry) continue;
                    runEntryPatches(entry, field, onlyBindingId);
                }
            }
        };

        const ensureListDispatcher = (bId, leafDeps) => {
            if (bId == null) return;
            const idKey = String(bId);
            if (listDispatchers.has(idKey)) return;
            const dispatch = () => {
                if (inst.__vmzDestroyed) return;
                const trie = inst.__vmzFlushTrie;
                const hostFields = [];
                let listReplaced = false;
                for (const d of leafDeps || []) {
                    if (!d) continue;
                    if (d.includes('.*') || (d.includes('[') && d.includes(']'))) {
                        const root = depRootField(d);
                        if (trie && root && trie[root] && trie[root].replace) listReplaced = true;
                        continue;
                    }
                    hostFields.push(depRootField(d) || d);
                }
                const hostDirty =
                    !!trie &&
                    hostFields.some((f) => {
                        const n = trie[f];
                        return n && (n.replace || n.dirty);
                    });
                // Full list replace is owned by eachBlock apply() — skip leaf re-walk.
                if (listReplaced && !hostDirty) return;
                if (hostDirty && hostFields.length) {
                    refreshHostKeyed(hostFields, bId);
                    return;
                }
                refreshByListIndex(bId, leafDeps, trie);
            };
            listDispatchers.set(idKey, dispatch);
            registerBind(inst, leafDeps || [], dispatch, bId);
        };

        const ensureHostDispatcher = (field) => {
            if (!field || hostDispatchers.has(field)) return;
            hostDispatchers.add(field);
            const dispatch = () => {
                if (inst.__vmzDestroyed) return;
                refreshHostKeyed([field], null);
            };
            registerBind(inst, [field], dispatch, null);
        };

        const noteItemBind = (bId, bindDeps, fn) => {
            fn.__vmzItemDeps = Array.isArray(bindDeps) ? bindDeps.slice() : [];
            fn.__vmzBindingId = bId;
            const leaf = fn.__vmzItemDeps;
            if (bId != null) {
                // One dispatcher per BindingId also covers bare host fields (e.g. selected).
                ensureListDispatcher(bId, leaf);
                return;
            }
            for (const d of leaf) {
                if (!d) continue;
                if (d.includes('.*') || (d.includes('[') && d.includes(']'))) continue;
                const root = depRootField(d) || d;
                if (root && root.indexOf('.') < 0) ensureHostDispatcher(root);
            }
        };

        const teardownDelegate = () => {
            if (!delegateRoot) return;
            for (const type of Object.keys(delegateListeners)) {
                delegateRoot.removeEventListener(type, delegateListeners[type]);
                delete delegateListeners[type];
            }
            delegateRoot = null;
        };

        const ensureDelegateAttached = () => {
            const parent = end.parentNode;
            if (!parent || parent.nodeType !== 1) return;
            if (delegateRoot && delegateRoot !== parent) teardownDelegate();
            delegateRoot = /** @type {Element} */ (parent);
            for (const type of delegateTypes) {
                if (delegateListeners[type]) continue;
                const listener = (ev) => {
                    if (type === 'submit' && ev && typeof ev.preventDefault === 'function') {
                        ev.preventDefault();
                    }
                    let n = /** @type {Node | null} */ (ev.target);
                    while (n && n !== delegateRoot) {
                        if (n.nodeType === 1) {
                            const el = /** @type {Element} */ (n);
                            const act = el.__vmzAct || el.getAttribute('data-vmz-act');
                            if (typeof act === 'string' && act) {
                                actionHandler(act).call(inst, ev, el);
                                return;
                            }
                            const bag = el.__vmzEvt;
                            if (bag && typeof bag[type] === 'function') {
                                // Pass the element so shared each-item handlers can read __vmzBox.
                                bag[type].call(inst, ev, el);
                                return;
                            }
                        }
                        n = n.parentNode;
                    }
                };
                delegateListeners[type] = listener;
                delegateRoot.addEventListener(type, listener);
            }
        };

        const needDelegate = (type) => {
            if (!type) return;
            delegateTypes.add(type);
            ensureDelegateAttached();
        };

        const eachCtx = { noteItemBind, needDelegate };

        const clearDomEvt = (root) => {
            if (!root || root.nodeType !== 1) return;
            const walk = (node) => {
                if (node.nodeType === 1) {
                    if (node.__vmzEvt) node.__vmzEvt = null;
                    if (node.__vmzBox) node.__vmzBox = null;
                    if (node.__vmzAct) node.__vmzAct = null;
                    if (node.__vmzKey != null) node.__vmzKey = null;
                    for (let c = node.firstChild; c; c = c.nextSibling) walk(c);
                }
            };
            walk(root);
        };

        const pathFromRoot = (root, node) => {
            /** @type {number[]} */
            const path = [];
            let n = /** @type {Node | null} */ (node);
            while (n && n !== root) {
                const parent = n.parentNode;
                if (!parent) return null;
                let i = 0;
                for (let c = parent.firstChild; c; c = c.nextSibling) {
                    if (c === n) break;
                    i++;
                }
                path.push(i);
                n = parent;
            }
            if (n !== root) return null;
            path.reverse();
            return path;
        };

        const nodeAtPath = (root, path) => {
            let n = /** @type {Node | null} */ (root);
            for (let i = 0; i < path.length; i++) {
                if (!n) return null;
                n = n.childNodes[path[i]] || null;
            }
            return n;
        };

        /**
         * Shared each-item event handlers (one per method name for the whole block).
         * Element carries `__vmzBox`; delegate passes the element as 2nd arg.
         * @type {Record<string, (ev: Event, el: Element) => void>}
         */
        const sharedActions = Object.create(null);
        /** @type {Record<string, string>} method → item field for action arg (fallback blueprint). */
        const actionArgFields = Object.create(null);
        const actionHandler = (method) => {
            if (!sharedActions[method]) {
                sharedActions[method] = function (ev, el) {
                    let n = /** @type {Node | null} */ (el);
                    while (n && n.nodeType === 1) {
                        const box = /** @type {Element} */ (n).__vmzBox;
                        if (box) {
                            const item = box.item != null ? box.item : box;
                            const argField =
                                rowActArgField != null ? rowActArgField : actionArgFields[method] != null ? actionArgFields[method] : null;
                            if (argField == null || item == null) return;
                            const arg = item[argField];
                            const fn = this[method];
                            if (typeof fn === 'function') fn.call(this, arg);
                            return;
                        }
                        n = n.parentNode;
                    }
                };
            }
            return sharedActions[method];
        };

        /**
         * @returns {{ method: string, argField: string } | null}
         */
        const parseActionMethod = (handler) => {
            if (typeof handler !== 'function') return null;
            try {
                const src = Function.prototype.toString.call(handler);
                // this.m(box.item.<field>) — field from author surface.
                const m = src.match(/this\.([A-Za-z_$][\w$]*)\s*\(\s*[A-Za-z_$][\w$]*\.item\.([A-Za-z_$][\w$]*)\s*\)/);
                return m ? { method: m[1], argField: m[2] } : null;
            } catch {
                return null;
            }
        };

        /**
         * Row blueprint: first createItem records dynamic slots; later rows clone + hydrate
         * without re-running compiled createItem (avoids per-row get/CF/on closures).
         * @type {null | {
         *   tpl: Element,
         *   texts: Array<{ path: number[], bindingId: any, deps: string[], field: string, get: (root: Element) => Node }>,
         *   attrs: Array<{ path: number[], bindingId: any, deps: string[], name: string, onVal: string, offVal: string, get: (root: Element) => Element }>,
         *   ons: Array<{ path: number[], type: string, method: string, get: (root: Element) => Element }>,
         *   bindIds: Set<string>,
         * }}
         */
        let blueprint = null;
        let blueprintOk = true;
        /** @type {Set<string> | null} */
        let blueprintBindIds = null;
        /** @type {null | ((root: Element, entry: any) => void)} */
        let hydrateBp = null;
        /** @type {null | ((entry: any) => void)} */
        let applyBp = null;
        /**
         * Compile-time rowKernel installed — static HTML rows, no nested component dispose.
         * Shape-specific walks live in emitted hydrate/apply (Rust), not here.
         */
        let hasRowKernel = false;
        /** @type {string | null} item field used as key when rowKernel.keyField is set */
        let rowKeyField = null;
        /** @type {string | null} item field passed to delegated actions (from rowKernel.actArgField) */
        let rowActArgField = null;
        /** Recycle object bp entries (runtime-recorded blueprint fallback). */
        /** @type {any[]} */
        const entryPool = [];
        const allocBpEntry = () => {
            const e = entryPool.pop();
            if (e) return e;
            return { item: null, dom: null, bp: 1, t0: null, t1: null };
        };
        const releaseBpEntry = (entry) => {
            if (!entry) return;
            // DOM-as-entry (Element): drop expandos.
            if (entry.nodeType === 1) {
                entry.__vmzBox = null;
                entry.__vmzT0 = null;
                entry.__vmzT1 = null;
                entry.__vmzBp = null;
                return;
            }
            if (!entry.bp || entryPool.length >= 4096) return;
            entry.item = null;
            entry.dom = null;
            entry.t0 = null;
            entry.t1 = null;
            entry.a0 = null;
            entry.patches = null;
            entryPool.push(entry);
        };
        const entryDom = (entry) => (entry && entry.nodeType === 1 ? entry : entry && entry.dom);
        const entryIsBp = (entry) => !!(entry && (entry.nodeType === 1 || entry.bp || entry.__vmzBp));
        const entryItem = (entry) => {
            if (!entry) return null;
            if (entry.nodeType === 1) return entry.__vmzBox;
            if (entry.bp) return entry.item;
            return entry.box && entry.box.item;
        };
        const rowKeyOf = (item, index) => {
            if (rowKeyField != null && item != null) return item[rowKeyField];
            return keyOf(item, index);
        };
        /** Drop all row DOM between markers; rowKernel rows skip per-node dispose walks. */
        const fastWipeRows = () => {
            const parent = end.parentNode;
            if (!parent) {
                keyed.clear();
                return;
            }
            let node = start.nextSibling;
            if (node && node !== end) {
                if (hasRowKernel || (blueprint && blueprintOk)) {
                    const range = document.createRange();
                    range.setStartBefore(node);
                    range.setEndBefore(end);
                    range.deleteContents();
                } else {
                    while (node && node !== end) {
                        const next = node.nextSibling;
                        noteDomRemove();
                        clearDomEvt(node);
                        disposeDomTree(node);
                        node.remove();
                        node = next;
                    }
                }
            }
            for (const [, entry] of keyed) releaseBpEntry(entry);
            keyed.clear();
        };

        const makeChildGetter = (path) => {
            const len = path.length;
            if (len === 0) return (root) => root;
            if (len === 1) {
                const a = path[0];
                return (root) => root.childNodes[a];
            }
            if (len === 2) {
                const a = path[0];
                const b = path[1];
                return (root) => root.childNodes[a].childNodes[b];
            }
            if (len === 3) {
                const a = path[0];
                const b = path[1];
                const c = path[2];
                return (root) => root.childNodes[a].childNodes[b].childNodes[c];
            }
            return (root) => {
                let n = /** @type {Node} */ (root);
                for (let i = 0; i < len; i++) n = n.childNodes[path[i]];
                return n;
            };
        };

        const userCreateItem = spec.createItem;

        // Compile-time row kernel (Rust Direct emit) — skip runtime blueprint recording.
        if (spec.rowKernel && typeof spec.rowKernel.html === 'string' && typeof spec.rowKernel.hydrate === 'function') {
            try {
                const tplHost = document.createElement('template');
                tplHost.innerHTML = spec.rowKernel.html;
                const row = tplHost.content.firstElementChild;
                if (row && row.nodeType === 1) {
                    blueprint = {
                        tpl: /** @type {Element} */ (row.cloneNode(true)),
                        texts: [],
                        attrs: [],
                        ons: [],
                        bindIds: new Set(),
                    };
                    blueprintOk = true;
                    hasRowKernel = true;
                    rowKeyField = typeof spec.rowKernel.keyField === 'string' && spec.rowKernel.keyField ? spec.rowKernel.keyField : null;
                    rowActArgField =
                        typeof spec.rowKernel.actArgField === 'string' && spec.rowKernel.actArgField ? spec.rowKernel.actArgField : null;
                    blueprintBindIds = new Set(['__vmzRk']);
                    for (const ev of spec.rowKernel.events || []) needDelegate(ev);
                    for (const hf of spec.rowKernel.hostFields || []) {
                        if (typeof hf === 'string' && hf) ensureHostDispatcher(hf);
                    }
                    // Leaf path writes (`rows.0.label`) need `rows.*.label`, not bare `rows.*`.
                    {
                        const listRoot = depRootField((deps && deps[0]) || '') || (deps && deps[0]) || '';
                        if (listRoot) {
                            /** @type {string[]} */
                            const leafDeps = [`${listRoot}.*`];
                            const fields = Array.isArray(spec.rowKernel.itemFields) ? spec.rowKernel.itemFields : [];
                            for (const f of fields) {
                                if (typeof f === 'string' && f) leafDeps.push(`${listRoot}.*.${f}`);
                            }
                            ensureListDispatcher('__vmzRk', leafDeps);
                        }
                    }
                    const rkHydrate = spec.rowKernel.hydrate;
                    const rkApply = spec.rowKernel.apply;
                    hydrateBp = (root, entry) => {
                        const item =
                            entry && typeof entry === 'object' && 'item' in entry && entry.item != null
                                ? entry.item
                                : entry && entry.__vmzBox != null
                                  ? entry.__vmzBox
                                  : entry;
                        rkHydrate.call(inst, root, item);
                    };
                    applyBp = (entry) => {
                        const root = entry && entry.nodeType === 1 ? entry : entry.dom;
                        const item = entry && entry.nodeType === 1 ? entry.__vmzBox : entry.item;
                        if (typeof rkApply === 'function') rkApply.call(inst, root, item);
                    };
                }
            } catch (err) {
                console.error('vmz:dom rowKernel', err);
                blueprint = null;
                blueprintOk = true;
                hasRowKernel = false;
                rowKeyField = null;
                rowActArgField = null;
                hydrateBp = null;
                applyBp = null;
            }
        }

        const probeItemField = (get, box) => {
            const item = box.item;
            if (!item || (typeof item !== 'object' && typeof item !== 'function')) return null;
            let field = null;
            const proxy = new Proxy(item, {
                get(t, p, r) {
                    if (typeof p === 'string' || typeof p === 'symbol') field = String(p);
                    return Reflect.get(t, p, r);
                },
            });
            const prev = box.item;
            box.item = proxy;
            try {
                get.call(inst);
            } catch {
                /* ignore */
            }
            box.item = prev;
            return field;
        };

        /**
         * Probe on/off class strings for `this.<host> === item.<itemField> ? … : …`.
         * Host/item field names come from binding deps — not hardcoded.
         */
        const probeHostItemClass = (get, box, hostField, itemField) => {
            if (!hostField || !itemField) return { onVal: '', offVal: '' };
            const prev = inst[hostField];
            const matchVal = box.item != null ? box.item[itemField] : undefined;
            let onVal = '';
            let offVal = '';
            const quiet = !!inst.__vmzQuiet;
            inst.__vmzQuiet = true;
            try {
                inst[hostField] = matchVal;
                onVal = String(get.call(inst) ?? '');
                // Distinct off value for number / other keys.
                if (typeof matchVal === 'number') {
                    inst[hostField] = matchVal === 0 ? -1 : 0;
                    if (inst[hostField] === matchVal) inst[hostField] = undefined;
                } else {
                    inst[hostField] = matchVal === '' ? '__vmz_off__' : '';
                    if (inst[hostField] === matchVal) inst[hostField] = undefined;
                }
                offVal = String(get.call(inst) ?? '');
            } catch {
                onVal = '';
                offVal = '';
            } finally {
                inst[hostField] = prev;
                inst.__vmzQuiet = quiet;
            }
            return { onVal, offVal };
        };

        const sealBlueprintDispatchers = () => {
            if (!blueprint || blueprintBindIds) return;
            /** @type {Set<string>} */
            const ids = new Set();
            for (const s of blueprint.texts) {
                if (s.bindingId != null) {
                    ids.add(String(s.bindingId));
                    ensureListDispatcher(s.bindingId, s.deps);
                }
            }
            for (const s of blueprint.attrs) {
                if (s.bindingId != null) {
                    ids.add(String(s.bindingId));
                    ensureListDispatcher(s.bindingId, s.deps);
                }
                for (const d of s.deps || []) {
                    if (!d || d.includes('.*') || (d.includes('[') && d.includes(']'))) continue;
                    const rootField = depRootField(d) || d;
                    if (rootField && rootField.indexOf('.') < 0) ensureHostDispatcher(rootField);
                }
            }
            for (const s of blueprint.ons) {
                needDelegate(s.type);
            }
            blueprintBindIds = ids;
            blueprint.bindIds = ids;
            compileBlueprintKernels();
        };

        const compileBlueprintKernels = () => {
            if (!blueprint || hydrateBp) return;
            const textSlots = blueprint.texts;
            const attrSlots = blueprint.attrs;
            const onSlots = blueprint.ons;
            const nText = textSlots.length;
            const nAttr = attrSlots.length;
            const nOn = onSlots.length;

            // Fallback only (no compile-time rowKernel). Field/path walks come from
            // recorded slots — shape-specific kernels belong in row_kernel.rs.
            hydrateBp = (root, entry) => {
                const item = entry && entry.item != null ? entry.item : entry;
                root.__vmzBox = item;
                /** @type {Array<Text>} */
                const textNodes = new Array(nText);
                /** @type {Array<Element>} */
                const attrEls = new Array(nAttr);
                for (let i = 0; i < nText; i++) textNodes[i] = /** @type {Text} */ (textSlots[i].get(root));
                for (let i = 0; i < nAttr; i++) attrEls[i] = attrSlots[i].get(root);
                for (let i = 0; i < nOn; i++) {
                    const el = onSlots[i].get(root);
                    if (!el.getAttribute('data-vmz-act')) {
                        el.setAttribute('data-vmz-act', onSlots[i].method);
                        el.__vmzAct = onSlots[i].method;
                    }
                }
                for (let i = 0; i < nText; i++) {
                    const v = item == null ? '' : item[textSlots[i].field];
                    textNodes[i].nodeValue = v == null ? '' : v + '';
                }
                for (let i = 0; i < nAttr; i++) {
                    const s = attrSlots[i];
                    const el = attrEls[i];
                    const host = s.hostField;
                    const itemKey = s.itemField;
                    if (!host || !itemKey) continue;
                    const hv = inst[host];
                    if (hv != null && item && hv === item[itemKey]) {
                        if (s.name === 'class' || s.name === 'className') el.className = s.onVal;
                        else applyDomAttr(el, s.name, s.onVal);
                    } else if (s.offVal) {
                        if (s.name === 'class' || s.name === 'className') el.className = s.offVal;
                        else applyDomAttr(el, s.name, s.offVal);
                    }
                }
                entry.tn = textNodes;
                entry.ae = attrEls;
                entry.dom = root;
                entry.bp = true;
            };
            applyBp = (entry) => {
                const item = entry.item != null ? entry.item : entry.__vmzBox;
                const textNodes = entry.tn;
                const attrEls = entry.ae;
                for (let i = 0; i < nText; i++) {
                    const v = item == null ? '' : item[textSlots[i].field];
                    textNodes[i].nodeValue = v == null ? '' : v + '';
                }
                for (let i = 0; i < nAttr; i++) {
                    const s = attrSlots[i];
                    const el = attrEls[i];
                    if (!s.hostField || !s.itemField) continue;
                    const raw = item && inst[s.hostField] === item[s.itemField] ? s.onVal : s.offVal;
                    if (s.name === 'class' || s.name === 'className') el.className = raw;
                    else applyDomAttr(el, s.name, raw);
                }
            };
        };

        const wireBlueprintItem = (root, box, patches) => {
            if (!blueprint) return null;
            sealBlueprintDispatchers();
            const entry = {
                item: box.item,
                index: box.index,
                dom: root,
                bp: true,
                t0: null,
                t1: null,
                a0: null,
                tn: null,
                ae: null,
                patches: patches || null,
            };
            hydrateBp(root, entry);
            if (patches) {
                const applyAll = () => applyBp(entry);
                applyAll.__vmzBindingIds = blueprintBindIds;
                applyAll.__vmzBindingId = null;
                applyAll.__vmzItemLocal = true;
                applyAll.__vmzBpEntry = entry;
                patches.push(applyAll);
            }
            return entry;
        };

        const recordFirstItem = (api, box, patches) => {
            /** @type {Element | null} */
            let root = null;
            /** Pending slots keep live node refs — Direct emit binds before appendChild. */
            /** @type {{ texts: any[], attrs: any[], ons: any[] }} */
            const pending = { texts: [], attrs: [], ons: [] };
            let recordFailed = false;

            const recordingApi = Object.assign({}, api, {
                el(tag) {
                    const el = api.el(tag);
                    if (!root) root = el;
                    return el;
                },
                // Capture only — do not wireDirectBind (would orphan first-row binders).
                bindText(i, bindingId, deps, get, textNode, cf) {
                    if (!root) return;
                    // Blueprint recording aborted: fall back to normal wiring for remaining binds.
                    if (recordFailed) {
                        api.bindText(i, bindingId, deps, get, textNode, cf);
                        return;
                    }
                    try {
                        const raw = get.call(inst);
                        if (textNode.nodeType === 3) /** @type {Text} */ (textNode).nodeValue = String(raw ?? '');
                        else textNode.textContent = String(raw ?? '');
                    } catch {
                        /* ignore */
                    }
                    pending.texts.push({
                        node: textNode,
                        bindingId,
                        deps: Array.isArray(deps) ? deps.slice() : [],
                        getFn: get,
                    });
                },
                bindAttr(i, bindingId, deps, get, el, name, cf) {
                    if (!root) return;
                    if (recordFailed) {
                        api.bindAttr(i, bindingId, deps, get, el, name, cf);
                        return;
                    }
                    // Class bind eligible when deps include a bare host field (any name).
                    const hasHostDep = (deps || []).some((d) => d && !d.includes('.*') && !d.includes('[') && String(d).indexOf('.') < 0);
                    if ((name === 'class' || name === 'className') && hasHostDep) {
                        try {
                            const raw = get.call(inst);
                            el.className = raw == null ? '' : String(raw);
                        } catch {
                            /* ignore */
                        }
                        pending.attrs.push({
                            node: el,
                            bindingId,
                            deps: Array.isArray(deps) ? deps.slice() : [],
                            name,
                            getFn: get,
                        });
                    } else {
                        recordFailed = true;
                        api.bindAttr(i, bindingId, deps, get, el, name, cf);
                    }
                },
                on(el, type, handler) {
                    if (recordFailed) {
                        api.on(el, type, handler);
                        return;
                    }
                    const parsed = parseActionMethod(handler);
                    if (parsed && root) {
                        pending.ons.push({
                            node: el,
                            type,
                            method: parsed.method,
                            argField: parsed.argField,
                        });
                        actionArgFields[parsed.method] = parsed.argField;
                        if (rowActArgField == null) rowActArgField = parsed.argField;
                        root.__vmzBox = box;
                        el.__vmzAct = parsed.method;
                        // Attribute survives cloneNode — hydrate skips per-row __vmzAct writes.
                        el.setAttribute('data-vmz-act', parsed.method);
                        needDelegate(type);
                        return;
                    }
                    api.on(el, type, handler);
                    recordFailed = true;
                },
            });

            const dom = userCreateItem.call(inst, recordingApi, box);
            if (!recordFailed && dom && dom.nodeType === 1 && root === dom && (pending.texts.length > 0 || pending.attrs.length > 0)) {
                /** @type {any[]} */
                const texts = [];
                /** @type {any[]} */
                const attrs = [];
                /** @type {any[]} */
                const ons = [];
                for (const p of pending.texts) {
                    const path = pathFromRoot(root, p.node);
                    const field = probeItemField(p.getFn, box);
                    if (!path || !field) {
                        recordFailed = true;
                        break;
                    }
                    texts.push({
                        path,
                        bindingId: p.bindingId,
                        deps: p.deps,
                        field,
                        get: makeChildGetter(path),
                    });
                }
                if (!recordFailed) {
                    for (const p of pending.attrs) {
                        const path = pathFromRoot(root, p.node);
                        if (!path) {
                            recordFailed = true;
                            break;
                        }
                        const hostField = (() => {
                            for (const d of p.deps || []) {
                                if (!d) continue;
                                if (d.includes('.*') || d.includes('[')) continue;
                                if (String(d).indexOf('.') < 0) return String(d);
                            }
                            return null;
                        })();
                        let itemField = null;
                        for (const d of p.deps || []) {
                            if (!d) continue;
                            if (d.includes('.*')) {
                                const m = String(d).match(/\*\.([A-Za-z_$][\w$]*)$/);
                                if (m) itemField = m[1];
                            }
                        }
                        if (!hostField || !itemField) {
                            recordFailed = true;
                            break;
                        }
                        const { onVal, offVal } = probeHostItemClass(p.getFn, box, hostField, itemField);
                        attrs.push({
                            path,
                            bindingId: p.bindingId,
                            deps: p.deps,
                            name: p.name,
                            onVal,
                            offVal,
                            hostField,
                            itemField,
                            get: makeChildGetter(path),
                        });
                    }
                }
                if (!recordFailed) {
                    for (const p of pending.ons) {
                        const path = pathFromRoot(root, p.node);
                        if (!path) {
                            recordFailed = true;
                            break;
                        }
                        ons.push({
                            path,
                            type: p.type,
                            method: p.method,
                            get: makeChildGetter(path),
                        });
                    }
                }
                if (!recordFailed) {
                    const tpl = /** @type {Element} */ (dom.cloneNode(true));
                    clearDomEvt(tpl);
                    blueprint = {
                        tpl,
                        texts,
                        attrs,
                        ons,
                        bindIds: new Set(),
                    };
                }
            }
            if (!blueprint) blueprintOk = false;
            return dom;
        };

        const createItem = (api, box, patches) => {
            if (blueprint && blueprintOk) {
                const root = /** @type {Element} */ (blueprint.tpl.cloneNode(true));
                wireBlueprintItem(root, box, patches);
                return root;
            }
            if (blueprintOk && typeof userCreateItem === 'function') {
                const dom = recordFirstItem(api, box, patches);
                if (blueprint && dom && dom.nodeType === 1) {
                    patches.length = 0;
                    wireBlueprintItem(dom, box, patches);
                }
                return dom;
            }
            return userCreateItem.call(inst, api, box);
        };

        /**
         * Reorder / place item DOM with minimal mutations.
         * - already-correct → no-op
         * - pure 2-node swap → 1–2 insertBefore (common keyed list swap)
         * - append prefix → Fragment insert only new tail
         * - create / replace / complex → Fragment rebuild before `end`
         */
        const reconcileDomOrder = (nextNodes) => {
            const parent = end.parentNode;
            if (!parent) return;

            /** @type {ChildNode[]} */
            const curr = [];
            for (let n = start.nextSibling; n && n !== end; n = n.nextSibling) {
                curr.push(n);
            }

            if (curr.length === nextNodes.length) {
                let same = true;
                for (let i = 0; i < curr.length; i++) {
                    if (curr[i] !== nextNodes[i]) {
                        same = false;
                        break;
                    }
                }
                if (same) return;

                // Fast path: exactly two positions swapped (benchmark swaprows).
                /** @type {number[]} */
                const diff = [];
                for (let i = 0; i < curr.length; i++) {
                    if (curr[i] !== nextNodes[i]) diff.push(i);
                }
                if (diff.length === 2 && curr[diff[0]] === nextNodes[diff[1]] && curr[diff[1]] === nextNodes[diff[0]]) {
                    const a = curr[diff[0]];
                    const b = curr[diff[1]];
                    const aNext = a.nextSibling;
                    const bNext = b.nextSibling;
                    noteDomMove();
                    noteDomMove();
                    if (aNext === b) {
                        parent.insertBefore(b, a);
                    } else if (bNext === a) {
                        parent.insertBefore(a, b);
                    } else {
                        parent.insertBefore(b, aNext);
                        parent.insertBefore(a, bNext);
                    }
                    return;
                }
            }

            // Append-only: existing live prefix unchanged, only new tail detached.
            if (curr.length < nextNodes.length && curr.length > 0) {
                let prefix = true;
                for (let i = 0; i < curr.length; i++) {
                    if (curr[i] !== nextNodes[i]) {
                        prefix = false;
                        break;
                    }
                }
                if (prefix) {
                    const batch = document.createDocumentFragment();
                    for (let i = curr.length; i < nextNodes.length; i++) {
                        batch.appendChild(nextNodes[i]);
                    }
                    parent.insertBefore(batch, end);
                    return;
                }
            }

            // Create / replace / complex reorder: one Fragment write.
            const batch = document.createDocumentFragment();
            for (const dom of nextNodes) {
                if (dom.parentNode) noteDomMove();
                batch.appendChild(dom);
            }
            parent.insertBefore(batch, end);
        };

        const apply = () => {
            if (inst.__vmzDestroyed) return;
            const applied = ++gen;
            const list = readList();
            const n = list.length;

            // Clear all rows.
            if (n === 0) {
                if (keyed.size) fastWipeRows();
                return;
            }

            // Full replace (no key reuse): wipe then fall into fresh create.
            if (keyed.size > 0 && hasRowKernel) {
                let reuse = false;
                for (let i = 0; i < n; i++) {
                    if (keyed.has(rowKeyOf(list[i], i))) {
                        reuse = true;
                        break;
                    }
                }
                if (!reuse) fastWipeRows();
            }

            // Fresh create into empty each: record blueprint once, then clone-only.
            if (keyed.size === 0 && n > 0) {
                const parent = end.parentNode;
                const batch = document.createDocumentFragment();
                let startIdx = 0;
                if (!blueprint || !blueprintOk) {
                    const box0 = { item: list[0], index: 0 };
                    const patches0 = [];
                    const prevPatches = directApi._itemPatches;
                    const prevCtx = directApi._eachCtx;
                    directApi._itemPatches = patches0;
                    directApi._eachCtx = eachCtx;
                    let dom0 = null;
                    try {
                        dom0 = createItem(directApi, box0, patches0);
                    } finally {
                        directApi._itemPatches = prevPatches;
                        directApi._eachCtx = prevCtx;
                    }
                    if (applied !== gen || inst.__vmzDestroyed) return;
                    if (!dom0) return;
                    const k0 = itemKey(box0);
                    if (dom0.nodeType === 1) /** @type {Element} */ (dom0).__vmzKey = k0;
                    // First row may already be blueprint-wired (patches cleared + hydrate).
                    let entry0 = keyed.get(k0);
                    if (!entry0) {
                        if (patches0.length && patches0[0] && patches0[0].__vmzBpEntry) {
                            entry0 = patches0[0].__vmzBpEntry;
                            entry0.patches = patches0;
                        } else if (blueprint && blueprintOk) {
                            entry0 = wireBlueprintItem(/** @type {Element} */ (dom0), box0, patches0);
                        } else {
                            tagItemPatches(patches0, 0);
                            entry0 = { box: box0, dom: dom0, patches: patches0 };
                        }
                        keyed.set(k0, entry0);
                    }
                    batch.appendChild(dom0);
                    startIdx = 1;
                }
                if (blueprint && blueprintOk) {
                    sealBlueprintDispatchers();
                    const tpl = blueprint.tpl;
                    if (hasRowKernel && spec.rowKernel && typeof spec.rowKernel.create === 'function') {
                        // Shape-specific create loop is Rust-emitted (rowKernel.create).
                        // Direct parent.insertBefore (no Fragment). When parent has only the
                        // each markers as children, detach parent for the fill then reattach —
                        // same structural trick as hand-tuned keyed apps (not app-specific).
                        if (parent) {
                            let detached = null;
                            let reinsertAt = null;
                            if (parent.nodeType === 1 && parent.parentNode) {
                                let onlyMarkers = true;
                                for (let c = parent.firstChild; c; c = c.nextSibling) {
                                    if (c !== start && c !== end) {
                                        onlyMarkers = false;
                                        break;
                                    }
                                }
                                if (onlyMarkers) {
                                    detached = parent.parentNode;
                                    reinsertAt = parent.nextSibling;
                                    detached.removeChild(parent);
                                }
                            }
                            spec.rowKernel.create.call(inst, list, startIdx, tpl, keyed, parent, end, rowKeyOf);
                            if (detached) detached.insertBefore(parent, reinsertAt);
                        } else {
                            const hydrate = spec.rowKernel.hydrate;
                            for (let i = startIdx; i < n; i++) {
                                if (applied !== gen || inst.__vmzDestroyed) return;
                                const item = list[i];
                                const root = /** @type {Element} */ (tpl.cloneNode(true));
                                hydrate.call(inst, root, item);
                                const k = rowKeyOf(item, i);
                                root.__vmzKey = k;
                                keyed.set(k, root);
                                batch.appendChild(root);
                            }
                        }
                    } else if (hasRowKernel && hydrateBp) {
                        const hydrate = spec.rowKernel.hydrate;
                        for (let i = startIdx; i < n; i++) {
                            if (applied !== gen || inst.__vmzDestroyed) return;
                            const item = list[i];
                            const root = /** @type {Element} */ (tpl.cloneNode(true));
                            hydrate.call(inst, root, item);
                            const k = rowKeyOf(item, i);
                            root.__vmzKey = k;
                            keyed.set(k, root);
                            batch.appendChild(root);
                        }
                    } else {
                        for (let i = startIdx; i < n; i++) {
                            if (applied !== gen || inst.__vmzDestroyed) return;
                            const item = list[i];
                            const k = keyOf(item, i);
                            const root = /** @type {Element} */ (tpl.cloneNode(true));
                            const entry = {
                                item,
                                index: i,
                                dom: root,
                                bp: true,
                                t0: null,
                                t1: null,
                                a0: null,
                                patches: null,
                            };
                            hydrateBp(root, entry);
                            root.__vmzKey = k;
                            keyed.set(k, entry);
                            batch.appendChild(root);
                        }
                    }
                } else {
                    for (let i = startIdx; i < n; i++) {
                        if (applied !== gen || inst.__vmzDestroyed) return;
                        const box = { item: list[i], index: i };
                        const k = itemKey(box);
                        const patches = [];
                        const prevPatches = directApi._itemPatches;
                        const prevCtx = directApi._eachCtx;
                        directApi._itemPatches = patches;
                        directApi._eachCtx = eachCtx;
                        let dom = null;
                        try {
                            dom = createItem(directApi, box, patches);
                        } finally {
                            directApi._itemPatches = prevPatches;
                            directApi._eachCtx = prevCtx;
                        }
                        if (applied !== gen || inst.__vmzDestroyed) return;
                        if (!dom) continue;
                        tagItemPatches(patches, i);
                        if (dom.nodeType === 1) /** @type {Element} */ (dom).__vmzKey = k;
                        keyed.set(k, { box, dom, patches });
                        batch.appendChild(dom);
                    }
                }
                if (applied !== gen || inst.__vmzDestroyed) return;
                if (parent && batch.firstChild) parent.insertBefore(batch, end);
                if (end.isConnected) ensureDelegateAttached();
                else
                    queueMicrotask(() => {
                        if (!inst.__vmzDestroyed) ensureDelegateAttached();
                    });
                return;
            }

            const seen = new Set();
            /** @type {Node[]} */
            const nextNodes = [];

            for (let i = 0; i < n; i++) {
                if (applied !== gen || inst.__vmzDestroyed) return;
                const item = list[i];
                const k = rowKeyOf(item, i);
                seen.add(k);
                let entry = keyed.get(k);
                if (!entry) {
                    if (hasRowKernel && blueprint && blueprintOk && hydrateBp) {
                        const root = /** @type {Element} */ (blueprint.tpl.cloneNode(true));
                        spec.rowKernel.hydrate.call(inst, root, item);
                        root.__vmzKey = k;
                        keyed.set(k, root);
                        entry = root;
                    } else {
                        const box = { item, index: i };
                        const patches = [];
                        const prevPatches = directApi._itemPatches;
                        const prevCtx = directApi._eachCtx;
                        directApi._itemPatches = patches;
                        directApi._eachCtx = eachCtx;
                        let dom = null;
                        try {
                            dom = createItem(directApi, box, patches);
                        } finally {
                            directApi._itemPatches = prevPatches;
                            directApi._eachCtx = prevCtx;
                        }
                        if (applied !== gen || inst.__vmzDestroyed) return;
                        tagItemPatches(patches, i);
                        if (dom) {
                            if (dom.nodeType === 1) {
                                // Client identity: expando only (see 01 each identity). SSR uses data-vmz-key.
                                /** @type {Element} */ (dom).__vmzKey = k;
                            }
                            entry = { box, dom, patches };
                            keyed.set(k, entry);
                        }
                    }
                } else {
                    const sameItem = entryItem(entry) === item;
                    if (entry.nodeType === 1) {
                        entry.__vmzBox = item;
                    } else if (entry.bp) {
                        entry.item = item;
                        entry.index = i;
                        if (entry.dom) entry.dom.__vmzBox = entry.item;
                    } else {
                        entry.box.item = item;
                        entry.box.index = i;
                        tagItemPatches(entry.patches, i);
                    }
                    // Pure reorder (swap / move) keeps object identity — skip leaf patches.
                    if (!sameItem) {
                        if (entryIsBp(entry) && applyBp) {
                            try {
                                applyBp(entry);
                            } catch (err) {
                                console.error('vmz:dom each item', err);
                            }
                        } else if (entry.patches) {
                            for (const p of entry.patches) runPatch(p, null);
                        }
                    }
                }
                if (entry) nextNodes.push(entryDom(entry));
            }

            if (applied !== gen || inst.__vmzDestroyed) return;

            for (const [k, entry] of [...keyed.entries()]) {
                if (seen.has(k)) continue;
                noteDomRemove();
                const dom = entryDom(entry);
                if (hasRowKernel) {
                    if (dom && dom.parentNode) dom.remove();
                } else {
                    clearDomEvt(dom);
                    disposeDomTree(dom);
                    if (dom && dom.parentNode) dom.remove();
                }
                keyed.delete(k);
                releaseBpEntry(entry);
            }

            reconcileDomOrder(nextNodes);
            // First apply may run while start/end still sit in a DocumentFragment
            // (before mount appends). Defer until connected so clicks work.
            if (end.isConnected) ensureDelegateAttached();
            else
                queueMicrotask(() => {
                    if (!inst.__vmzDestroyed) ensureDelegateAttached();
                });
        };

        registerBind(inst, deps || [], apply, bindingId);
        if (directApi._itemPatches) directApi._itemPatches.push(apply);
        start.__vmzDispose = () => {
            teardownDelegate();
            fastWipeRows();
        };

        const softDeps = [...new Set((deps || []).map((d) => `${depRootField(d)}.*`))];
        const softRefresh = () => {
            if (inst.__vmzDestroyed) return;
            const trie = inst.__vmzFlushTrie;
            const listRoot = depRootField((deps && deps[0]) || '') || '';
            // Full list replace is owned by apply(); soft channel is item/structure churn.
            if (trie && listRoot && trie[listRoot] && trie[listRoot].replace) return;
            const list = readList();
            const softKey = softDeps[0] || `${listRoot}.*`;
            for (let i = 0; i < list.length; i++) {
                const item = list[i];
                const k = rowKeyOf(item, i);
                const entry = keyed.get(k);
                if (!entry) continue;
                if (entryIsBp(entry)) {
                    if (entry.nodeType === 1) entry.__vmzBox = item;
                    else {
                        entry.item = item;
                        entry.index = i;
                        if (entry.dom) entry.dom.__vmzBox = item;
                    }
                    if (applyBp) applyBp(entry);
                    else if (hydrateBp) hydrateBp(entryDom(entry), entry);
                    continue;
                }
                entry.box.item = item;
                entry.box.index = i;
                tagItemPatches(entry.patches, i);
                for (const p of entry.patches) {
                    // Leaf BindingId patches are owned by list/host dispatchers .
                    if (p.__vmzBindingId != null) continue;
                    if (patchHasBindingId(inst, p)) continue;
                    try {
                        runPatch(p, softKey, null);
                    } catch (err) {
                        console.error('vmz:dom each soft', err);
                    }
                }
            }
        };
        registerBind(inst, softDeps, softRefresh, null);
        apply();
        return frag;
    },
};

/**
 * @param {object} inst
 * @param {string[]} deps
 * @param {() => any} fn
 * @param {number|string|null|undefined} bindingId
 */
function trackDirectBind(inst, deps, fn, bindingId = null) {
    if (directApi._branchBinds) {
        directApi._branchBinds.push({ deps, fn, bindingId });
        if (directApi._itemPatches) directApi._itemPatches.push(fn);
        return;
    }
    // item binds stay on entry.patches; eachBlock registers one dispatcher per BindingId.
    if (directApi._itemPatches) {
        fn.__vmzItemLocal = true;
        directApi._itemPatches.push(fn);
        if (directApi._eachCtx) {
            directApi._eachCtx.noteItemBind(bindingId, deps || [], fn);
        }
        return;
    }
    registerBind(inst, deps, fn, bindingId);
}

/**
 * @param {object} inst
 * @param {number|string|null} bindingId
 * @param {string[]} deps
 * @param {() => any} get
 * @param {(raw: any) => void} write
 * @param {{ stable: string[], branches: Array<{ cond?: => any, deps: string[] }> } | null | undefined} [cf]
 */
function wireDirectBind(inst, bindingId, deps, get, write, cf) {
    let activeBranch = -1;
    /** @type {string[]} */
    let liveDeps = Array.isArray(deps) ? deps.slice() : [];

    const pickCf = () => {
        if (!cf || !Array.isArray(cf.branches)) return -1;
        for (let i = 0; i < cf.branches.length; i++) {
            const b = cf.branches[i];
            if (!b.cond) return i;
            try {
                if (b.cond.call(inst)) return i;
            } catch {
                /* continue */
            }
        }
        return cf.branches.length - 1;
    };

    // Item-local CF whose branches only gate the same stable deps: skip branch switching.
    let simpleCf = false;
    if (cf && Array.isArray(cf.branches) && directApi._itemPatches) {
        simpleCf = cf.branches.every((b) => !b.deps || b.deps.length === 0);
    }

    const apply = () => {
        if (precision.enabled) {
            precision.bindingEvals++;
            for (const d of liveDeps || []) bumpMap(precision.bindingEvalsByDep, d);
            if (bindingId != null) {
                bumpMap(precision.bindingEvalsByBinding, String(bindingId));
            }
        }
        let raw;
        try {
            raw = get.call(inst);
        } catch {
            raw = null;
        }
        write(raw);
        if (!cf || !Array.isArray(cf.branches) || simpleCf || apply.__vmzItemLocal) return;
        const next = pickCf();
        if (next === activeBranch) return;
        activeBranch = next;
        const branch = cf.branches[next];
        const nextDeps = [...(cf.stable || []), ...((branch && branch.deps) || [])];
        const uniq = [...new Set(nextDeps)];
        unregisterBind(inst, liveDeps, apply, bindingId);
        liveDeps = uniq;
        registerBind(inst, liveDeps, apply, bindingId);
    };

    if (cf && Array.isArray(cf.branches) && !simpleCf) {
        activeBranch = pickCf();
        const branch = cf.branches[activeBranch];
        liveDeps = [...(cf.stable || []), ...((branch && branch.deps) || [])];
        liveDeps = [...new Set(liveDeps)];
    } else if (cf && Array.isArray(cf.branches) && simpleCf) {
        liveDeps = Array.isArray(cf.stable) && cf.stable.length ? cf.stable : liveDeps;
    }
    // Mark before first apply so CF branch switches never hit global registerBind.
    if (directApi._itemPatches) apply.__vmzItemLocal = true;
    apply();
    trackDirectBind(inst, liveDeps, apply, bindingId);
}

function isEventPropName(name) {
    return typeof name === 'string' && /^on[A-Z]/.test(name);
}

/** Monotonic id for `bindComponentProp` BindingIds (per process). */
let directPropBindSeq = 0;

/** HTML boolean attributes: presence means true; `false`/`null` must remove the attr. */
const BOOLEAN_HTML_ATTRS = new Set([
    'disabled',
    'checked',
    'selected',
    'readonly',
    'required',
    'multiple',
    'hidden',
    'autofocus',
    'autoplay',
    'controls',
    'loop',
    'muted',
    'open',
    'novalidate',
    'formnovalidate',
    'defer',
    'async',
    'ismap',
    'default',
    'inert',
]);

/**
 * @param {Element} el
 * @param {string} name
 * @param {any} value
 */
function applyDomAttr(el, name, value) {
    const key = name === 'className' ? 'class' : name;
    if (BOOLEAN_HTML_ATTRS.has(String(key).toLowerCase())) {
        if (value === false || value == null || value === '') {
            el.removeAttribute(key);
        } else {
            el.setAttribute(key, value === true ? '' : String(value));
        }
        return;
    }
    if (value == null || value === false) el.removeAttribute(key);
    else el.setAttribute(key, value === true ? '' : String(value));
}

/**
 * Serialize-tree attr write (SSR).
 * @param {any} el
 * @param {string} name
 * @param {any} value
 */
function applySerializeAttr(el, name, value) {
    if (!el || el.__kind !== 'el') return;
    const key = name === 'className' ? 'class' : name;
    if (BOOLEAN_HTML_ATTRS.has(String(key).toLowerCase())) {
        if (value === false || value == null || value === '') delete el.attrs[key];
        else el.attrs[key] = value === true ? '' : String(value);
        return;
    }
    if (value == null || value === false) delete el.attrs[key];
    else el.attrs[key] = value === true ? '' : String(value);
}

function stripFns(obj) {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [k, v] of Object.entries(obj || {})) {
        if (typeof v === 'function') continue;
        out[k] = v;
    }
    return out;
}

/**
 * Marker range host for Direct eachBlock (insert before end comment).
 * @param {Comment} start
 * @param {Comment} end
 */
function eachHostApi(start, end) {
    return {
        insert(dom) {
            if (dom.parentNode) noteDomMove();
            end.parentNode.insertBefore(dom, end);
        },
        childrenBetween() {
            const out = [];
            let n = start.nextSibling;
            while (n && n !== end) {
                if (n.nodeType === 1) out.push(n);
                n = n.nextSibling;
            }
            return out;
        },
    };
}

/**
 * Snapshot plain state/prop field values for Island HMR (session).
 * @param {object} inst
 * @returns {Record<string, unknown> | null}
 */
export function snapshotInstanceState(inst) {
    if (!inst || inst.__vmzDestroyed) return null;
    const Ctor = inst.constructor;
    const keys = [...(Ctor.__vmzState || []), ...(Ctor.__vmzProps || [])];
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const key of keys) {
        if (!key || String(key).startsWith('__')) continue;
        try {
            out[key] = inst[key];
        } catch {
            /* ignore accessors that throw */
        }
    }
    return out;
}

/**
 * @param {object} inst
 * @param {Record<string, unknown> | null | undefined} state
 */
export function applyPreservedState(inst, state) {
    if (!inst || !state) return;
    for (const [key, value] of Object.entries(state)) {
        try {
            inst[key] = value;
        } catch {
            /* ignore */
        }
    }
}

/**
 * resume: attach to existing Island DOM without re-running construct structure or onMount.
 * Consumes ResumeEntry product (`data-vmz-resume`) derived from the same Execution Plan.
 * @param {new (props?: object) => any} Component
 * @param {HTMLElement} container
 * @param {{ props?: object, state?: Record<string, unknown>, strategy?: string } | null} [slice]
 */
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

    const props = parsed.props || {};
    const inst = createInstance(Component, props);
    if (parsed.state) applyPreservedState(inst, parsed.state);
    // Intentionally never call onMount — SSR already completed that work.

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

/**
 * Resume all `[data-vmz-island]` hosts (prefer ResumeEntry / EventEntry over mount).
 * Event strategy islands wait for the DOM event before attach (lazy EventEntry).
 * @param {ParentNode} [root]
 */
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
                console.error(`vmz:dom resume: unknown component ${name}`);
                return;
            }
            await resume(Ctor, el);
        });
    }
}

/**
 * EventEntry attach: only wire `client:event` / `client:event:*` islands.
 * Idle/load/visible ResumeEntries are left alone (static shell can defer framework work).
 * @param {ParentNode} [root]
 */
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
                console.error(`vmz:dom EventEntry: unknown component ${name}`);
                return;
            }
            await resume(Ctor, el);
        });
    }
}

/**
 * Adopt existing Island DOM while running the same `__vmzCreate` schedule (resume).
 * @param {new (props?: object) => any} Component
 * @param {object} inst
 * @param {Element} container
 */
function runDirectResume(Component, inst, container) {
    const rootEl = [...container.childNodes].find((n) => n.nodeType === 1 || (n.nodeType === 3 && String(n.textContent).trim() !== ''));
    if (!rootEl || rootEl.nodeType !== 1) {
        return runDirectCreate(Component, inst);
    }
    let textI = 0;
    const api = {
        _inst: inst,
        _branchBinds: null,
        _itemPatches: null,
        el(tag) {
            if (String(rootEl.tagName).toLowerCase() !== String(tag).toLowerCase()) {
                noteDomCreate();
                return document.createElement(tag);
            }
            return rootEl;
        },
        frag() {
            return document.createDocumentFragment();
        },
        text(s) {
            while (textI < rootEl.childNodes.length) {
                const n = rootEl.childNodes[textI++];
                if (n.nodeType === 3) {
                    if (s != null && s !== '') n.textContent = String(s);
                    return n;
                }
            }
            noteDomCreate();
            return document.createTextNode(String(s ?? ''));
        },
        attr(el, name, value) {
            applyDomAttr(el, name, value);
        },
        on(el, type, handler) {
            el.addEventListener(type, handler);
        },
        bindText: directApi.bindText,
        bindAttr: directApi.bindAttr,
        bindComponentProp: directApi.bindComponentProp,
        projectDefaultSlot: directApi.projectDefaultSlot,
        setHtml: directApi.setHtml,
        bindHtml: directApi.bindHtml,
        ifBlock: directApi.ifBlock,
        eachBlock: directApi.eachBlock,
        component: directApi.component,
    };
    return Component.__vmzCreate.call(inst, api);
}

/**
 * @param {new (props?: object) => any} Component
 * @param {HTMLElement} container
 * @param {object} [props]
 * @param {{ preserveState?: boolean | Record<string, unknown>, skipOnMount?: boolean }} [opts]
 */
export async function hydrate(Component, container, props = {}, opts = {}) {
    if (typeof document === 'undefined') {
        throw new Error('vmz:dom hydrate() requires a document (browser)');
    }

    /** @type {Record<string, unknown> | null} */
    let preserved = null;
    if (opts.preserveState && typeof opts.preserveState === 'object') {
        preserved = opts.preserveState;
    } else if (opts.preserveState === true && container.__vmzInst) {
        preserved = snapshotInstanceState(container.__vmzInst);
    }

    if (container.__vmzInst) {
        destroy(container.__vmzInst);
        container.__vmzInst = null;
    }
    const inst = createInstance(Component, props);
    if (preserved) {
        applyPreservedState(inst, preserved);
    }

    // production Direct emit: hydrate uses the same Direct schedule as resume (no render).
    if (!(Component && Component.__vmzDirect && typeof Component.__vmzCreate === 'function')) {
        throw new Error(`vmz:dom hydrate() requires __vmzCreate (Direct); blueprint render() removed (production Direct emit)`);
    }

    // Wire DOM + events BEFORE awaiting onMount. SSR shell is already visible; if we
    // wait on RPC/bootstrap first, buttons look real but have no listeners (dead UI).
    // onMount may still patch state / redirect afterwards (same end state as SSR order).
    if (!hasMeaningfulChild(container)) {
        const node = runDirectCreate(Component, inst);
        if (node) {
            inst.__vmzDomRoot = node;
            container.appendChild(node);
        }
    } else {
        // Interim: shallow resume leaves if/each binders unbound. Recreate against live
        // DOM so patches attach. Leaf nodeIdentity (same Element) remains TODO for deep adopt.
        container.replaceChildren();
        const node = runDirectCreate(Component, inst);
        if (node) {
            inst.__vmzDomRoot = node;
            container.appendChild(node);
        }
    }
    await settlePendingChildMounts(inst);
    container.__vmzInst = inst;

    const runMount = opts.skipOnMount !== true && !preserved && typeof inst.onMount === 'function';
    if (runMount) {
        await inst.onMount();
    }
    return inst;
}

/**
 * Tear down binders and stop patches. Safe to call more than once.
 * Field writes after destroy no longer update DOM (values may still change).
 *: also dispose owned DOM trees (child __vmzInst / region __vmzDispose).
 * @param {object} inst
 */
export function destroy(inst) {
    if (!inst || inst.__vmzDestroyed) return;
    inst.__vmzDestroyed = true;
    inst.__vmzFlushScheduled = false;
    // async cancel: abort in-flight tasks before tearing down DOM.
    __vmzCancelTasks(inst);
    if (inst.__vmzDomRoot) {
        disposeDomTree(inst.__vmzDomRoot);
        inst.__vmzDomRoot = null;
    }
    if (inst.__vmzDirtyNotices) inst.__vmzDirtyNotices.length = 0;
    if (inst.__vmzDirtyTrie) inst.__vmzDirtyTrie = Object.create(null);
    if (inst.__vmzDirty) inst.__vmzDirty.clear();
    inst.__vmzBinders = Object.create(null);
    inst.__vmzBindings = Object.create(null);
    inst.__vmzDepToBindings = Object.create(null);
    if (typeof inst.onDestroy === 'function') {
        try {
            inst.onDestroy();
        } catch (err) {
            console.error('vmz:dom onDestroy', err);
        }
    }
}

/**
 *: walk a DOM subtree and run lifetime dispose hooks + nested instance destroy.
 * Does not mark the *calling* parent destroyed; safe from destroy(inst).
 * @param {Node | null | undefined} root
 */
export function disposeDomTree(root) {
    if (!root) return;
    const seen = new Set();
    const visit = (node) => {
        if (!node || seen.has(node)) return;
        seen.add(node);
        if (typeof node.__vmzDispose === 'function') {
            try {
                node.__vmzDispose();
            } catch (err) {
                console.error('vmz:dom __vmzDispose', err);
            }
            node.__vmzDispose = null;
        }
        if (node.__vmzInst) {
            const child = node.__vmzInst;
            node.__vmzInst = null;
            destroy(child);
        }
        let child = node.firstChild;
        while (child) {
            const next = child.nextSibling;
            visit(child);
            child = next;
        }
    };
    visit(root);
}

/**
 * @param {ParentNode} [root]
 */
export function hydrateIslands(root = globalThis.document) {
    // resume: hydrateIslands is an alias for resumeIslands (same Plan attach).
    return resumeIslands(root);
}

export function scheduleClient(strategy, fn) {
    scheduleClientOn(null, strategy, fn);
}

/** @param {string} strategy */
function isEventEntryStrategy(strategy) {
    const s = String(strategy || '');
    return s === 'event' || s.startsWith('event:') || s === 'click';
}

/** @param {string} strategy */
function eventEntryType(strategy) {
    const s = String(strategy || 'event');
    if (s.startsWith('event:')) return s.slice(6) || 'click';
    if (s === 'click') return 'click';
    return 'click';
}

function scheduleClientOn(el, strategy, fn) {
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

/**
 * AsyncTask cancel protocol (first slice): keyed generation + AbortSignal.
 * Superseded runs and `destroy(inst)` abort prior work; stale results must not apply.
 * @param {object} inst
 * @param {string} key
 * @param {(signal: AbortSignal, meta: { generation: number }) => any | Promise<any>} fn
 * @returns {Promise<any>}
 */
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
    /** @type {{ generation: number, controller: any, status: string, result?: any, error?: any, promise?: Promise<any> }} */
    const entry = {
        generation,
        controller,
        status: 'pending',
    };
    inst.__vmzTasks[k] = entry;

    // Invoke synchronously so event handlers can call preventDefault before
    // the browser continues the default action (form submit → native navigation).
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

/** Abort all keyed tasks on an instance (also called from destroy). */
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

/** @returns {'pending'|'success'|'error'|'cancelled'|null} */
export function __vmzTaskStatus(inst, key) {
    const t = inst?.__vmzTasks?.[String(key || 'default')];
    return t ? t.status : null;
}

function createInstance(Component, props = {}) {
    if (precision.enabled) precision.componentExecs++;
    const inst = new Component(props || {});
    if (typeof inst.__vmzApplyProps === 'function' && !Component.__vmzCtorAppliesProps) {
        inst.__vmzApplyProps(props || {});
    }
    inst.__vmzBinders = Object.create(null);
    inst.__vmzBindings = Object.create(null);
    inst.__vmzDepToBindings = Object.create(null);
    makeReactive(inst, Component.__vmzState || []);
    makeReactive(inst, Component.__vmzProps || []);
    // WriteBarrier: path / array writes call Component helpers (no import needed).
    Component.__vmzWritePath = __vmzWritePath;
    Component.__vmzWritePathLogical = __vmzWritePathLogical;
    Component.__vmzReadPath = __vmzReadPath;
    Component.__vmzArrayMutate = __vmzArrayMutate;
    Component.__vmzAllowShared = __vmzAllowShared;
    Component.__vmzTakeShared = __vmzTakeShared;
    return inst;
}

/** Shared plain-object owners under WriteBarrier (no Proxy). */
const wbSharedOwners = new WeakMap();
/** Objects explicitly marked OK to share across component instances (13 ). */
const wbAllowShared = new WeakSet();
/** @type {Array<{ kind: string, message: string }>} */
const wbCrossComponentDiags = [];

/**
 * Mark a plain object as intentionally shared across ownership boundaries.
 * @param {any} value
 */
export function __vmzAllowShared(value) {
    if (value != null && typeof value === 'object') wbAllowShared.add(value);
    return value;
}

/**
 * Take exclusive ownership intent: clear multi-owner registry for this object.
 * Subsequent field assigns re-register from the assigning instance only.
 * @param {any} value
 */
export function __vmzTakeShared(value) {
    if (value != null && typeof value === 'object') {
        wbSharedOwners.delete(value);
        wbAllowShared.delete(value);
    }
    return value;
}

/**
 * @returns {Array<{ kind: string, message: string }>}
 */
export function __vmzSharedCrossComponentDiagnostics() {
    return wbCrossComponentDiags.slice();
}

export function __vmzSharedCrossComponentDiagnosticsReset() {
    wbCrossComponentDiags.length = 0;
}

/**
 * @param {any} value
 * @param {(segs: string[] | null) => void} report
 * @param {string[]} baseSegs
 * @param {any} [inst]
 */
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
    // Cross-component share without explicit allow → diagnose (13 ).
    if (!wbAllowShared.has(value) && inst) {
        const other = entry.owners.find((o) => o.inst && o.inst !== inst);
        if (other) {
            if (!wbCrossComponentDiags.some((d) => d.message === msg)) {
                wbCrossComponentDiags.push({ kind: 'shared_cross_component', message: msg });
            }
        }
    }
}

/**
 * Notify all registered owners of a shared plain object after a barrier write.
 * @param {any} rootObj field-root value that was written under
 * @param {string[] | null} localSegs path under that object (null = replace)
 * @returns {boolean} true when at least one owner was notified
 */
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

/**
 * Read a nested path under a field root (for compound / update expansion).
 * @param {any} inst
 * @param {string} root
 * @param {string[]} segs
 */
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

/**
 * Short-circuit logical path assign (`||=` / `&&=` / `??=`).
 * @param {any} inst
 * @param {string} root
 * @param {string[]} segs
 * @param {'||'|'&&'|'??'} kind
 * @param {any} rhs
 */
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

/**
 * Mutates a plain owned object/array and schedules the same path notice Proxy would.
 *
 * Root-array index assigns (`tags[0] = x`) notify as field replace (structural),
 * matching the transitional Proxy wrapArray behavior.
 * Shared multi-owner: writing through one field notifies all owners of the same raw object.
 *
 * @param {any} inst
 * @param {string} root field root
 * @param {string[]} segs path under root (non-empty); dynamic indices already String(...)'d
 * @param {any} value
 */
export function __vmzWritePath(inst, root, segs, value) {
    if (!inst || inst.__vmzDestroyed) return value;
    if (!root || !Array.isArray(segs) || segs.length === 0) return value;
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
        scheduleRefresh(inst, { type: 'path', root, segs: normSegs.slice() });
    }
    return value;
}

/**
 * Compiler-inserted array mutator barrier (push/pop/splice/…).
 * Applies the mutator on the plain array and schedules a structural notice
 * at `root` + `baseSegs` (empty baseSegs → field replace).
 *
 * @param {any} inst
 * @param {string} root
 * @param {string[]} baseSegs
 * @param {string} method
 * @param {any[]} args
 */
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

function makeReactive(inst, stateKeys) {
    const barrier = !!inst.constructor.__vmzWriteBarrier;
    for (const key of stateKeys) {
        if (!key || key.startsWith('#')) continue;
        const desc = Object.getOwnPropertyDescriptor(inst, key);
        if (desc && desc.set && desc.get && !desc.writable) continue;
        /** @param {string[] | null} segs null/empty → replace field */
        const report = (segs) => {
            if (!segs || segs.length === 0) {
                scheduleRefresh(inst, { type: 'replace', root: key });
            } else {
                scheduleRefresh(inst, { type: 'path', root: key, segs });
            }
        };
        // WriteBarrier components keep plain objects — nested writes go through __vmzWritePath.
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

/** Targets already wrapped: raw|proxy|barrier → { proxy, owners[], kind }. */
const reactiveProxies = new WeakMap();

/** Plain objects using defineProperty write barriers (not Proxy). */
const writeBarrierOwned = new WeakSet();

/**
 * WriteBarrier: true when value is an owned plain object with path barriers (no Proxy).
 * @param {any} value
 */
export function __vmzIsWriteBarrierOwned(value) {
    return writeBarrierOwned.has(value);
}

/**
 * True when value is the Proxy wrapper from array (or residual) reactive wrap.
 * @param {any} value
 */
export function __vmzIsReactiveProxy(value) {
    const e = reactiveProxies.get(value);
    return !!(e && e.kind === 'proxy' && e.proxy === value);
}

const ARRAY_MUTATORS = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin']);

/**
 * @typedef {{ report: (segs: string[] | null) => void, baseSegs: string[] }} ReactiveOwner
 * @typedef {{ proxy: object, owners: ReactiveOwner[], kind: 'barrier'|'proxy' }} ReactiveEntry
 */

function sameSegs(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

/**
 * @param {ReactiveEntry} entry
 * @param {(segs: string[] | null) => void} report
 * @param {string[]} baseSegs
 */
function addOwner(entry, report, baseSegs) {
    if (entry.owners.some((o) => o.report === report && sameSegs(o.baseSegs, baseSegs))) {
        return;
    }
    entry.owners.push({
        report,
        baseSegs: baseSegs.slice(),
    });
}

/**
 * @param {ReactiveOwner[]} owners
 * @param {string[] | null} localSegs null = structural replace of this node
 */
function notifyOwners(owners, localSegs) {
    for (const o of owners) {
        if (localSegs == null) {
            o.report(o.baseSegs.length ? o.baseSegs.slice() : null);
        } else {
            o.report([...o.baseSegs, ...localSegs]);
        }
    }
}

/**
 * Field-owned write traps for plain objects / arrays on state fields.
 * Plain objects: WriteBarrier via defineProperty (no Proxy).
 * Arrays: transitional Proxy tracks list identity/mutators only; elements stay plain
 * (no per-item wrap on large assign — nested notifies via `__vmzWritePath`).
 * Shared raw objects notify **all** current owners.
 *
 * @param {any} value
 * @param {(segs: string[] | null) => void} report
 * @param {string[]} pathSegs path under the field root to this value
 */
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

/**
 * Path-level write barrier for owned plain objects (no Proxy).
 */
function wrapOwnedObject(obj, report, pathSegs) {
    const existing = reactiveProxies.get(obj);
    if (existing) {
        addOwner(existing, report, pathSegs);
        return existing.proxy;
    }

    /** @type {ReactiveEntry} */
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

/**
 * @param {object} obj
 * @param {string} prop
 * @param {ReactiveEntry} entry
 */
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

/**
 * Transitional array Proxy: track list identity / mutators only.
 * Elements stay plain — no per-item defineProperty on `this.rows = largeArray`
 * (design: WriteBarrier / list replace must not wrap 1k items). Nested field
 * notifies go through `__vmzWritePath` or whole-array replace.
 */
function wrapArray(arr, report, pathSegs) {
    const existing = reactiveProxies.get(arr);
    if (existing) {
        addOwner(existing, report, pathSegs);
        return existing.proxy;
    }

    /** @type {ReactiveEntry} */
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

/**
 * Coalesce field/path patches in the same turn via a dirty path trie.
 * Still precise deps — never a full-tree re-render. Flush runs as a microtask;
 * call `await flushPending(inst)` to apply synchronously (tests / immediate UI).
 *
 *
 * @param {object} inst
 * @param {{ type: 'replace', root: string } | { type: 'path', root: string, segs: string[] } | string} notice
 * string form is transitional field-root alias for replace.
 */
function scheduleRefresh(inst, notice) {
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
    if (inst.__vmzFlushScheduled) return;
    inst.__vmzFlushScheduled = true;
    queueMicrotask(() => {
        inst.__vmzFlushScheduled = false;
        Promise.resolve(flushPending(inst)).catch((err) => console.error('vmz:dom flush', err));
    });
}

/**
 * @param {Record<string, any>} trie
 * @param {{ type: string, root: string, segs?: string[] }} notice
 */
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

/** @param {object} inst */
export async function flushPending(inst) {
    if (!inst || inst.__vmzDestroyed) return;
    inst.__vmzFlushScheduled = false;
    let guard = 0;
    while (
        !inst.__vmzDestroyed &&
        ((inst.__vmzDirtyTrie && Object.keys(inst.__vmzDirtyTrie).length > 0) ||
            (inst.__vmzDirtyNotices && inst.__vmzDirtyNotices.length > 0)) &&
        guard++ < 64
    ) {
        const trie = inst.__vmzDirtyTrie || Object.create(null);
        inst.__vmzDirtyTrie = Object.create(null);
        if (inst.__vmzDirtyNotices) inst.__vmzDirtyNotices.length = 0;
        inst.__vmzFlushTrie = trie;

        const jobs = [];
        // Prefer BindingId scheduling (IR). String `__vmzBinders` is adapter-only.
        // Pass `trie` into refresh — dirty map is cleared above before patches run.
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
            if (jobs.length) await Promise.all(jobs);
        } finally {
            inst.__vmzFlushTrie = null;
        }
    }
}

/**
 * @param {object} inst
 * @param {Record<string, any>} trie
 * @returns {Array<number|string>}
 */
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

/**
 * @param {object} inst
 * @param {Record<string, any>} trie
 * @returns {string[]}
 */
function binderKeysMatchingTrie(inst, trie) {
    const binders = inst.__vmzBinders;
    if (!binders) return [];
    const out = [];
    for (const key of Object.keys(binders)) {
        if (depMatchesTrie(trie, key)) out.push(key);
    }
    return out;
}

/**
 * @param {Record<string, any>} trie
 * @param {string} key
 */
function depMatchesTrie(trie, key) {
    const root = depRootField(key);
    const node = trie[root];
    if (!node) return false;
    if (node.replace) {
        return key === root || key === `${root}.*` || key.startsWith(`${root}.`) || key.startsWith(`${root}[`);
    }
    if (key === `${root}.*`) {
        // Bare `field.*` soft/structure channel: item replace / array structure only —
        // NOT deep leaf writes (`tags.0.label`); those use `tags.*.label` BindingId.
        return structureStarMatches(node);
    }
    // Bare field: replace-only.
    if (key === root) return false;

    // Path channel: `tags.*.label` — wildcard index under list root.
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

    // Stable ListItem form `tags[key=…].label` — treat `[key=…]` as wildcard index.
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

/** `tags.*` structure soft-refresh: replace or index-level dirty, not leaf-only. */
function structureStarMatches(node) {
    if (!node) return false;
    if (node.replace || node.dirty) return true;
    if (!node.children) return false;
    for (const idx of Object.keys(node.children)) {
        const child = node.children[idx];
        // Index node dirty/replace → item identity changed.
        if (child && (child.replace || child.dirty)) return true;
    }
    return false;
}

/** `tags.*.label` / `tags[key=x].label` vs dirty trie under `tags`. */
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

/**
 * Wake if write is at/under dep, or dep is under write (parent covers children).
 * @param {any} node root trie node for field
 * @param {string[]} depSegs
 */
function pathDirtyCovers(node, depSegs) {
    let cur = node;
    for (let i = 0; i < depSegs.length; i++) {
        if (!cur || cur.replace) return !!cur?.replace;
        if (cur.dirty) return true; // write parent covers this dep
        if (!cur.children) return false;
        const next = cur.children[depSegs[i]];
        if (!next) {
            // No write along this dep path — but a write under a prefix?
            return false;
        }
        cur = next;
    }
    // Reached dep node: wake if dirty here or any dirty descendant (write under dep).
    return trieHasAnyDirty(cur);
}

/**
 * Dual-track match retained for tests / tooling.
 * @param {{ type: string, root: string, segs?: string[] }} notice
 * @param {string} key
 */
function noticeMatchesDepKey(notice, key) {
    const trie = Object.create(null);
    insertDirtyNotice(trie, notice);
    return depMatchesTrie(trie, key);
}

/** Root field name from a dep key string (`user.name` → `user`, `tags.*` → `tags`). */
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

/** Precise patches only — no full-tree fallback. @returns {Promise[]} */
function refreshBinding(inst, bindingId, dirtyTrie = null) {
    const entry = inst.__vmzBindings && inst.__vmzBindings[bindingId];
    const jobs = [];
    if (!inst || inst.__vmzDestroyed || bindingId == null || !entry) {
        return jobs;
    }
    const depKey = (entry.deps && entry.deps[0]) || null;
    const trie = dirtyTrie || inst.__vmzDirtyTrie;
    const allowIdx = itemIndicesAllowedForDeps(trie, entry.deps);
    for (const fn of entry.patches) {
        if (allowIdx && !patchMatchesDirtyIndex(fn, allowIdx)) continue;
        try {
            const ret = runPatch(fn, depKey, bindingId);
            if (ret && typeof ret.then === 'function') jobs.push(ret);
        } catch (err) {
            console.error('vmz:dom patch', err);
        }
    }
    return jobs;
}

/**
 * For ListItem path-channel deps (`tags.*.label`), restrict to dirty indices.
 * @param {Record<string, any>|null|undefined} trie
 * @param {string[]|null|undefined} deps
 * @returns {Set<string>|null} null = run all patches (replace / non-list deps)
 */
function itemIndicesAllowedForDeps(trie, deps) {
    if (!trie || !deps || !deps.length) return null;
    let sawListChannel = false;
    /** @type {Set<string>|null} */
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

function patchMatchesDirtyIndex(fn, allowIdx) {
    const idx = fn && fn.__vmzItemIndex;
    if (idx == null || idx === '') return true;
    return allowIdx.has(String(idx));
}

/** Legacy string-key patches (hand blueprints without BindingId). @returns {Promise[]} */
function refreshField(inst, field) {
    const binders = inst.__vmzBinders;
    const jobs = [];
    if (!inst || inst.__vmzDestroyed || !field || !binders || !binders[field]) {
        return jobs;
    }
    for (const fn of binders[field]) {
        try {
            const ret = runPatch(fn, field, null);
            if (ret && typeof ret.then === 'function') jobs.push(ret);
        } catch (err) {
            console.error('vmz:dom patch', err);
        }
    }
    return jobs;
}

/**
 * Run `__vmzBinders` patches that are not owned by a BindingId entry.
 * Needed so `bindComponentProp` (bindingId null) still flushes when the same
 * dep also has IR bindText/bindAttr BindingIds.
 * @returns {Promise[]}
 */
function refreshFieldBinderOnly(inst, field) {
    const binders = inst.__vmzBinders;
    const jobs = [];
    if (!inst || inst.__vmzDestroyed || !field || !binders || !binders[field]) {
        return jobs;
    }
    for (const fn of binders[field]) {
        if (patchHasBindingId(inst, fn)) continue;
        try {
            const ret = runPatch(fn, field, null);
            if (ret && typeof ret.then === 'function') jobs.push(ret);
        } catch (err) {
            console.error('vmz:dom patch', err);
        }
    }
    return jobs;
}

/**
 * @param {object} inst
 * @param {number|string} bindingId
 * @param {string[]} deps
 */
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

/**
 * @param {object} inst
 * @param {string[]} deps
 * @param {() => any} fn
 * @param {number|string|null|undefined} [bindingId]
 */
function registerBind(inst, deps, fn, bindingId = null) {
    if (!inst.__vmzBinders) inst.__vmzBinders = Object.create(null);
    for (const dep of deps || []) {
        if (!inst.__vmzBinders[dep]) inst.__vmzBinders[dep] = [];
        inst.__vmzBinders[dep].push(fn);
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

/**
 * @param {object} inst
 * @param {string[]} deps
 * @param {() => any} fn
 * @param {number|string|null|undefined} [bindingId]
 */
function unregisterBind(inst, deps, fn, bindingId = null) {
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

/**
 * True when the container already has meaningful DOM (SSR / resume shell).
 * @param {Element} el
 */
function hasMeaningfulChild(el) {
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

/** Tag each-item patches with list index for ListItem path-channel filtering. */
function tagItemPatches(patches, index) {
    if (!patches) return;
    const idx = String(index);
    for (const p of patches) {
        if (typeof p === 'function') p.__vmzItemIndex = idx;
    }
}

function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
