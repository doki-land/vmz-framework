// Motion — scene correspondence, transition plan, timeline.
//
// Correspondence is the foundation: matching nodes across scenes by stable
// key (not array index). Transitions operate only on matched pairs; new nodes
// pop in, removed nodes pop out.

import type { DisplayNode, DisplayScene } from "@doki-land/davinci-scene";

/** A matched pair across two scenes. */
export interface SceneMatch {
    readonly id: string;
    readonly from: DisplayNode | null;
    readonly to: DisplayNode | null;
}

/** Match nodes between two scenes by node id (stable identity). */
export function matchScenes(prev: DisplayScene | null, next: DisplayScene): ReadonlyArray<SceneMatch> {
    const prevMap = new Map<string, DisplayNode>();
    if (prev) collectIds(prev.root, prevMap);
    const nextMap = new Map<string, DisplayNode>();
    collectIds(next.root, nextMap);

    const matches: SceneMatch[] = [];
    const seen = new Set<string>();
    for (const [id, node] of nextMap) {
        matches.push({ id, from: prevMap.get(id) ?? null, to: node });
        seen.add(id);
    }
    for (const [id, node] of prevMap) {
        if (!seen.has(id)) matches.push({ id, from: node, to: null });
    }
    return matches;
}

function collectIds(node: DisplayNode, out: Map<string, DisplayNode>): void {
    if ((node as DisplayNode & { id?: string }).id) {
        out.set((node as DisplayNode & { id: string }).id, node);
    }
    if (node.kind === "group") {
        for (const c of node.children) collectIds(c, out);
    }
}
