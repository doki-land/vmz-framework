import type { IconDef } from '../icon-types.ts';

/** Device glyphs (`device.*`) — hardware, deployment and access control landmarks. */
export const DEVICE_ICONS: Record<string, IconDef> = {
    'device.server': {
        kind: 'stroke',
        paths: ['M4 5H20V11H4Z', 'M4 13H20V19H4Z'],
        dots: [
            { cx: 7, cy: 8, r: 1.5 },
            { cx: 7, cy: 16, r: 1.5 },
        ],
    },
    'device.mobile': {
        kind: 'stroke',
        paths: ['M7 3H17V21H7Z', 'M11 18H13'],
    },
    'device.tablet': {
        kind: 'stroke',
        paths: ['M5 4H19V20H5Z', 'M11 17.5H13'],
    },
    'device.network': {
        kind: 'stroke',
        circles: [
            { cx: 12, cy: 12, r: 2.2 },
            { cx: 12, cy: 5, r: 1.8 },
            { cx: 5.5, cy: 18.5, r: 1.8 },
            { cx: 18.5, cy: 18.5, r: 1.8 },
        ],
        paths: ['M12 10V7', 'M10.2 13.2L7 16.3', 'M13.8 13.2L17 16.3'],
    },
    'device.shield': {
        kind: 'stroke',
        paths: ['M12 3L19 6V11C19 15.5 16 18.5 12 20C8 18.5 5 15.5 5 11V6L12 3Z'],
    },
    'device.key': {
        kind: 'stroke',
        circles: [{ cx: 8, cy: 8, r: 4 }],
        paths: ['M10.8 10.8L19.5 19.5', 'M16 16L18 18', 'M18.5 13.5L20.5 15.5'],
    },
    'device.lock': {
        kind: 'stroke',
        paths: ['M6 11H18V20H6Z', 'M9 11V8A3 3 0 0 1 15 8V11'],
    },
    'device.lock-unlock': {
        kind: 'stroke',
        paths: ['M6 11H18V20H6Z', 'M9 11V8A3 3 0 0 1 14.8 6.2'],
    },
};
