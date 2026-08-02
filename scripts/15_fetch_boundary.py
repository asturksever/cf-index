#!/usr/bin/env python3
"""Fetch the Greater London boundary polygon (OSM relation 175342).

Cached at data/raw/london_boundary.geojson (committed). Pass --refresh to re-fetch.
"""

import json
import sys
from pathlib import Path

import requests
from shapely.geometry import shape, mapping
from shapely.validation import make_valid

CACHE = Path("data/raw/london_boundary.geojson")
URL = "https://polygons.openstreetmap.fr/get_geojson.py?id=175342&params=0"


def main() -> None:
    if CACHE.exists() and "--refresh" not in sys.argv:
        print(f"using cached boundary: {CACHE}")
        return

    print(f"fetching {URL}")
    resp = requests.get(URL, timeout=120)
    resp.raise_for_status()
    geojson = resp.json()

    geom = make_valid(shape(geojson))
    if geom.geom_type == "GeometryCollection":
        polys = [g for g in geom.geoms if g.geom_type in ("Polygon", "MultiPolygon")]
        if not polys:
            raise SystemExit("boundary response contained no polygons")
        geom = max(polys, key=lambda g: g.area)
    if geom.geom_type not in ("Polygon", "MultiPolygon"):
        raise SystemExit(f"unexpected boundary geometry: {geom.geom_type}")

    # Sanity: Greater London is ~1,600 km²; in degrees² at 51.5°N that's ~0.29
    if not 0.1 < geom.area < 1.0:
        raise SystemExit(f"boundary area {geom.area:.3f} deg² outside plausible range")

    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps(mapping(geom)))
    print(f"wrote {CACHE} ({geom.geom_type}, bounds {tuple(round(b, 3) for b in geom.bounds)})")


if __name__ == "__main__":
    main()
