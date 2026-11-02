import type { IconDef } from '../icon-types.ts';

/**
 * Tool glyphs (`tool.*`) — converter and calculator landmarks on tool surfaces.
 * Proprietary converter names that have no honest silhouette use `text-badge`:
 * the mark is real text content in a bounded chip, not a font glyph or emoji.
 */
export const TOOL_ICONS: Record<string, IconDef> = {
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
    'tool.base64': { kind: 'text-badge', label: 'B64' },
    'tool.base36': { kind: 'text-badge', label: 'B36' },
    'tool.hex': { kind: 'text-badge', label: 'HEX' },
    'tool.radix': { kind: 'text-badge', label: 'RAD' },
    'tool.html-entities': { kind: 'text-badge', label: 'ENT' },
    'tool.ascii': { kind: 'text-badge', label: 'ASC' },
    'tool.binary-text': { kind: 'text-badge', label: '01' },
    'tool.rgb-hsl': { kind: 'text-badge', label: 'HSL' },
    'tool.px-rem': { kind: 'text-badge', label: 'px' },
    'tool.gpa': { kind: 'text-badge', label: 'GPA' },
    'tool.nearest-tenth': { kind: 'text-badge', label: '.1' },
    'tool.grade-curve': { kind: 'text-badge', label: 'CV' },
};
