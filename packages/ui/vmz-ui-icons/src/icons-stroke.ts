import type { IconDef } from './icon-types.ts';

/** Outlined icon set — 24 grid, 1.75 stroke, 3–21 safe area. */
export const STROKE_ICONS: Record<string, IconDef> = {
    'action.search': {
        kind: 'stroke',
        circles: [{ cx: 10.5, cy: 10.5, r: 7.5 }],
        paths: ['M15.8 15.8L20 20'],
    },
    'action.close': {
        kind: 'stroke',
        paths: ['M7 7L17 17', 'M17 7L7 17'],
    },
    'action.check': {
        kind: 'stroke',
        paths: ['M5 12L10 17L19 7'],
    },
    'action.chevron-down': {
        kind: 'stroke',
        paths: ['M7 10L12 15L17 10'],
    },
    'action.chevron-right': {
        kind: 'stroke',
        paths: ['M10 7L15 12L10 17'],
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
        paths: ['M9 9H17V17H9Z', 'M6 6H14V14'],
    },
    'nav.home': {
        kind: 'stroke',
        paths: ['M4 10.5L12 4L20 10.5', 'M6 10V19H18V10', 'M10 19V13H14V19'],
    },
    'nav.language': {
        kind: 'stroke',
        circles: [{ cx: 12, cy: 12, r: 9 }],
        paths: [
            'M12 3V21',
            'M3 12H21',
            'M5.5 7.5C8 5.5 16 5.5 18.5 7.5',
            'M5.5 16.5C8 18.5 16 18.5 18.5 16.5',
        ],
    },
    'status.info': {
        kind: 'stroke',
        circles: [{ cx: 12, cy: 12, r: 9 }],
        paths: ['M12 11V16'],
        dots: [{ cx: 12, cy: 8, r: 1 }],
    },
    'status.warning': {
        kind: 'stroke',
        paths: ['M12 4L20 19H4L12 4Z', 'M12 10V14'],
        dots: [{ cx: 12, cy: 17, r: 1 }],
    },
    'status.success': {
        kind: 'stroke',
        circles: [{ cx: 12, cy: 12, r: 9 }],
        paths: ['M8 12L11 15L16 9'],
    },
    'status.danger': {
        kind: 'stroke',
        circles: [{ cx: 12, cy: 12, r: 9 }],
        paths: ['M12 8V13'],
        dots: [{ cx: 12, cy: 16.5, r: 1 }],
    },
    'feature.incremental': {
        kind: 'stroke',
        circles: [{ cx: 5, cy: 12, r: 2 }, { cx: 19, cy: 12, r: 2 }, { cx: 12, cy: 6, r: 2 }],
        paths: ['M7 12H10', 'M14 12H17', 'M12 8V10', 'M8.2 11.2L11 8.5', 'M12.8 8.5L15.6 11.2'],
    },
    'feature.runtime': {
        kind: 'stroke',
        paths: ['M8.5 7.5H15.5V16.5H8.5Z', 'M11 10L14.5 12L11 14Z'],
    },
    'feature.deploy': {
        kind: 'stroke',
        paths: ['M4 16H20', 'M12 6V14', 'M8.5 10.5L12 6L15.5 10.5'],
    },
};
