#!/usr/bin/env python3
"""Extract coffee shops and fried-chicken shops for a city from Overture Places.

Reads the pinned Overture release straight from S3 with DuckDB (bbox pushdown
from the city's boundary), classifies locally, clips to that boundary, dedupes,
and writes <build>/pois.parquet. The extract is cached under data/raw/ so a
re-run costs nothing; pass --city <slug> and --refresh to re-download.
"""

import re
import sys
from pathlib import Path

import duckdb
import json
import pandas as pd
import shapely
from shapely.geometry import shape

sys.path.insert(0, str(Path(__file__).parent))
from cities import bbox, boundary_path, build_dir, parse_city, raw_pois_path  # noqa: E402

RELEASE = "2026-07-22.0"
S3_PATH = f"s3://overturemaps-us-west-2/release/{RELEASE}/theme=places/type=place/*.parquet"

COFFEE_CATS = {"cafe", "coffee_shop", "coffee_roastery"}
CHICKEN_CATS = {"chicken_restaurant", "chicken_wings_restaurant"}
# name regex only applies to food-selling places (see FOOD_CATS below)
CHICKEN_NAME = re.compile(
    # Named chains first, then the general rules. The generic "chicken" match
    # matters more than the brand list once you leave London: Merseyside and
    # Greater Manchester are full of one-off shops the London names never hit,
    # and Chesters is a northern chain with no London presence at all.
    r"morley'?s|chicken\s*cottage|sam'?s\s*chicken|dixy|favou?rite\s*chicken"
    r"|chicken\s*valley|\bkfc\b|kentucky\s*fried|\bpfc\b|perfect\s*fried"
    r"|tennessee\s*fried|fried\s*chicken|chesters"
    r"|chick(?:e)?ns?\b"
    r"|p[ie]ri.?p[ie]ri",  # peri-peri/piri-piri is chicken here (Nando's, Pepe's)
    # Deliberately NO bare "wing" rule: "wing" is a common Cantonese name, so it
    # swept up Wing Wah, Wing Lee, Kwok Wing Foods and a coffee bar. Overture's
    # chicken_wings_restaurant category covers genuine wing shops already.
    re.IGNORECASE,
)
FOOD_CAT_HINTS = ("restaurant", "fast_food")  # substring match on the category leaf
FOOD_CATS = COFFEE_CATS | CHICKEN_CATS | {"cafeteria", "food_truck", "food_stand"}

MIN_CONFIDENCE = 0.5
# Truncation guard, not a quality bar: it has to pass for Merseyside as well as
# Greater London, so it sits well below what even the smallest city returns.
MIN_COUNT_GATE = 100


def fetch_raw(slug: str, name: str) -> pd.DataFrame:
    box = bbox(slug)
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';")
    con.execute("INSTALL spatial; LOAD spatial;")
    print(f"querying Overture {RELEASE} places over the {name} bbox (takes a few minutes)…")
    df = con.execute(
        f"""
        SELECT
          id,
          names.primary                                  AS name,
          COALESCE(brand.names.primary, '')              AS brand,
          categories.primary                             AS cat,
          COALESCE(list_transform(categories.alternate, x -> x), []) AS alt_cats,
          confidence,
          ST_X(geometry)                                 AS lon,
          ST_Y(geometry)                                 AS lat
        FROM read_parquet('{S3_PATH}', hive_partitioning=1)
        WHERE bbox.xmin BETWEEN {box['xmin']} AND {box['xmax']}
          AND bbox.ymin BETWEEN {box['ymin']} AND {box['ymax']}
          AND names.primary IS NOT NULL
        """
    ).df()
    con.close()
    return df


def classify(df: pd.DataFrame) -> pd.DataFrame:
    cat = df["cat"].fillna("")
    alt = df["alt_cats"].apply(lambda xs: set(xs) if xs is not None and len(xs) else set())
    name_brand = (df["name"].fillna("") + " " + df["brand"].fillna("")).str.strip()

    cat_in = lambda cats: cat.isin(cats) | alt.apply(lambda s: bool(s & cats))
    is_foodish = (
        cat.apply(lambda c: any(h in c for h in FOOD_CAT_HINTS)) | cat_in(FOOD_CATS)
    )

    is_chicken = cat_in(CHICKEN_CATS) | (
        is_foodish & name_brand.str.contains(CHICKEN_NAME, regex=True)
    )
    is_coffee = ~is_chicken & cat_in(COFFEE_CATS)

    df = df.assign(kind=None)
    df.loc[is_chicken, "kind"] = "chicken"
    df.loc[is_coffee, "kind"] = "coffee"
    return df[df["kind"].notna()].copy()


def clip_and_dedupe(df: pd.DataFrame, slug: str) -> pd.DataFrame:
    boundary = shape(json.loads(boundary_path(slug).read_text()))
    pts = shapely.points(df["lon"].to_numpy(), df["lat"].to_numpy())
    df = df[shapely.contains(boundary, pts)].copy()

    # dedupe: same normalized name within ~25 m (h3 res-11 cell), keep max confidence
    import h3

    norm = (
        df["name"].fillna("").str.lower().str.replace(r"[^a-z0-9]+", "", regex=True)
    )
    cell = [h3.latlng_to_cell(la, lo, 11) for la, lo in zip(df["lat"], df["lon"])]
    df = df.assign(_norm=norm, _cell=cell)
    # stable sort + id tiebreak: quicksort would keep a different one of two
    # equal-confidence duplicates on each run, moving a handful of POIs between
    # hexes and making the build unreproducible
    df = (
        df.sort_values(["confidence", "id"], ascending=[False, True], kind="stable")
        .drop_duplicates(subset=["_norm", "_cell"], keep="first")
        .drop(columns=["_norm", "_cell"])
    )
    return df


def main() -> None:
    slug, cfg = parse_city()
    raw_cache = raw_pois_path(slug)
    # London's cache predates the per-city naming and is the one committed to
    # the repo; the others are local-only and CI re-queries S3 for them.
    legacy = Path("data/raw/overture_pois.parquet")
    if slug == "london" and not raw_cache.exists() and legacy.exists():
        raw_cache = legacy

    if raw_cache.exists() and "--refresh" not in sys.argv:
        print(f"using cached raw extract: {raw_cache}")
        raw = pd.read_parquet(raw_cache)
    else:
        raw = fetch_raw(slug, cfg["name"])
        raw_cache = raw_pois_path(slug)
        raw_cache.parent.mkdir(parents=True, exist_ok=True)
        raw.to_parquet(raw_cache, index=False)
        print(f"cached {len(raw):,} bbox places to {raw_cache}")

    df = raw[raw["confidence"] >= MIN_CONFIDENCE]
    df = classify(df)
    df = clip_and_dedupe(df, slug)

    counts = df["kind"].value_counts()
    n_coffee, n_chicken = counts.get("coffee", 0), counts.get("chicken", 0)
    print(f"{cfg['name']} — coffee: {n_coffee:,}   chicken: {n_chicken:,}")
    for kind in ("coffee", "chicken"):
        sample = df[df["kind"] == kind]["name"].value_counts().head(8).index.tolist()
        print(f"  top {kind}: {sample}")
    if n_coffee < MIN_COUNT_GATE or n_chicken < MIN_COUNT_GATE:
        raise SystemExit("count below sanity floor — extract looks truncated, aborting")

    out = build_dir(slug) / "pois.parquet"
    df[["id", "kind", "name", "brand", "confidence", "lon", "lat"]].to_parquet(out, index=False)
    print(f"wrote {out} ({len(df):,} POIs)")


if __name__ == "__main__":
    main()
