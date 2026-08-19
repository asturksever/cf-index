#!/usr/bin/env python3
"""Fetch a city's administrative boundary polygon from OpenStreetMap.

Boundaries are small and stable, so they are cached and committed. Pass
--city <slug> (see scripts/cities.py) and --refresh to re-download.
"""

import json
import sys

import requests
from shapely.geometry import mapping, shape
from shapely.validation import make_valid

sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent))
from cities import boundary_path, parse_city  # noqa: E402

URL = "https://polygons.openstreetmap.fr/get_geojson.py?id={rel}&params=0"

# Sanity band in square degrees. Generous, but wide enough to catch fetching a
# point, a single borough, or the whole country by mistake.
MIN_AREA_DEG2, MAX_AREA_DEG2 = 0.02, 2.0


def main() -> None:
    slug, cfg = parse_city()
    cache = boundary_path(slug)

    if cache.exists() and "--refresh" not in sys.argv:
        print(f"using cached boundary: {cache}")
        return

    url = URL.format(rel=cfg["osm_relation"])
    print(f"fetching {cfg['name']} (OSM relation {cfg['osm_relation']})")
    resp = requests.get(url, timeout=180)
    resp.raise_for_status()

    geom = make_valid(shape(resp.json()))
    if geom.geom_type == "GeometryCollection":
        polys = [g for g in geom.geoms if g.geom_type in ("Polygon", "MultiPolygon")]
        if not polys:
            raise SystemExit("boundary response contained no polygons")
        geom = max(polys, key=lambda g: g.area)
    if geom.geom_type not in ("Polygon", "MultiPolygon"):
        raise SystemExit(f"unexpected boundary geometry: {geom.geom_type}")
    if not MIN_AREA_DEG2 < geom.area < MAX_AREA_DEG2:
        raise SystemExit(f"boundary area {geom.area:.3f} deg² outside plausible range")

    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(mapping(geom)))
    print(f"wrote {cache} ({geom.geom_type}, bounds {tuple(round(b, 3) for b in geom.bounds)})")


if __name__ == "__main__":
    main()
