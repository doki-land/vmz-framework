// Reference SVG serializer — DisplayScene → deterministic SVG markup.
//
// This is the DaVinci reference renderer for the SVG target, not another
// domain layer: it never re-loads data, re-computes scales, resolves themes
// or re-runs layout. It only serializes the already-resolved DisplayScene into
// an SVG string, so the same output works for SSR (`v-html`) and for tests
// that assert markup directly.

import { toHex, type Affine2D, type BoundsRect, type Path, type PathCommand, type RGBA } from "@doki-land/davinci-types";
import type {
    DisplayEllipse,
    DisplayFill,
    DisplayGroup,
    DisplayImage,
    DisplayPath,
    DisplayRect,
    DisplayScene,
    DisplayStroke,
    DisplayText,
} from "./display.js";

type DisplayLeaf = DisplayPath | DisplayRect | DisplayEllipse | DisplayImage | DisplayText;

interface ResolvedClip {
    readonly id: string;
    readonly rect: BoundsRect;
}

interface RenderContext {
    readonly clips: ResolvedClip[];
    clipSeq: number;
}

/** Serialize a resolved DisplayScene to an SVG document string. */
export function renderSvg(scene: DisplayScene): string {
    const ctx: RenderContext = { clips: [], clipSeq: 0 };
    const body: string[] = [];
    walk(scene.root, ctx, body);

    const width = dimension(scene.width);
    const height = dimension(scene.height);
    const lines: string[] = [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${num(width)}" height="${num(height)}" viewBox="0 0 ${num(width)} ${num(height)}" preserveAspectRatio="xMidYMid meet">`,
    ];
    if (scene.background) {
        lines.push(
            `  <rect x="0" y="0" width="${num(width)}" height="${num(height)}"${fillAttrs(scene.background)}/>`,
        );
    }
    if (ctx.clips.length > 0) {
        lines.push("  <defs>");
        for (const clip of ctx.clips) {
            lines.push(
                `    <clipPath id="${clip.id}"><rect x="${num(clip.rect.x)}" y="${num(clip.rect.y)}" width="${num(clip.rect.w)}" height="${num(clip.rect.h)}"/></clipPath>`,
            );
        }
        lines.push("  </defs>");
    }
    lines.push(...body);
    lines.push("</svg>");
    return lines.join("\n");
}

function walk(group: DisplayGroup, ctx: RenderContext, out: string[]): void {
    for (const child of group.children) {
        if (child.kind === "group") {
            // Children carry the fully-composed world transform and the
            // inherited clip, so the group wrapper itself needs no paint.
            walk(child, ctx, out);
            continue;
        }
        out.push(...leafLines(child, ctx));
    }
}

function leafLines(node: DisplayLeaf, ctx: RenderContext): string[] {
    const transform = transformAttr(node.worldTransform);
    const clipId = node.worldClip ? clipFor(node.worldClip, ctx) : null;
    const element = elementMarkup(node, transform);

    if (!clipId) return [`  ${element}`];
    return [`  <g clip-path="url(#${clipId})">`, `    ${element}`, "  </g>"];
}

function elementMarkup(node: DisplayLeaf, transform: string): string {
    const transformAttr = transform ? ` transform="${transform}"` : "";
    switch (node.kind) {
        case "path": {
            const fill = node.fill ? fillAttrs(node.fill.color) : ' fill="none"';
            return `<path d="${pathData(node.path)}"${fill}${strokeAttrs(node.stroke)}${transformAttr}/>`;
        }
        case "rect": {
            const radii =
                node.rx > 0 || node.ry > 0 ? ` rx="${num(node.rx)}" ry="${num(node.ry)}"` : "";
            return `<rect x="${num(node.x)}" y="${num(node.y)}" width="${num(node.w)}" height="${num(node.h)}"${radii}${paintAttrs(node.fill, node.stroke)}${transformAttr}/>`;
        }
        case "ellipse": {
            return `<ellipse cx="${num(node.cx)}" cy="${num(node.cy)}" rx="${num(node.rx)}" ry="${num(node.ry)}"${paintAttrs(node.fill, node.stroke)}${transformAttr}/>`;
        }
        case "image": {
            return `<image x="${num(node.x)}" y="${num(node.y)}" width="${num(node.w)}" height="${num(node.h)}" href="${esc(node.resourceRef)}" preserveAspectRatio="xMidYMid meet"${transformAttr}/>`;
        }
        case "text": {
            // DisplayText.anchor is the centre of the text block, so alignment
            // is fixed: middle horizontally, middle vertically.
            const font = node.fontCss ? ` style="font:${esc(node.fontCss)}"` : "";
            return `<text x="${num(node.anchor.x)}" y="${num(node.anchor.y)}" text-anchor="middle" dominant-baseline="middle"${fillAttrs(node.color)}${font}${transformAttr}>${esc(node.text)}</text>`;
        }
    }
}

// ─── Paint ───────────────────────────────────────────────────────────────

function paintAttrs(fill: DisplayFill | undefined, stroke: DisplayStroke | undefined): string {
    const fillPart = fill ? fillAttrs(fill.color) : ' fill="none"';
    return `${fillPart}${strokeAttrs(stroke)}`;
}

function fillAttrs(color: RGBA): string {
    const opacity = color.a < 1 ? ` fill-opacity="${num(color.a)}"` : "";
    return ` fill="${toHex({ ...color, a: 1 })}"${opacity}`;
}

function strokeAttrs(stroke: DisplayStroke | undefined): string {
    if (!stroke) return "";
    const opacity = stroke.color.a < 1 ? ` stroke-opacity="${num(stroke.color.a)}"` : "";
    const dash =
        stroke.dash && stroke.dash.length > 0
            ? ` stroke-dasharray="${stroke.dash.map((d) => num(d)).join(" ")}"`
            : "";
    return ` stroke="${toHex({ ...stroke.color, a: 1 })}" stroke-width="${num(stroke.width)}"${opacity}${dash}`;
}

// ─── Geometry and serialization helpers ──────────────────────────────────

function pathData(path: Path): string {
    return path.commands.map(commandText).join(" ");
}

function commandText(command: PathCommand): string {
    switch (command.kind) {
        case "move":
            return `M ${num(command.to.x)} ${num(command.to.y)}`;
        case "line":
            return `L ${num(command.to.x)} ${num(command.to.y)}`;
        case "cubic":
            return `C ${num(command.cp1.x)} ${num(command.cp1.y)} ${num(command.cp2.x)} ${num(command.cp2.y)} ${num(command.to.x)} ${num(command.to.y)}`;
        case "quadratic":
            return `Q ${num(command.cp.x)} ${num(command.cp.y)} ${num(command.to.x)} ${num(command.to.y)}`;
        case "arc":
            return `A ${num(command.rx)} ${num(command.ry)} ${num(command.xRot)} ${command.largeArc ? 1 : 0} ${command.sweep ? 1 : 0} ${num(command.to.x)} ${num(command.to.y)}`;
        case "close":
            return "Z";
    }
}

function transformAttr(transform: Affine2D): string {
    const identity =
        transform.a === 1 &&
        transform.b === 0 &&
        transform.c === 0 &&
        transform.d === 1 &&
        transform.tx === 0 &&
        transform.ty === 0;
    if (identity) return "";
    return `matrix(${num(transform.a)},${num(transform.b)},${num(transform.c)},${num(transform.d)},${num(transform.tx)},${num(transform.ty)})`;
}

function clipFor(rect: BoundsRect, ctx: RenderContext): string {
    const id = `clip-${ctx.clipSeq++}`;
    ctx.clips.push({ id, rect });
    return id;
}

/** Up to three decimals, no trailing zeros, never `-0`. */
function num(value: number): string {
    if (!Number.isFinite(value)) return "0";
    const rounded = Math.round(value * 1000) / 1000;
    return Object.is(rounded, -0) ? "0" : String(rounded);
}

function dimension(value: number): number {
    return Number.isFinite(value) && value > 0 ? value : 0;
}

function esc(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
