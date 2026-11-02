/** Shared icon registry for `@vmz/ui-icons` and optional app-level Icon shims. */
import type { IconDef } from './icon-types.ts';
import { ACTION_ICONS } from './icons/action.ts';
import { FEATURE_ICONS } from './icons/feature.ts';
import { NAVIGATION_ICONS } from './icons/navigation.ts';
import { STATUS_ICONS } from './icons/status.ts';
import { TOOL_ICONS } from './icons/tool.ts';

export type { IconDef, IconFillDef, IconMixedDef, IconMixedNode, IconStrokeDef, IconTextBadgeDef } from './icon-types.ts';
export { DEFAULT_STROKE_WIDTH } from './icon-types.ts';

/**
 * One registry, one row per concept. Category modules under `./icons/` are the only
 * sources; keys stay stable, and unknown names throw instead of falling back.
 */
export const REGISTRY: Record<string, IconDef> = {
    ...ACTION_ICONS,
    ...FEATURE_ICONS,
    ...NAVIGATION_ICONS,
    ...STATUS_ICONS,
    ...TOOL_ICONS,
};

export function resolveIconDef(name: string): IconDef | null {
    const key = String(name || '').trim();
    if (!key) return null;
    const def = REGISTRY[key];
    if (!def) {
        throw new Error(
            `@vmz/ui-icons: unknown icon name "${key}" — expected a dotted semantic name from the registry (action.*, feature.*, nav.*, status.*, tool.*)`,
        );
    }
    return def;
}
