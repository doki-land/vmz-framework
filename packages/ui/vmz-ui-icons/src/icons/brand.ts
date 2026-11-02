import type { IconDef } from '../icon-types.ts';

/**
 * Product brand glyphs (`brand.*`) — silhouette language like `social.*`, kept separate
 * so package registries and runtimes are not mixed into social link rows. Geometry from
 * Simple Icons (https://simpleicons.org), licensed CC0-1.0; trademarks belong to their owners.
 */
export const BRAND_ICONS: Record<string, IconDef> = {
    'brand.npm': {
        kind: 'fill',
        d: 'M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C24 .786 23.214 0 22.237 0zM5.13 5.323l13.837.019-.009 13.836h-3.464l.01-10.382h-3.456L12.04 19.17H5.113z',
    },
};
