import type { IconDef } from '../icon-types.ts';

/** Status glyphs (`status.*`) — alert and outcome semantics, never color-only signals. */
export const STATUS_ICONS: Record<string, IconDef> = {
    'status.info': {
        kind: 'stroke',
        circles: [{ cx: 12, cy: 12, r: 9 }],
        paths: ['M12 11V16'],
        dots: [{ cx: 12, cy: 8, r: 1.5 }],
    },
    'status.warning': {
        kind: 'stroke',
        paths: ['M12.5 5.1L19.5 18.9Q20 20 18.8 20H5.2Q4 20 4.5 18.9L11.5 5.1Q12 4 12.5 5.1Z', 'M12 9V13'],
        dots: [{ cx: 12, cy: 16.5, r: 1.5 }],
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
        dots: [{ cx: 12, cy: 17, r: 1.5 }],
    },
    'status.question': {
        kind: 'stroke',
        circles: [{ cx: 12, cy: 12, r: 9 }],
        paths: ['M9.5 9.2A2.6 2.6 0 0 1 12 7.5C13.4 7.5 14.5 8.6 14.5 9.8C14.5 11 13.6 11.6 12.7 12.1C12.3 12.4 12 12.7 12 13.2V14'],
        dots: [{ cx: 12, cy: 16.8, r: 1.5 }],
    },
    'status.offline': {
        kind: 'stroke',
        paths: ['M3 9A13 13 0 0 1 21 9', 'M6.5 12.5A8.5 8.5 0 0 1 17.5 12.5', 'M4 20L20 4'],
        dots: [{ cx: 12, cy: 16, r: 1.5 }],
    },
};
