// Scene conformance — SemanticScene → structured diagnostics.
//
// `resolve` refuses a foreign contract version outright, but a scene can still
// break the rules its builders promise: stable ids must be unique within one
// scene, clip rects must be finite and positive, and no coordinate may reach
// the pipeline as NaN or Infinity. `validateScene` is the single place that
// checks those rules for every domain.

import { diag, type Diagnostic, type PathCommand, type Point2D } from "@doki-land/davinci-types";
import type { SemanticNode, SemanticScene } from "./semantic.js";
import { SCENE_VERSION } from "./version.js";

/** Validate a SemanticScene against the scene contract. An empty result means
 *  the scene is conformant. */
export function validateScene(scene: SemanticScene): ReadonlyArray<Diagnostic> {
    const items: Diagnostic[] = [];
    if (scene.version !== SCENE_VERSION) {
        items.push(
            diag(
                "error",
                "davinci.scene.unsupported-version",
                `scene version wants ${SCENE_VERSION}, got ${JSON.stringify(scene.version)}`,
            ),
        );
    }

    const idCounts = new Map<string, number>();
    const queue: SemanticNode[] = [scene.root];
    while (queue.length > 0) {
        const node = queue.shift() as SemanticNode;
        idCounts.set(node.id, (idCounts.get(node.id) ?? 0) + 1);
        checkGeometry(node, items);
        if (node.clip && !(isFiniteRect(node.clip) && node.clip.w > 0 && node.clip.h > 0)) {
            items.push(diag("error", "davinci.scene.invalid-clip", "clip rect must be finite and positive", node.id));
        }
        if (node.kind === "group") queue.push(...node.children);
    }
    for (const [id, count] of idCounts) {
        if (count > 1) {
            items.push(
                diag("error", "davinci.scene.duplicate-id", `id "${id}" appears ${count} times in one scene`, id),
            );
        }
    }
    return items;
}

function isFiniteRect(r: { x: number; y: number; w: number; h: number }): boolean {
    return Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.w) && Number.isFinite(r.h);
}

function checkGeometry(node: SemanticNode, items: Diagnostic[]): void {
    const bad = (what: string): Diagnostic =>
        diag("error", "davinci.scene.invalid-geometry", `${what} must be finite`, node.id);
    switch (node.kind) {
        case "rect":
        case "image":
            if (!isFiniteRect(node)) items.push(bad(`${node.kind} rect`));
            break;
        case "ellipse":
            if (![node.cx, node.cy, node.rx, node.ry].every(Number.isFinite)) items.push(bad("ellipse"));
            break;
        case "text":
            if (node.anchor && !(Number.isFinite(node.anchor.x) && Number.isFinite(node.anchor.y))) {
                items.push(bad("text anchor"));
            }
            break;
        case "path":
            for (const cmd of node.path.commands) {
                if (!pointsOfCommand(cmd).every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) {
                    items.push(bad(`path ${cmd.kind}`));
                    break;
                }
            }
            break;
        case "marker":
            if (!node.positions.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) {
                items.push(bad("marker positions"));
            }
            break;
        case "group":
            break;
    }
}

function pointsOfCommand(cmd: PathCommand): Point2D[] {
    switch (cmd.kind) {
        case "move":
        case "line":
        case "arc":
            return [cmd.to];
        case "quadratic":
            return [cmd.cp, cmd.to];
        case "cubic":
            return [cmd.cp1, cmd.cp2, cmd.to];
        case "close":
            return [];
    }
}
