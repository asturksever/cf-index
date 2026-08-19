"""City registry for the index pipeline.

Every script takes --city <slug> and reads its geography and price filter from
here. The price side needs no per-city download at all: the Land Registry CSVs
are national, so a city is just a different `ppd_county` filter over files that
are already on disk.
"""

import argparse
import json
from pathlib import Path

CITIES = {
    "london": {
        "name": "London",
        "osm_relation": 175342,  # Greater London
        "ppd_county": "GREATER LONDON",
    },
    "manchester": {
        "name": "Manchester",
        "osm_relation": 88084,  # Greater Manchester
        "ppd_county": "GREATER MANCHESTER",
    },
    "liverpool": {
        "name": "Liverpool",
        "osm_relation": 147564,  # Merseyside
        "ppd_county": "MERSEYSIDE",
    },
}

DEFAULT = "london"


def boundary_path(slug: str) -> Path:
    return Path(f"data/raw/boundary_{slug}.geojson")


def raw_pois_path(slug: str) -> Path:
    return Path(f"data/raw/overture_pois_{slug}.parquet")


def build_dir(slug: str) -> Path:
    p = Path("data/build") / slug
    p.mkdir(parents=True, exist_ok=True)
    return p


def public_dir(slug: str) -> Path:
    p = Path("public/data") / slug
    p.mkdir(parents=True, exist_ok=True)
    return p


def bbox(slug: str, margin: float = 0.02) -> dict:
    """Bounding box of the city boundary, padded a little.

    Derived from the boundary rather than hand-written, so adding a city means
    supplying one OSM relation id and nothing else.
    """
    from shapely.geometry import shape

    geom = shape(json.loads(boundary_path(slug).read_text()))
    w, s, e, n = geom.bounds
    return {
        "xmin": w - margin,
        "ymin": s - margin,
        "xmax": e + margin,
        "ymax": n + margin,
    }


def parse_city() -> tuple[str, dict]:
    """Shared --city argument. Returns (slug, config)."""
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("--city", default=DEFAULT, choices=sorted(CITIES))
    ap.add_argument("--refresh", action="store_true", help="ignore cached downloads")
    args, _ = ap.parse_known_args()
    return args.city, CITIES[args.city]
