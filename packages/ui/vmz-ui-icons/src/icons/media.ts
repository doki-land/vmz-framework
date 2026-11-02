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
    'media.seek-back': {
        kind: 'stroke',
        paths: ['M10.5 6.5L4 12L10.5 17.5V6.5Z', 'M19.5 6.5L13 12L19.5 17.5V6.5Z'],
    },
    'media.seek-forward': {
        kind: 'stroke',
        paths: ['M4.5 6.5L11 12L4.5 17.5V6.5Z', 'M13.5 6.5L20 12L13.5 17.5V6.5Z'],
    },
    'media.fullscreen': {
        kind: 'stroke',
        paths: ['M4 9V4H9', 'M15 4H20V9', 'M20 15V20H15', 'M9 20H4V15'],
    },
    'media.fullscreen-exit': {
        kind: 'stroke',
        paths: ['M8 3V10H3', 'M16 3V10H21', 'M16 21V14H21', 'M8 21V14H3'],
    },
    'media.pip': {
        kind: 'stroke',
        paths: ['M3 6H21V18H3Z', 'M13 12H18V16H13Z'],
    },
    'media.subtitle': {
        kind: 'stroke',
        paths: ['M3 6H21V18H3Z', 'M6 12H14', 'M6 15H11'],
    },
    'media.cast': {
        kind: 'stroke',
        paths: ['M4 8V5H20V19H14', 'M4 12A8 8 0 0 1 12 19', 'M4 15.5A4 4 0 0 1 7.5 19'],
    },
    'media.repeat': {
        kind: 'stroke',
        paths: ['M17 4L20 7L17 10', 'M4 11V9C4 7.6 5.1 7 6.5 7H20', 'M7 20L4 17L7 14', 'M20 13V15C20 16.4 19 17 17.5 17H4'],
    },
    'media.shuffle': {
        kind: 'stroke',
        paths: ['M3 7H6L18 17H21', 'M3 17H6L8 15', 'M16 9L18 7H21', 'M18 4L21 7L18 10', 'M18 14L21 17L18 20'],
    },
    'media.audio-track': {
        kind: 'stroke',
        circles: [
            { cx: 6.5, cy: 18, r: 2.5 },
            { cx: 18.5, cy: 16, r: 2.5 },
        ],
        paths: ['M9 18V5.5L21 3.5V16'],
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
