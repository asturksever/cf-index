#!/usr/bin/env python3
"""Fetch a city's administrative boundary polygon from OpenStreetMap.

Boundaries are small and stable, so they are cached and committed. Pass
--city <slug> (see scripts/cities.py) and --refresh to re-download.
"""

import json
import sys

import requests
from shapely.geometry import mapping, shape
from shapely.ops import unary_union
from shapely.validation import make_valid

sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent))
from cities import boundary_path, parse_city  # noqa: E402

URL = "https://polygons.openstreetmap.fr/get_geojson.py?id={rel}&params=0"

# Sanity band in square degrees. Has to span a metro county (Merseyside, ~0.1)
# and the whole UK (~57), so it only catches fetching a point or a single
# borough by mistake, not a legitimately large geography.
MIN_AREA_DEG2, MAX_AREA_DEG2 = 0.02, 120.0


def main() -> None:
    slug, cfg = parse_city()
    cache = boundary_path(slug)

    if cache.exists() and "--refresh" not in sys.argv:
        print(f"using cached boundary: {cache}")
        return

    # A geography can be more than one relation (England & Wales is two), so
    # fetch each and union them into a single polygon.
    rels = cfg["osm_relation"]
    rels = rels if isinstance(rels, list) else [rels]
    print(f"fetching {cfg['name']} (OSM relation{'s' if len(rels) > 1 else ''} {rels})")

    parts = []
    for rel in rels:
        resp = requests.get(URL.format(rel=rel), timeout=300)
        resp.raise_for_status()
        parts.append(make_valid(shape(resp.json())))
    geom = parts[0] if len(parts) == 1 else unary_union(parts)
    geom = make_valid(geom)
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
