# Basemap provenance and license

`src/ne-110m-lite.json` derives from **Natural Earth** `ne_110m_admin_0_countries`
(<https://github.com/nvkelso/natural-earth-vector>, `geojson/ne_110m_admin_0_countries.geojson`).

Natural Earth data is **public domain** (<https://www.naturalearthdata.com/about/terms-of-use/>):

> All versions of Natural Earth raster + vector map data found on this website
> are in the public domain. You may use the maps as you see fit, including for
> commercial purposes.

Derivation: feature properties reduced to `name` and `iso_a3`; ring coordinates
rounded to 2 decimal places (~1.1 km at the equator). Attribution is not
required by the license, but this file keeps the provenance on record.
