/** Shared icon registry for `@vmz/ui-icons` and optional app-level Icon shims. */
import type { IconDef, IconFillDef } from './icon-types.ts';
import { DEFAULT_STROKE_WIDTH } from './icon-types.ts';
import { LEGACY_FILL_ICONS } from './icons-legacy-fill.ts';
import { STROKE_ICONS } from './icons-stroke.ts';
import { TEXT_BADGE_ICONS } from './icons-text-badge.ts';

export type { IconDef, IconFillDef, IconMixedDef, IconMixedNode, IconStrokeDef, IconTextBadgeDef } from './icon-types.ts';
export { DEFAULT_STROKE_WIDTH } from './icon-types.ts';

export const REGISTRY: Record<string, IconDef> = {
    ...STROKE_ICONS,
    ...TEXT_BADGE_ICONS,
    ...LEGACY_FILL_ICONS,
};

export const LEGACY_ICON_ALIASES: Record<string, string> = {
    check: 'action.check',
    close: 'action.close',
    search: 'action.search',
    'chevron-down': 'action.chevron-down',
    'chevron-right': 'action.chevron-right',
    info: 'status.info',
    warning: 'status.warning',
    success: 'status.success',
    danger: 'status.danger',
    menu: 'action.menu',
    plus: 'action.plus',
    home: 'nav.home',
    language: 'nav.language',
    copy: 'action.copy',
    discount: 'tool.percentage',
};

export function resolveIconName(name: string): string {
    const key = String(name || '').trim();
    if (!key) return '';
    if (LEGACY_ICON_ALIASES[key]) return LEGACY_ICON_ALIASES[key];
    return key;
}

export function resolveIconDef(name: string): IconDef | null {
    const key = resolveIconName(name);
    if (!key) return null;
    const def = REGISTRY[key];
    if (!def) {
        throw new Error(`@vmz/ui-icons: unknown icon name "${name}" (resolved: "${key}")`);
    }
    return def;
}

/** @deprecated Prefer `resolveIconDef`. Returns primary path data for fill icons or first stroke path. */
export function resolveIconPath(name: string): string {
    const def = resolveIconDef(name);
    if (!def) return '';
    if (def.kind === 'fill') return def.d;
    if (def.kind === 'text-badge') return '';
    if (def.kind === 'stroke') return def.paths[0] ?? '';
    const pathNode = def.nodes.find((node) => node.tag === 'path');
    return pathNode?.attrs.d ?? '';
}
