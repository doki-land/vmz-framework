// Canvas 2D renderer — DisplayScene → CanvasRenderingContext2D calls.
//
// Same contract as the SVG reference renderer: the scene arrives fully
// resolved (world transforms composed, clips intersected, fonts formatted),
// so this module only maps nodes to canvas calls. It never re-loads data,
// re-computes scales, or touches domain semantics. Hosts without a canvas
// (SSR, tests) keep the SVG path; this renderer is a pure output backend.

import { toHex, type Affine2D, type Path, type PathCommand, type RGBA } from "@doki-land/davinci-types";
import type { DisplayGroup, DisplayNode, DisplayScene } from "./display.js";
import { assertSceneVersion } from "./version.js";

/** The minimal 2D surface `renderCanvas` needs — structurally compatible
 *  with `CanvasRenderingContext2D`, trivially stubbable for tests. */
export interface Canvas2DLike {
    fillStyle: unknown;
    strokeStyle: unknown;
    lineWidth: number;
    font: string;
    textAlign: string;
    textBaseline: string;
    save(): void;
    restore(): void;
    transform(a: number, b: number, c: number, d: number, e: number, f: number): void;
    beginPath(): void;
    closePath(): void;
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
    bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void;
    ellipse(cx: number, cy: number, rx: number, ry: number, rotation: number, start: number, end: number, anticlockwise?: boolean): void;
    rect(x: number, y: number, w: number, h: number): void;
    clip(): void;
    fill(): void;
    fillRect(x: number, y: number, w: number, h: number): void;
    stroke(): void;
    fillText(text: string, x: number, y: number): void;
    setLineDash(segments: number[]): void;
}

/** Render a resolved DisplayScene onto a 2D context. The context owns the
 *  pixel backing store (the caller sets canvas width/height and any DPR
 *  transform); this function paints in scene coordinates. */
export function renderCanvas(scene: DisplayScene, ctx: Canvas2DLike): void {
    assertSceneVersion(scene.version, "renderCanvas");
    if (scene.background) {
        ctx.save();
        ctx.fillStyle = css(scene.background);
        ctx.fillRect(0, 0, scene.width, scene.height);
        ctx.restore();
    }
    walkGroup(scene.root, ctx);
}

function walkGroup(group: DisplayGroup, ctx: Canvas2DLike): void {
    for (const child of group.children) {
        if (child.kind === "group") {
            walkGroup(child, ctx);
            continue;
        }
        drawLeaf(child, ctx);
    }
}

function drawLeaf(node: Exclude<DisplayNode, DisplayGroup>, ctx: Canvas2DLike): void {
    ctx.save();
    if (node.worldClip) {
        ctx.beginPath();
        ctx.rect(node.worldClip.x, node.worldClip.y, node.worldClip.w, node.worldClip.h);
        ctx.clip();
    }
    applyTransform(node.worldTransform, ctx);
    switch (node.kind) {
        case "rect": {
            ctx.beginPath();
            if (node.rx > 0 || node.ry > 0) {
                roundedRect(ctx, node.x, node.y, node.w, node.h, Math.max(node.rx, node.ry));
            } else {
                ctx.rect(node.x, node.y, node.w, node.h);
            }
            paint(ctx, node.fill?.color, node.stroke?.color, node.stroke?.width, node.stroke?.dash);
            break;
        }
        case "ellipse": {
            ctx.beginPath();
            ctx.ellipse(node.cx, node.cy, node.rx, node.ry, 0, 0, Math.PI * 2);
            paint(ctx, node.fill?.color, node.stroke?.color, node.stroke?.width, node.stroke?.dash);
            break;
        }
        case "path": {
            ctx.beginPath();
            tracePath(node.path, ctx);
            paint(ctx, node.fill?.color, node.stroke?.color, node.stroke?.width, node.stroke?.dash);
            break;
        }
        case "text": {
            ctx.font = node.fontCss;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillStyle = css(node.color);
            ctx.fillText(node.text, node.anchor.x, node.anchor.y);
            break;
        }
        case "image":
            // Images need a host-side bitmap loader; the canvas backend skips
            // them rather than painting a broken placeholder.
            break;
    }
    ctx.restore();
}

function paint(
    ctx: Canvas2DLike,
    fill: RGBA | undefined,
    stroke: RGBA | undefined,
    strokeWidth: number | undefined,
    dash: ReadonlyArray<number> | undefined,
): void {
    if (fill) {
        ctx.fillStyle = css(fill);
        ctx.fill();
    }
    if (stroke && strokeWidth && strokeWidth > 0) {
        ctx.strokeStyle = css(stroke);
        ctx.lineWidth = strokeWidth;
        ctx.setLineDash(dash ? [...dash] : []);
        ctx.stroke();
        ctx.setLineDash([]);
    }
}

function applyTransform(t: Affine2D, ctx: Canvas2DLike): void {
    const identity = t.a === 1 && t.b === 0 && t.c === 0 && t.d === 1 && t.tx === 0 && t.ty === 0;
    if (!identity) ctx.transform(t.a, t.b, t.c, t.d, t.tx, t.ty);
}

function tracePath(path: Path, ctx: Canvas2DLike): void {
    let cx = 0;
    let cy = 0;
    for (const cmd of path.commands) {
        switch (cmd.kind) {
            case "move":
                ctx.moveTo(cmd.to.x, cmd.to.y);
                cx = cmd.to.x;
                cy = cmd.to.y;
                break;
            case "line":
                ctx.lineTo(cmd.to.x, cmd.to.y);
                cx = cmd.to.x;
                cy = cmd.to.y;
                break;
            case "quadratic":
                ctx.quadraticCurveTo(cmd.cp.x, cmd.cp.y, cmd.to.x, cmd.to.y);
                cx = cmd.to.x;
                cy = cmd.to.y;
                break;
            case "cubic":
                ctx.bezierCurveTo(cmd.cp1.x, cmd.cp1.y, cmd.cp2.x, cmd.cp2.y, cmd.to.x, cmd.to.y);
                cx = cmd.to.x;
                cy = cmd.to.y;
                break;
            case "arc":
                traceArc(ctx, cx, cy, cmd);
                cx = cmd.to.x;
                cy = cmd.to.y;
                break;
            case "close":
                ctx.closePath();
                break;
        }
    }
}

/** SVG endpoint-arc → canvas center-arc conversion (SVG spec F.6.5). The
 *  scene's arc commands share SVG semantics: `sweep` picks the clockwise
 *  side in the y-down screen plane, which is canvas's increasing-angle
 *  direction, so `anticlockwise` is simply `!sweep`. */
function traceArc(ctx: Canvas2DLike, x0: number, y0: number, cmd: Extract<PathCommand, { kind: "arc" }>): void {
    const phi = (cmd.xRot * Math.PI) / 180;
    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);
    const x1 = cmd.to.x;
    const y1 = cmd.to.y;

    // Step 1: transform into the ellipse's local frame.
    const dx = (x0 - x1) / 2;
    const dy = (y0 - y1) / 2;
    const x1p = cosPhi * dx + sinPhi * dy;
    const y1p = -sinPhi * dx + cosPhi * dy;

    // Step 2: radii may need scaling up so the arc can reach the endpoint.
    let rx = Math.abs(cmd.rx);
    let ry = Math.abs(cmd.ry);
    const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lambda > 1) {
        const s = Math.sqrt(lambda);
        rx *= s;
        ry *= s;
    }

    // Step 3: center in the primed frame.
    const rx2 = rx * rx;
    const ry2 = ry * ry;
    const denom = rx2 * y1p * y1p + ry2 * x1p * x1p;
    const factor = (cmd.largeArc !== cmd.sweep ? 1 : -1) * Math.sqrt(Math.max(0, (rx2 * ry2 - denom) / Math.max(denom, 1e-12)));
    const cxp = (factor * rx * y1p) / ry;
    const cyp = (-factor * ry * x1p) / rx;

    // Step 4: back to scene coordinates, then start/end angles.
    const cx = cosPhi * cxp - sinPhi * cyp + (x0 + x1) / 2;
    const cy = sinPhi * cxp + cosPhi * cyp + (y0 + y1) / 2;
    const angleBetween = (ux: number, uy: number, vx: number, vy: number): number => {
        const dot = ux * vx + uy * vy;
        const len = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
        let a = Math.acos(Math.max(-1, Math.min(1, dot / Math.max(len, 1e-12))));
        if (ux * vy - uy * vx < 0) a = -a;
        return a;
    };
    const start = angleBetween(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    const end = angleBetween((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    ctx.ellipse(cx, cy, rx, ry, phi, start, start + end, !cmd.sweep);
}

/** Rounded rect without relying on `roundRect` (older canvas implementations). */
function roundedRect(ctx: Canvas2DLike, x: number, y: number, w: number, h: number, r: number): void {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
}

function css(color: RGBA): string {
    const hex = toHex({ ...color, a: 1 });
    if (color.a >= 1) return hex;
    return `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${color.a})`;
}
