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
    # England & Wales, not the whole UK, and the reason is the price data.
    # Price Paid covers England and Wales only: Northern Ireland came back 0%
    # priced and Scotland 7%, so including them meant a map where half the
    # layers were blank and every postcode search said "too few sales".
    # Scotland's register is held by Registers of Scotland on different terms.
    "engwales": {
        "name": "England & Wales",
        "osm_relation": [58447, 58437],  # England, Wales
        "ppd_county": None,  # no county filter: take every row in the CSVs
    },
    # Single-city builds are still supported — handy for iterating on the
    # classifier without reprocessing the country — but the site ships the
    # England & Wales build above.
    "london": {
        "name": "London",
        "osm_relation": 175342,  # Greater London
        "ppd_county": "GREATER LONDON",
    },
}

DEFAULT = "engwales"


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
