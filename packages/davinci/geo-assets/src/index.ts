// Basemap assets — plain data, no engine coupling. Hosts register maps with
// `registerGeoMap` from `@doki-land/davinci/chart` when they want them.

import lite from "./ne-110m-lite.js";

/** GeoJSON Feature shape the geo registry consumes. */
export interface GeoFeature {
    readonly type: "Feature";
    readonly properties: { readonly name: string; readonly iso_a3: string };
    readonly geometry:
        | { readonly type: "Polygon"; readonly coordinates: ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>> }
        | { readonly type: "MultiPolygon"; readonly coordinates: ReadonlyArray<ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>>> };
}

export interface GeoFeatureCollection {
    readonly type: "FeatureCollection";
    readonly features: ReadonlyArray<GeoFeature>;
}

/** Natural Earth 110m admin-0 countries, properties trimmed and coordinates
 *  rounded to 2 decimals (public domain — see NATURAL-EARTH-LICENSE.md). */
export const NE_110M_LITE: GeoFeatureCollection = lite as GeoFeatureCollection;
