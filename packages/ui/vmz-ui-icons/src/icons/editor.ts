import type { IconDef } from '../icon-types.ts';

/**
 * Editor glyphs (`editor.*`) — the formatting toolbar surface. `editor.bold` and
 * `editor.italic` use text badges because the letterforms are the honest mark.
 */
export const EDITOR_ICONS: Record<string, IconDef> = {
    'editor.format': {
        kind: 'stroke',
        paths: ['M13 4V20', 'M17 4V20', 'M19 4H9.5A4.5 4.5 0 0 0 9.5 13H13'],
    },
    'editor.bold': { kind: 'text-badge', label: 'B' },
    'editor.italic': { kind: 'text-badge', label: 'I' },
    'editor.code': {
        kind: 'stroke',
        paths: ['M16 7L21 12L16 17', 'M8 7L3 12L8 17'],
    },
    'editor.quote': {
        kind: 'stroke',
        paths: [
            'M9 6C7 7 6 9 6 12C6 14 7.2 15.5 8.8 15.5C10.4 15.5 11.5 14.3 11.5 12.8C11.5 11.3 10.4 10.2 9 10.2C8.7 10.2 8.4 10.3 8.1 10.4C8.3 9 9 7.7 10.5 6.9L9 6Z',
            'M17 6C15 7 14 9 14 12C14 14 15.2 15.5 16.8 15.5C18.4 15.5 19.5 14.3 19.5 12.8C19.5 11.3 18.4 10.2 17 10.2C16.7 10.2 16.4 10.3 16.1 10.4C16.3 9 17 7.7 18.5 6.9L17 6Z',
        ],
    },
    'editor.list-ordered': {
        kind: 'stroke',
        paths: [
            'M10.5 6H21',
            'M10.5 12H21',
            'M10.5 18H21',
            'M4 5.5L5.5 4.5V9.5',
            'M3.8 12.2C4.2 11.7 5 11.4 5.7 11.7C6.4 12 6.5 12.9 6 13.5L3.8 15.8H6.5',
            'M4 17.3C4.6 17 5.5 17 6 17.5C6.4 18 6.1 18.6 5.4 18.8C6.1 19 6.4 19.6 6 20.1C5.5 20.6 4.6 20.6 4 20.3',
        ],
    },
    'editor.list-unordered': {
        kind: 'stroke',
        paths: ['M10.5 6H21', 'M10.5 12H21', 'M10.5 18H21'],
        dots: [
            { cx: 5.5, cy: 6, r: 1.5 },
            { cx: 5.5, cy: 12, r: 1.5 },
            { cx: 5.5, cy: 18, r: 1.5 },
        ],
    },
    'editor.indent': {
        kind: 'stroke',
        paths: ['M21 5H3', 'M21 12H9', 'M21 19H3', 'M3 9L6.5 12L3 15'],
    },
    'editor.outdent': {
        kind: 'stroke',
        paths: ['M21 5H3', 'M21 12H9', 'M21 19H3', 'M6.5 9L3 12L6.5 15'],
    },
    'editor.wrap': {
        kind: 'stroke',
        paths: ['M3 6H21', 'M3 12H18A3.5 3.5 0 0 1 18 19H14', 'M16.5 16.5L14 19L16.5 21.5'],
    },
    'editor.split': {
        kind: 'stroke',
        paths: ['M4 4H20V20H4Z', 'M12 4V20'],
    },
};
