import type { IconDef } from '../icon-types.ts';

/** Commerce glyphs (`commerce.*`) — payment instruments, carts and scan codes. */
export const COMMERCE_ICONS: Record<string, IconDef> = {
    'commerce.card': {
        kind: 'stroke',
        paths: ['M3 6.5H21V17.5H3Z', 'M3 10H21', 'M6 14.5H9'],
    },
    'commerce.cart': {
        kind: 'stroke',
        paths: ['M3 4.5H5.8L8.2 14.5H19L21 7.5H7'],
        circles: [
            { cx: 9.5, cy: 18.5, r: 1.6 },
            { cx: 17.5, cy: 18.5, r: 1.6 },
        ],
    },
    'commerce.qr': {
        kind: 'stroke',
        paths: [
            'M4 4H10V10H4Z',
            'M14 4H20V10H14Z',
            'M4 14H10V20H4Z',
            'M14 14H16V16H14Z',
            'M18 14H20V16H18Z',
            'M14 18H16V20H14Z',
            'M18 18H20V20H18Z',
        ],
        dots: [
            { cx: 7, cy: 7, r: 1.5 },
            { cx: 17, cy: 7, r: 1.5 },
            { cx: 7, cy: 17, r: 1.5 },
        ],
    },
};
