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
        paths: ['M3 12H21', 'M12 3C14.4 5.6 15.4 8.7 15.4 12C15.4 15.3 14.4 18.4 12 21C9.6 18.4 8.6 15.3 8.6 12C8.6 8.7 9.6 5.6 12 3Z'],
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
        paths: ['M15.17 9.34L13.5 13.5L8.83 14.67Q8.5 15.5 9.34 15.17L10.5 10.5L14.67 8.83Q15.5 8.5 15.17 9.34Z'],
    },
    'nav.chat': {
        kind: 'stroke',
        paths: ['M4 6.5A2.5 2.5 0 0 1 6.5 4H17.5A2.5 2.5 0 0 1 20 6.5V13.5A2.5 2.5 0 0 1 17.5 16H9L4 20V6.5Z'],
    },
    'nav.contacts': {
        kind: 'stroke',
        circles: [{ cx: 12, cy: 8.6, r: 3.4 }],
        paths: ['M5.2 20C5.2 16.5 8.3 14.1 12 14.1C15.7 14.1 18.8 16.5 18.8 20'],
    },
};
