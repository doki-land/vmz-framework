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
    'nav.anchor': {
        kind: 'stroke',
        paths: ['M9.5 4L7.5 20', 'M16.5 4L14.5 20', 'M4.5 9H19.5', 'M4 15H19'],
    },
    'nav.bookmark': {
        kind: 'stroke',
        paths: ['M6 3.5H18V20.5L12 16L6 20.5V3.5Z'],
    },
    'nav.compass': {
        kind: 'stroke',
        circles: [{ cx: 12, cy: 12, r: 9 }],
        paths: ['M15.5 8.5L13.5 13.5L8.5 15.5L10.5 10.5L15.5 8.5Z'],
    },
};
