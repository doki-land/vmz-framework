import type { IconDef } from '../icon-types.ts';

/** Data glyphs (`data.*`) — dataset shapes such as pie charts and tables. */
export const DATA_ICONS: Record<string, IconDef> = {
    'data.pie': {
        kind: 'stroke',
        paths: ['M21 12A9 9 0 1 1 12 3V12H21Z', 'M14 3.5A9 9 0 0 1 20.5 10H14V3.5Z'],
    },
    'data.table': {
        kind: 'stroke',
        paths: ['M4 5H20V19H4Z', 'M4 9.5H20', 'M4 14H20', 'M9.5 5V19'],
    },
};
