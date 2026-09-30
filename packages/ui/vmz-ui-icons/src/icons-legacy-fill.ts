import type { IconDef } from './icon-types.ts';

/** Deferred fill silhouettes — pending stroke redraw or removal. */
export const LEGACY_FILL_ICONS: Record<string, IconDef> = {
    'feature.ssr': {
        kind: 'fill',
        d: 'M4 6h16v4H4V6zm0 6h10v4H4v-4zm12 0h4v4h-4v-4z',
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
    'tool.aspect-ratio': {
        kind: 'fill',
        d: 'M5 7h14v10H5V7zm2 2v6h10V9H7z',
    },
    'tool.bandwidth': {
        kind: 'fill',
        d: 'M4 12h3l2-4 3 8 2-4h6v2h-4.5l-2 4-3-8-2 4H4v-2z',
    },
    'tool.percent-change': {
        kind: 'fill',
        d: 'M6 16 12 8l3 4 5-8 2 3v5H6zm-1 2h14v2H5v-2z',
    },
    'tool.ohm': {
        kind: 'fill',
        d: 'M7 8h2v3h6V8h2v8h-2v-3H9v3H7V8z',
    },
    'tool.speed': {
        kind: 'fill',
        d: 'M13 4.1A8 8 0 1 0 12 20v-2a6 6 0 1 1 1-11.9V4.1zM12 8l4.5 2.6L12 13.2 7.5 10.6 12 8zm0 3.8 2.7 1.6L12 15 9.3 13.4 12 11.8z',
    },
};
