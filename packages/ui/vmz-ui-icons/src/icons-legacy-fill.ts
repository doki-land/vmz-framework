import type { IconDef } from './icon-types.ts';

/** Legacy fill silhouettes — tool.* and transitional entries pending text-badge migration. */
export const LEGACY_FILL_ICONS: Record<string, IconDef> = {
    'feature.ssr': {
        kind: 'fill',
        d: 'M4 6h16v4H4V6zm0 6h10v4H4v-4zm12 0h4v4h-4v-4z',
    },
    'tool.base64': {
        kind: 'fill',
        d: 'M5 5h6v3H8v3h3v3H5V5zm8 0h6v14h-6V5zm2 2v10h2V7h-2z',
    },
    'tool.base36': {
        kind: 'fill',
        d: 'M6 6h4l3 6-3 6H6l3-6-3-6zm8 0h4v12h-4V6z',
    },
    'tool.hex': {
        kind: 'fill',
        d: 'M7 5h3l2 4-2 4H7l2-4-2-4zm7 0h3l2 4-2 4h-3l2-4-2-4z',
    },
    'tool.radix': {
        kind: 'fill',
        d: 'M5 7h14v2H5V7zm0 4h10v2H5v-2zm0 4h14v2H5v-2z',
    },
    'tool.url': {
        kind: 'fill',
        d: 'M10.6 8.4a3.5 3.5 0 0 1 4.9 0l1.1 1.1a3.5 3.5 0 0 1 0 4.9l-.8.8-1.4-1.4.8-.8a1.5 1.5 0 0 0 0-2.1l-1.1-1.1a1.5 1.5 0 0 0-2.1 0l-.8.8L9.8 9.2l.8-.8zm2.8 2.8 1.4 1.4-4.2 4.2a3.5 3.5 0 0 1-4.9 0l-1.1-1.1a3.5 3.5 0 0 1 0-4.9l.8-.8 1.4 1.4-.8.8a1.5 1.5 0 0 0 0 2.1l1.1 1.1a1.5 1.5 0 0 0 2.1 0l4.2-4.2z',
    },
    'tool.html-entities': {
        kind: 'fill',
        d: 'M8 7 5 12l3 5h2l-2.5-5L10 7H8zm8 0h-2l2.5 5L14 17h2l3-5-3-5zM11 16h2v2h-2v-2z',
    },
    'tool.ascii': {
        kind: 'fill',
        d: 'M6 16V8h3a3 3 0 0 1 0 6H8v2H6zm2-4h1a1 1 0 1 0 0-2H8v2zm5 4V8h2v8h-2zm4 0V8h2l-2 4 2 4h-2z',
    },
    'tool.binary-text': {
        kind: 'fill',
        d: 'M5 5h4v4H5V5zm10 0h4v4h-4V5zM5 15h4v4H5v-4zm6-8h2v2h-2V7zm0 4h2v2h-2v-2zm0 4h2v2h-2v-2zm4-8h2v2h-2V7zm0 4h2v2h-2v-2zm0 4h2v2h-2v-2z',
    },
    'tool.temperature': {
        kind: 'fill',
        d: 'M12 3a4 4 0 0 0-4 4v6.1a6 6 0 1 0 8 0V7a4 4 0 0 0-4-4zm0 2a2 2 0 0 1 2 2v6.3a4 4 0 1 1-4 0V7a2 2 0 0 1 2-2zm0 4.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
    },
    'tool.length': {
        kind: 'fill',
        d: 'M4 11h16v2H4v-2zm2-4 3 3-1.4 1.4L4.6 8.4 6 7zm12 0 1.4 1.4-3 3L15 10l3-3z',
    },
    'tool.weight': {
        kind: 'fill',
        d: 'M12 3a3 3 0 0 1 2.8 4H19l-2 11H7L5 7h4.2A3 3 0 0 1 12 3zm0 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2z',
    },
    'tool.speed': {
        kind: 'fill',
        d: 'M13 4.1A8 8 0 1 0 12 20v-2a6 6 0 1 1 1-11.9V4.1zM12 8l4.5 2.6L12 13.2 7.5 10.6 12 8zm0 3.8 2.7 1.6L12 15 9.3 13.4 12 11.8z',
    },
    'tool.area': {
        kind: 'fill',
        d: 'M5 5h14v14H5V5zm2 2v10h10V7H7z',
    },
    'tool.volume': {
        kind: 'fill',
        d: 'M6 8h12v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8zm2 2v8h8v-8H8zm2-6h4v2H10V4z',
    },
    'tool.time-units': {
        kind: 'fill',
        d: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 2a7 7 0 1 1 0 14 7 7 0 0 1 0-14zm-.8 3.5V12l3.2 1.9.8-1.4-2.4-1.4V8.5h-1.6z',
    },
    'tool.data-size': {
        kind: 'fill',
        d: 'M5 6h14v3H5V6zm0 5h10v3H5v-3zm0 5h14v2H5v-2z',
    },
    'tool.color': {
        kind: 'fill',
        d: 'M12 3c-3.9 0-7 2.7-7 6.2 0 2.2 1.4 3.8 3.5 3.8 1 0 1.8-.5 2.4-1.2.6.7 1.4 1.2 2.4 1.2 2.1 0 3.5-1.6 3.5-3.8C17 5.7 13.9 3 12 3zm-4.5 5.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm9 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z',
    },
    'tool.rgb-hsl': {
        kind: 'fill',
        d: 'M6 18 10 6h1l4 12h-2l-.8-2.4H8.8L8 18H6zm2.6-4.4h2.8L9.7 9.8 8.6 13.6zm7.1 4.4V6h2v12h-2z',
    },
    'tool.px-rem': {
        kind: 'fill',
        d: 'M6 16V8h3l2 4-2 4H6zm8 0V8h2v8h-2zm-6-4h1.2l.8-1.6.8 1.6H11z',
    },
    'tool.percentage': {
        kind: 'fill',
        d: 'M7 7h4v4H7V7zm6 6h4v4h-4v-4zM8.8 15.2 15.2 8.8l1.4 1.4-6.4 6.4-1.4-1.4z',
    },
    'tool.ratio': {
        kind: 'fill',
        d: 'M5 7h14v2H5V7zm0 8h14v2H5v-2zm4-6h2v8h-2V9zm6 0h2v8h-2V9z',
    },
    'tool.average': {
        kind: 'fill',
        d: 'M5 18h14v2H5v-2zm2.2-4 2.4-7 2.2 5.5L14.4 8l2.6 6H5.2z',
    },
    'tool.tip': {
        kind: 'fill',
        d: 'M12 3c-3.3 0-6 2-6 4.5 0 1.4.8 2.6 2.1 3.3L7 14h10l-1.1-3.2c1.3-.7 2.1-1.9 2.1-3.3C18 5 15.3 3 12 3zm-2 15h4v2h-4v-2z',
    },
    'tool.discount': {
        kind: 'fill',
        d: 'M7 7h4v4H7V7zm6 6h4v4h-4v-4zM8.8 15.2 15.2 8.8l1.4 1.4-6.4 6.4-1.4-1.4zM5 18h3v2H5v-2zm11 0h3v2h-3v-2z',
    },
    'tool.aspect-ratio': {
        kind: 'fill',
        d: 'M5 7h14v10H5V7zm2 2v6h10V9H7z',
    },
    'tool.nearest-tenth': {
        kind: 'fill',
        d: 'M6 7h12v2H6V7zm0 4h8v2H6v-2zm0 4h12v2H6v-2z',
    },
    'tool.gpa': {
        kind: 'fill',
        d: 'M6 6h4v12H6V6zm8 0h4v12h-4V6zm-8 8h12v2H6v-2z',
    },
    'tool.bandwidth': {
        kind: 'fill',
        d: 'M4 12h3l2-4 3 8 2-4h6v2h-4.5l-2 4-3-8-2 4H4v-2z',
    },
    'tool.percent-change': {
        kind: 'fill',
        d: 'M6 16 12 8l3 4 5-8 2 3v5H6zm-1 2h14v2H5v-2z',
    },
    'tool.grade-curve': {
        kind: 'fill',
        d: 'M5 17c2-6 4-8 7-8s5 2 7 8H5z',
    },
    'tool.ohm': {
        kind: 'fill',
        d: 'M7 8h2v3h6V8h2v8h-2v-3H9v3H7V8z',
    },
};
