/** Shared icon registry for `@vmz/ui-icons` and optional app-level Icon shims. */
import type { IconDef } from './icon-types.ts';
import { ACTION_ICONS } from './icons/action.ts';
import { BRAND_ICONS } from './icons/brand.ts';
import { COMMERCE_ICONS } from './icons/commerce.ts';
import { DATA_ICONS } from './icons/data.ts';
import { DEVELOP_ICONS } from './icons/develop.ts';
import { DEVICE_ICONS } from './icons/device.ts';
import { EDITOR_ICONS } from './icons/editor.ts';
import { FEATURE_ICONS } from './icons/feature.ts';
import { FILE_ICONS } from './icons/file.ts';
import { GIT_ICONS } from './icons/git.ts';
import { MEDIA_ICONS } from './icons/media.ts';
import { NAVIGATION_ICONS } from './icons/navigation.ts';
import { SOCIAL_ICONS } from './icons/social.ts';
import { STATUS_ICONS } from './icons/status.ts';
import { TOOL_ICONS } from './icons/tool.ts';

export type { IconDef, IconFillDef, IconMixedDef, IconMixedNode, IconStrokeDef, IconTextBadgeDef } from './icon-types.ts';
export { DEFAULT_STROKE_WIDTH } from './icon-types.ts';

/**
 * One registry, one silhouette per concept. Category modules under `./icons/` are the
 * only sources; keys stay stable, and unknown names throw instead of falling back.
 */
export const REGISTRY: Record<string, IconDef> = {
    ...ACTION_ICONS,
    ...BRAND_ICONS,
    ...COMMERCE_ICONS,
    ...DATA_ICONS,
    ...DEVELOP_ICONS,
    ...DEVICE_ICONS,
    ...EDITOR_ICONS,
    ...FEATURE_ICONS,
    ...FILE_ICONS,
    ...GIT_ICONS,
    ...MEDIA_ICONS,
    ...NAVIGATION_ICONS,
    ...SOCIAL_ICONS,
    ...STATUS_ICONS,
    ...TOOL_ICONS,
};

export function resolveIconDef(name: string): IconDef | null {
    const key = String(name || '').trim();
    if (!key) return null;
    const def = REGISTRY[key];
    if (!def) {
        throw new Error(
            `@vmz/ui-icons: unknown icon name "${key}" — expected a dotted semantic name from the registry (action.*, brand.*, commerce.*, data.*, develop.*, device.*, editor.*, feature.*, file.*, git.*, media.*, nav.*, social.*, status.*, tool.*)`,
        );
    }
    return def;
}
