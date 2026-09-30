/** Structured icon definitions for `@vmz/ui-icons` registry. */

export type IconStrokeDef = {
    kind: 'stroke';
    paths: readonly string[];
    circles?: readonly Readonly<{ cx: number; cy: number; r: number }>[];
    dots?: readonly Readonly<{ cx: number; cy: number; r: number }>[];
    strokeWidth?: number;
};

export type IconFillDef = {
    kind: 'fill';
    d: string;
    fillRule?: 'evenodd' | 'nonzero';
};

export type IconMixedNode = {
    tag: 'path' | 'circle' | 'rect' | 'line';
    attrs: Readonly<Record<string, string>>;
};

export type IconMixedDef = {
    kind: 'mixed';
    nodes: readonly IconMixedNode[];
};

/** Monospace text mark for proprietary converter names (2–4 chars). */
export type IconTextBadgeDef = {
    kind: 'text-badge';
    label: string;
};

export type IconDef = IconStrokeDef | IconFillDef | IconMixedDef | IconTextBadgeDef;

export const DEFAULT_STROKE_WIDTH = 1.75;
