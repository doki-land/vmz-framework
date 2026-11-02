import type { IconDef } from '../icon-types.ts';

/**
 * Action glyphs (`action.*`) — interactive chrome: search, close, chevrons, edit, sort.
 * Geometry follows the shared rules in `../icon-types.ts` companions: 4–20 optical box,
 * one 1.75 stroke, round caps and joins, filled dots at r=1.35.
 */
export const ACTION_ICONS: Record<string, IconDef> = {
    'action.search': {
        kind: 'stroke',
        circles: [{ cx: 11, cy: 11, r: 7 }],
        paths: ['M16 16L20 20'],
    },
    'action.close': {
        kind: 'stroke',
        paths: ['M6 6L18 18', 'M18 6L6 18'],
    },
    'action.check': {
        kind: 'stroke',
        paths: ['M5 12L10 17L19 7'],
    },
    'action.chevron-down': {
        kind: 'stroke',
        paths: ['M6 9L12 15L18 9'],
    },
    'action.chevron-right': {
        kind: 'stroke',
        paths: ['M9 6L15 12L9 18'],
    },
    'action.menu': {
        kind: 'stroke',
        paths: ['M4 7H20', 'M4 12H20', 'M4 17H20'],
    },
    'action.plus': {
        kind: 'stroke',
        paths: ['M12 5V19', 'M5 12H19'],
    },
    'action.copy': {
        kind: 'stroke',
        paths: ['M8 8H20V20H8Z', 'M16 8V4H4V16H8'],
    },
    'action.chevron-up': {
        kind: 'stroke',
        paths: ['M6 15L12 9L18 15'],
    },
    'action.chevron-left': {
        kind: 'stroke',
        paths: ['M15 6L9 12L15 18'],
    },
    'action.minus': {
        kind: 'stroke',
        paths: ['M5 12H19'],
    },
    'action.more': {
        kind: 'stroke',
        paths: [],
        dots: [
            { cx: 5, cy: 12, r: 1.35 },
            { cx: 12, cy: 12, r: 1.35 },
            { cx: 19, cy: 12, r: 1.35 },
        ],
    },
    'action.filter': {
        kind: 'stroke',
        paths: ['M4 6H20L14 13V19L10 17V13L4 6Z'],
    },
    'action.calendar': {
        kind: 'stroke',
        paths: ['M4 8H20V20H4Z', 'M4 12H20', 'M8 4V8', 'M16 4V8'],
    },
    'action.upload': {
        kind: 'stroke',
        paths: ['M12 15V4', 'M7 9L12 4L17 9', 'M4 16V20H20V16'],
    },
    'action.download': {
        kind: 'stroke',
        paths: ['M12 4V15', 'M7 10L12 15L17 10', 'M4 16V20H20V16'],
    },
    'action.sort': {
        kind: 'stroke',
        paths: ['M8 18V6', 'M5 9L8 6L11 9', 'M16 6V18', 'M13 15L16 18L19 15'],
    },
    'action.sort-asc': {
        kind: 'stroke',
        paths: ['M8 18V6', 'M5 9L8 6L11 9', 'M14 14V18', 'M17 11V18', 'M20 8V18'],
    },
    'action.sort-desc': {
        kind: 'stroke',
        paths: ['M8 6V18', 'M5 15L8 18L11 15', 'M14 8V18', 'M17 11V18', 'M20 14V18'],
    },
    'action.external': {
        kind: 'stroke',
        paths: ['M14 4H20V10', 'M20 4L11 13', 'M18 14V20H4V6H10'],
    },
    'action.arrow-right': {
        kind: 'stroke',
        paths: ['M4 12H20', 'M14 6L20 12L14 18'],
    },
    'action.arrow-left': {
        kind: 'stroke',
        paths: ['M20 12H4', 'M10 6L4 12L10 18'],
    },
    'action.trash': {
        kind: 'stroke',
        paths: ['M4 7H20', 'M9 7V4H15V7', 'M6 7L7 20H17L18 7', 'M10 11V16', 'M14 11V16'],
    },
    'action.edit': {
        kind: 'stroke',
        paths: ['M4 20L5 16L16 5L19 8L8 19L4 20Z', 'M13.5 7.5L16.5 10.5'],
    },
    'action.refresh': {
        kind: 'stroke',
        paths: ['M20 12A8 8 0 1 1 17.1 5.9L20 8', 'M15.5 8H20V3.5'],
    },
    'action.history': {
        kind: 'stroke',
        paths: ['M4 12A8 8 0 1 0 6.9 5.9L4 8', 'M4 3.5V8H8.5', 'M12 7V12L15.5 14'],
    },
    'action.moon': {
        kind: 'stroke',
        paths: ['M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z'],
    },
    'action.sun': {
        kind: 'stroke',
        circles: [{ cx: 12, cy: 12, r: 4 }],
        paths: [
            'M12 3V6',
            'M12 18V21',
            'M3 12H6',
            'M18 12H21',
            'M5.6 5.6L7.8 7.8',
            'M16.2 16.2L18.4 18.4',
            'M18.4 5.6L16.2 7.8',
            'M7.8 16.2L5.6 18.4',
        ],
    },
    'action.monitor': {
        kind: 'stroke',
        paths: ['M4 5H20V17H4Z', 'M9 20H15', 'M12 17V20'],
    },
    'action.search-document': {
        kind: 'stroke',
        paths: ['M4 4H13L17 8V20H4Z', 'M13 4V8H17', 'M16.1 16.1L20 20'],
        circles: [{ cx: 14, cy: 14, r: 3 }],
    },
};
