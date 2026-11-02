import type { IconDef } from '../icon-types.ts';

/** Develop glyphs (`develop.*`) — console, terminal and inspection landmarks for developer surfaces. */
export const DEVELOP_ICONS: Record<string, IconDef> = {
    'develop.terminal': {
        kind: 'stroke',
        paths: ['M3 5H21V19H3Z', 'M7 9L10 12L7 15', 'M13 15H17'],
    },
    'develop.command': {
        kind: 'stroke',
        paths: ['M15.5 4.5A2.4 2.4 0 0 0 13 6.9V17.1A2.4 2.4 0 0 0 15.5 19.5A2.4 2.4 0 0 0 17.9 17.1A2.4 2.4 0 0 0 15.5 14.7H8.5A2.4 2.4 0 0 0 6.1 17.1A2.4 2.4 0 0 0 8.5 19.5A2.4 2.4 0 0 0 11 17.1V6.9A2.4 2.4 0 0 0 8.5 4.5A2.4 2.4 0 0 0 6.1 6.9A2.4 2.4 0 0 0 8.5 9.3H15.5A2.4 2.4 0 0 0 17.9 6.9A2.4 2.4 0 0 0 15.5 4.5Z'],
    },
    'develop.inspect': {
        kind: 'stroke',
        paths: ['M4 7V4H7', 'M17 4H20V7', 'M20 17V20H17', 'M7 20H4V17'],
        dots: [{ cx: 12, cy: 12, r: 1.5 }],
    },
    'develop.activity': {
        kind: 'stroke',
        paths: ['M3 12H7L10 6L14 18L17 12H21'],
    },
    'develop.queue': {
        kind: 'stroke',
        paths: ['M4 8L12 4L20 8L12 12L4 8Z', 'M4 12.5L12 16.5L20 12.5', 'M4 17L12 21L20 17'],
    },
    'develop.env': { kind: 'text-badge', label: 'ENV' },
};
