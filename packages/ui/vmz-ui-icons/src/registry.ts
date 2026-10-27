/** Shared icon registry for `@vmz/ui-icons` and optional app-level Icon shims. */
import type { IconDef } from './icon-types.ts';
import { DEFAULT_STROKE_WIDTH } from './icon-types.ts';
import { STROKE_ICONS } from './icons-stroke.ts';
import { TEXT_BADGE_ICONS } from './icons-text-badge.ts';

export type { IconDef, IconFillDef, IconMixedDef, IconMixedNode, IconStrokeDef, IconTextBadgeDef } from './icon-types.ts';
export { DEFAULT_STROKE_WIDTH } from './icon-types.ts';

export const REGISTRY: Record<string, IconDef> = {
    ...STROKE_ICONS,
    ...TEXT_BADGE_ICONS,
};

export function resolveIconDef(name: string): IconDef | null {
    const key = String(name || '').trim();
    if (!key) return null;
    const def = REGISTRY[key];
    if (!def) {
        throw new Error(
            `@vmz/ui-icons: unknown icon name "${key}" — expected a dotted semantic name from the registry (action.*, nav.*, status.*, tool.*, feature.*)`,
        );
    }
    return def;
}
