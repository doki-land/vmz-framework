import type { IconDef } from '../icon-types.ts';

/** Navigation glyphs (`nav.*`) — wayfinding landmarks such as home and locale. */
export const NAVIGATION_ICONS: Record<string, IconDef> = {
    'nav.home': {
        kind: 'stroke',
        paths: ['M4 10.5L12 4L20 10.5', 'M6 10V19H18V10', 'M10 19V13H14V19'],
    },
    'nav.language': {
        kind: 'stroke',
        circles: [{ cx: 12, cy: 12, r: 9 }],
        paths: ['M3 12H21', 'M12 3C15.5 5.5 17 8.5 17 12C17 15.5 15.5 18.5 12 21C8.5 18.5 7 15.5 7 12C7 8.5 8.5 5.5 12 3Z'],
    },
};
