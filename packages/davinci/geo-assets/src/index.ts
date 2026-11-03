// Basemap assets — plain data, no engine coupling. Hosts import the JSON
// payload via the `./ne-110m-lite.json` subpath and register it with
// `registerGeoMap` from `@doki-land/davinci/chart`. This module is types-only:
// the pack graph must never parse data-literal modules as code.

/** Coordinate ring: a closed list of [lon, lat] pairs. */
export type GeoRing = ReadonlyArray<ReadonlyArray<number>>;
/** Polygon coordinates: outer ring plus holes. */
export type GeoPolygon = ReadonlyArray<GeoRing>;

export interface GeoPolygonGeometry {
    readonly type: "Polygon";
    readonly coordinates: GeoPolygon;
}

export interface GeoMultiPolygonGeometry {
    readonly type: "MultiPolygon";
    readonly coordinates: ReadonlyArray<GeoPolygon>;
}

/** GeoJSON Feature shape the geo registry consumes. */
export interface GeoFeature {
    readonly type: "Feature";
    readonly properties: { readonly name: string; readonly iso_a3: string };
    readonly geometry: GeoPolygonGeometry | GeoMultiPolygonGeometry;
}

export interface GeoFeatureCollection {
    readonly type: "FeatureCollection";
    readonly features: ReadonlyArray<GeoFeature>;
}
