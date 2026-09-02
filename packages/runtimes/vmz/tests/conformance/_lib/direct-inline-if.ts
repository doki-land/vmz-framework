/**
 * Hand-written conformance fixtures: inline v-if schedule matching Direct emit (0.2.0).
 * Production components use compiler-generated IIFE — not this helper.
 */

export type DirectIfBranch = {
    cond?: (this: unknown) => boolean;
    create: (api: unknown) => unknown;
};

/** Mirrors `emit_direct` inline if IIFE for test-only Direct components. */
export function createDirectIfBlock(
    api: {
        comment: (value?: string) => unknown;
        frag: () => { appendChild: (c: unknown) => void };
        el: (tag: string) => unknown;
        trackPatch: (inst: unknown, deps: string[], patch: () => void, bindingId?: unknown) => void;
        untrackPatch: (inst: unknown, deps: string[], patch: () => void, bindingId?: unknown) => void;
        removeNode: (node: unknown) => void;
        _branchBinds: Array<{ deps: string[]; fn: () => void; bindingId?: unknown }> | null;
        _inst: unknown;
        _itemPatches: Array<() => void> | null;
        _resumeAdopt: null | { beginBranchScope?: () => () => void };
    },
    inst: unknown,
    deps: string[],
    branches: DirectIfBranch[],
    bindingId: number | string | null = null,
    regionId: number | string | null = null,
): unknown {
    const start = api.comment('vmz-if');
    const end = api.comment('/vmz-if');
    if (regionId != null && start && typeof start === 'object') {
        (start as { __vmzRegion?: unknown }).__vmzRegion = regionId;
    }
    const frag = api.frag();
    frag.appendChild(start);
    let regionHost: unknown = null;
    if (regionId != null) {
        regionHost = api.el('span');
        const rh = regionHost as { style?: { display?: string }; setAttribute?: (n: string, v: string) => void };
        if (rh.style) rh.style.display = 'contents';
        if (typeof rh.setAttribute === 'function') rh.setAttribute('data-vmz-region', String(regionId));
        frag.appendChild(regionHost);
    }
    frag.appendChild(end);

    const cached: Array<unknown> = branches.map(() => null);
    const branchBinds: Array<Array<{ deps: string[]; fn: () => void; bindingId?: unknown }>> = branches.map(() => []);
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

    const wireBranch = (idx: number) => {
        if (idx < 0) return;
        for (const bb of branchBinds[idx]) {
            api.trackPatch(inst, bb.deps, bb.fn, bb.bindingId);
        }
    };
    const unwireBranch = (idx: number) => {
        if (idx < 0) return;
        for (const bb of branchBinds[idx]) {
            api.untrackPatch(inst, bb.deps, bb.fn, bb.bindingId);
        }
    };

    const apply = () => {
        const destroyed = inst as { __vmzDestroyed?: boolean };
        if (destroyed.__vmzDestroyed) return;
        const applied = ++gen;
        const next = pick();
        if (next === active) return;

        if (next >= 0 && !cached[next]) {
            const binds: Array<{ deps: string[]; fn: () => void; bindingId?: unknown }> = [];
            const prevSink = api._branchBinds;
            const prevInst = api._inst;
            api._branchBinds = binds;
            api._inst = inst;
            let created: unknown = null;
            const adopt = api._resumeAdopt;
            const endBranch = adopt && typeof adopt.beginBranchScope === 'function' ? adopt.beginBranchScope() : null;
            try {
                created = branches[next].create.call(inst, api);
            } finally {
                if (typeof endBranch === 'function') endBranch();
                api._branchBinds = prevSink;
                api._inst = prevInst;
            }
            if (applied !== gen || destroyed.__vmzDestroyed) return;
            if (!cached[next]) {
                cached[next] = created;
                branchBinds[next] = binds;
            }
        }
        if (applied !== gen || destroyed.__vmzDestroyed) return;

        if (active >= 0) {
            unwireBranch(active);
            const prev = cached[active] as { parentNode?: { removeChild?: (n: unknown) => void }; remove?: () => void } | null;
            if (prev) {
                if (typeof prev.remove === 'function') prev.remove();
                else api.removeNode(prev);
            }
        }
        active = next;
        if (next < 0) return;
        wireBranch(next);
        const created = cached[next] as unknown;
        const endNode = end as { parentNode?: unknown };
        if (created && endNode.parentNode) {
            if (regionHost && typeof (regionHost as { appendChild?: (n: unknown) => void }).appendChild === 'function') {
                (regionHost as { appendChild: (n: unknown) => void }).appendChild(created);
            } else {
                const parent = endNode.parentNode as {
                    insertBefore?: (node: unknown, ref: unknown) => void;
                    appendChild?: (n: unknown) => void;
                };
                if (typeof parent.insertBefore === 'function') parent.insertBefore(created, end);
                else if (typeof parent.appendChild === 'function') parent.appendChild(created);
            }
        }
    };

    api.trackPatch(inst, deps || [], apply, bindingId);
    if (api._itemPatches) api._itemPatches.push(apply);
    if (start && typeof start === 'object') {
        (start as { __vmzDispose?: () => void }).__vmzDispose = () => {
            for (let i = 0; i < cached.length; i++) {
                unwireBranch(i);
                cached[i] = null;
            }
            active = -1;
        };
    }
    apply();
    return frag;
}
