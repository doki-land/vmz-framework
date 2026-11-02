import type { IconDef } from './icon-types.ts';

/**
 * Outlined icon set — executable design rules:
 * - 24×24 viewBox; the optical box is 16 units wide (4–20), centerline geometry stays inside 3–21.
 * - One stroke width (`DEFAULT_STROKE_WIDTH`, 1.75) for the whole set, no per-icon overrides.
 * - Round line caps and joins are applied by the renderer, shapes are authored for them.
 * - Square and frame glyphs occupy 4–20; line-only glyphs span 4–20 on their main axis.
 * - Crosses use 6–18, chevrons 6–18 × 9–15, plus/minus 5–19, checks 5–19 × 7–17.
 * - The mathematical mean mark uses an overbar at 6–18 over a cross at 7.5–16.5 × 10–19.
 * - Filled dots use r=1.35 so they carry the same optical weight as a 1.75 stroke.
 * - Multi-part glyphs must physically connect: arrowheads join their arc, stems join outlines.
 * - Optically centered at (12,12); ground-biased metaphors keep the baseline on y=20.
 * - One silhouette per concept: duplicate or near-duplicate glyphs are gate failures.
 */
export const STROKE_ICONS: Record<string, IconDef> = {
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
    'nav.home': {
        kind: 'stroke',
        paths: ['M4 10.5L12 4L20 10.5', 'M6 10V19H18V10', 'M10 19V13H14V19'],
    },
    'nav.language': {
        kind: 'stroke',
        circles: [{ cx: 12, cy: 12, r: 9 }],
        paths: ['M3 12H21', 'M12 3C15.5 5.5 17 8.5 17 12C17 15.5 15.5 18.5 12 21C8.5 18.5 7 15.5 7 12C7 8.5 8.5 5.5 12 3Z'],
    },
    'status.info': {
        kind: 'stroke',
        circles: [{ cx: 12, cy: 12, r: 9 }],
        paths: ['M12 11V16'],
        dots: [{ cx: 12, cy: 8, r: 1.35 }],
    },
    'status.warning': {
        kind: 'stroke',
        paths: ['M12 4L20 20H4Z', 'M12 9V13'],
        dots: [{ cx: 12, cy: 17, r: 1.35 }],
    },
    'status.success': {
        kind: 'stroke',
        circles: [{ cx: 12, cy: 12, r: 9 }],
        paths: ['M7 12L10.5 15.5L17 9'],
    },
    'status.danger': {
        kind: 'stroke',
        circles: [{ cx: 12, cy: 12, r: 9 }],
        paths: ['M12 7.5V13.5'],
        dots: [{ cx: 12, cy: 17, r: 1.35 }],
    },
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
    'tool.url': {
        kind: 'stroke',
        paths: ['M10 8H8A4 4 0 0 0 8 16H10', 'M14 8H16A4 4 0 0 1 16 16H14', 'M9 12H15'],
    },
    'tool.temperature': {
        kind: 'stroke',
        circles: [{ cx: 12, cy: 16.5, r: 3.5 }],
        paths: ['M10 5A2 2 0 0 1 14 5', 'M10 5V14', 'M14 5V14', 'M12 8V14'],
    },
    'tool.length': {
        kind: 'stroke',
        paths: ['M4 9H20V15H4Z', 'M8 9V12', 'M12 9V13.5', 'M16 9V12'],
    },
    'tool.weight': {
        kind: 'stroke',
        paths: ['M4 9V15', 'M7 7V17', 'M17 7V17', 'M20 9V15', 'M7 12H17'],
    },
    'tool.time-units': {
        kind: 'stroke',
        circles: [{ cx: 12, cy: 12, r: 9 }],
        paths: ['M12 7V12L15.5 14'],
    },
    'tool.color': {
        kind: 'stroke',
        paths: ['M12 3C10 5.5 6 10.5 6 14A6 6 0 0 0 18 14C18 10.5 14 5.5 12 3Z'],
    },
    'tool.percentage': {
        kind: 'stroke',
        circles: [
            { cx: 8.5, cy: 8.5, r: 2.6 },
            { cx: 15.5, cy: 15.5, r: 2.6 },
        ],
        paths: ['M17.2 6.8L6.8 17.2'],
    },
    'tool.area': {
        kind: 'stroke',
        paths: ['M4 4H20V20H4Z', 'M8 8H16V16H8Z'],
    },
    'tool.volume': {
        kind: 'stroke',
        paths: ['M12 4L20 8.5V15.5L12 20L4 15.5V8.5Z', 'M4 8.5L12 12L20 8.5', 'M12 12V20'],
    },
    'tool.data-size': {
        kind: 'stroke',
        paths: [
            'M5 6C5 4.3 8.1 3 12 3C15.9 3 19 4.3 19 6V18C19 19.7 15.9 21 12 21C8.1 21 5 19.7 5 18V6Z',
            'M5 6C5 7.7 8.1 9 12 9C15.9 9 19 7.7 19 6',
            'M5 12C5 13.7 8.1 15 12 15C15.9 15 19 13.7 19 12',
        ],
    },
    'tool.ratio': {
        kind: 'stroke',
        paths: ['M4 10H10V16H4Z', 'M12 8H20V16H12Z'],
    },
    'tool.average': {
        kind: 'stroke',
        paths: ['M6 6H18', 'M7.5 10L16.5 19', 'M16.5 10L7.5 19'],
    },
    'tool.tip': {
        kind: 'stroke',
        paths: ['M12 4C9.5 4 8 6 8 8.5C8 10.3 9 11.7 10.5 12.5V15H13.5V12.5C15 11.7 16 10.3 16 8.5C16 6 14.5 4 12 4Z', 'M9.5 18H14.5', 'M10 20H14'],
    },
    'tool.aspect-ratio': {
        kind: 'stroke',
        paths: ['M4 7H20V17H4Z', 'M8 7V11H4', 'M16 17V13H20'],
    },
    'tool.bandwidth': {
        kind: 'stroke',
        paths: ['M4 20H20', 'M5 20V16', 'M9 20V12', 'M13 20V8', 'M17 20V4'],
    },
    'tool.percent-change': {
        kind: 'stroke',
        paths: ['M4 17L9 12L12 15L20 6', 'M15.5 6H20V10.5'],
    },
    'tool.ohm': {
        kind: 'stroke',
        paths: ['M7 14C7 10.5 9.3 8 12 8C14.7 8 17 10.5 17 14', 'M7 14V17', 'M17 14V17', 'M4.5 17H9.5', 'M14.5 17H19.5'],
    },
    'tool.speed': {
        kind: 'stroke',
        paths: ['M5 14A7 7 0 0 1 19 14', 'M12 14L16 10'],
        dots: [{ cx: 12, cy: 14, r: 1.35 }],
    },
};
