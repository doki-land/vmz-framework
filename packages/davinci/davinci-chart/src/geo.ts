// Geo registry — basemap assets live OUTSIDE the engine. Hosts register a
// FeatureCollection under an id and specs reference that id; the engine never
// bundles geography.

/** GeoJSON feature shape the geo mark projects. */
export interface GeoFeature {
    readonly type: "Feature";
    readonly properties: { readonly name: string; readonly iso_a3: string };
    readonly geometry:
        | { readonly type: "Polygon"; readonly coordinates: ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>> }
        | { readonly type: "MultiPolygon"; readonly coordinates: ReadonlyArray<ReadonlyArray < ReadonlyArray < ReadonlyArray < number >>> > };
}

export interface GeoFeatureCollection {
    readonly type: "FeatureCollection";
    readonly features: ReadonlyArray<GeoFeature>;
}

const registry = new Map<string, GeoFeatureCollection>();

/** Register a basemap under an id (host side, at startup / build time). */
export function registerGeoMap(id: string, map: GeoFeatureCollection): void {
    registry.set(id, map);
}

/** Look a basemap up by id; undefined when the host never registered it. */
export function geoMapById(id: string): GeoFeatureCollection | undefined {
    return registry.get(id);
}
