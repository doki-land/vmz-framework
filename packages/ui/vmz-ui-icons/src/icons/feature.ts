import type { IconDef } from '../icon-types.ts';

/** Feature glyphs (`feature.*`) — product capability landmarks on marketing surfaces. */
export const FEATURE_ICONS: Record<string, IconDef> = {
    'feature.incremental': {
        kind: 'stroke',
        paths: ['M4 20H20', 'M6 20V16H10V12H14V8H18'],
    },
    'feature.runtime': {
        kind: 'stroke',
        paths: ['M7 7H17V17H7Z', 'M10 4V7', 'M14 4V7', 'M10 17V20', 'M14 17V20', 'M4 10H7', 'M4 14H7', 'M17 10H20', 'M17 14H20'],
    },
    'feature.deploy': {
        kind: 'stroke',
        paths: ['M4 18H20', 'M12 15V6', 'M8 10L12 6L16 10'],
    },
};
