import type { IconDef } from '../icon-types.ts';

/** Status glyphs (`status.*`) — alert and outcome semantics, never color-only signals. */
export const STATUS_ICONS: Record<string, IconDef> = {
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
};
