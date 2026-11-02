import type { IconDef } from '../icon-types.ts';

/** Media glyphs (`media.*`) — playback transport, capture devices and audio state. */
export const MEDIA_ICONS: Record<string, IconDef> = {
    'media.play': {
        kind: 'stroke',
        paths: ['M8.77 6.04L17.65 11.47Q18.5 12 17.65 12.53L8.77 17.96Q8 18.5 8 17.6V6.4Q8 5.5 8.77 6.04Z'],
    },
    'media.pause': {
        kind: 'stroke',
        paths: ['M8.5 5V19', 'M15.5 5V19'],
    },
    'media.stop': {
        kind: 'stroke',
        paths: ['M7 7H17V17H7Z'],
    },
    'media.next': {
        kind: 'stroke',
        paths: ['M7.06 6.42L13.78 11.4Q14.5 12 13.78 12.6L7.06 17.58Q6.5 18 6.5 17.3V6.7Q6.5 6 7.06 6.42Z', 'M17.5 6V18'],
    },
    'media.previous': {
        kind: 'stroke',
        paths: ['M16.94 6.42L10.22 11.4Q9.5 12 10.22 12.6L16.94 17.58Q17.5 18 17.5 17.3V6.7Q17.5 6 16.94 6.42Z', 'M6.5 6V18'],
    },
    'media.volume': {
        kind: 'stroke',
        paths: ['M11 5L6 9H3V15H6L11 19V5Z', 'M15.5 8.5A5 5 0 0 1 15.5 15.5', 'M18.5 5.5A10 10 0 0 1 18.5 18.5'],
    },
    'media.volume-muted': {
        kind: 'stroke',
        paths: ['M11 5L6 9H3V15H6L11 19V5Z', 'M16 9.5L21 14.5', 'M21 9.5L16 14.5'],
    },
    'media.microphone': {
        kind: 'stroke',
        paths: ['M9 4A3 3 0 0 1 15 4V11A3 3 0 0 1 9 11V4Z', 'M6 11A6 6 0 0 0 18 11', 'M12 17V20', 'M9 20H15'],
    },
    'media.camera': {
        kind: 'stroke',
        paths: ['M4 8H7L9 5.5H15L17 8H20V18H4Z'],
        circles: [{ cx: 12, cy: 12.5, r: 3 }],
    },
    'media.image': {
        kind: 'stroke',
        paths: ['M4 5H20V19H4Z', 'M4 16L9.5 10.5L13 14L16 11L20 15'],
        circles: [{ cx: 15.5, cy: 8.5, r: 1.5 }],
    },
};
