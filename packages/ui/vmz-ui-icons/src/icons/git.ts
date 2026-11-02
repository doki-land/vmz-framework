import type { IconDef } from '../icon-types.ts';

/** Git glyphs (`git.*`) — version control and collaboration landmarks. */
export const GIT_ICONS: Record<string, IconDef> = {
    'git.branch': {
        kind: 'stroke',
        circles: [
            { cx: 6, cy: 5, r: 2 },
            { cx: 6, cy: 19, r: 2 },
            { cx: 18, cy: 8, r: 2 },
        ],
        paths: ['M6 7V17', 'M16 8.2C14 10.5 10 11.5 6 12.5'],
    },
    'git.commit': {
        kind: 'stroke',
        circles: [{ cx: 12, cy: 12, r: 4.5 }],
        paths: ['M4 12H7.5', 'M16.5 12H20'],
    },
    'git.merge': {
        kind: 'stroke',
        circles: [
            { cx: 5, cy: 5, r: 2 },
            { cx: 5, cy: 19, r: 2 },
            { cx: 19, cy: 12, r: 2 },
        ],
        paths: ['M5 7V17', 'M7 6C9 8 12 10.5 17 11.5', 'M7 18C9 16 12 13.5 17 12.5'],
    },
    'git.pull-request': {
        kind: 'stroke',
        circles: [
            { cx: 6, cy: 6, r: 2 },
            { cx: 6, cy: 18, r: 2 },
            { cx: 18, cy: 18, r: 2 },
        ],
        paths: ['M6 8V16', 'M13 6H16.5C17.6 6 18 6.8 18 8V16', 'M10.5 3.5L13 6L10.5 8.5'],
    },
    'git.fork': {
        kind: 'stroke',
        circles: [
            { cx: 12, cy: 4, r: 2 },
            { cx: 6, cy: 20, r: 2 },
            { cx: 18, cy: 20, r: 2 },
        ],
        paths: ['M12 6V11', 'M12 11C12 14.5 8.5 15 7 18.2', 'M12 11C12 14.5 15.5 15 17 18.2'],
    },
    'git.compare': {
        kind: 'stroke',
        circles: [
            { cx: 6, cy: 6, r: 2 },
            { cx: 18, cy: 18, r: 2 },
        ],
        paths: ['M8 6H13', 'M11 3.5L13.5 6L11 8.5', 'M16 18H11', 'M13 15.5L10.5 18L13 20.5'],
    },
};
