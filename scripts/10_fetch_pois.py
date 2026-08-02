#!/usr/bin/env python3
"""Extract coffee shops and fried-chicken shops in Greater London from Overture Places.

Reads the pinned Overture release straight from S3 with DuckDB (bbox pushdown),
classifies locally, clips to the Greater London boundary, dedupes, and writes
data/build/pois.parquet. The raw London extract is cached (and committed) at
data/raw/overture_pois.parquet so CI can rebuild without hitting S3; pass
--refresh to re-download.
"""

import re
import sys
from pathlib import Path

import duckdb
import json
import pandas as pd
import shapely
from shapely.geometry import shape

RELEASE = "2026-07-22.0"
S3_PATH = f"s3://overturemaps-us-west-2/release/{RELEASE}/theme=places/type=place/*.parquet"

RAW_CACHE = Path("data/raw/overture_pois.parquet")
OUT = Path("data/build/pois.parquet")
BOUNDARY = Path("data/raw/london_boundary.geojson")

# Greater London bbox with a small margin (clipped precisely later)
BBOX = {"xmin": -0.53, "ymin": 51.26, "xmax": 0.36, "ymax": 51.72}

COFFEE_CATS = {"cafe", "coffee_shop", "coffee_roastery"}
CHICKEN_CATS = {"chicken_restaurant", "chicken_wings_restaurant"}
# name regex only applies to food-selling places (see FOOD_CATS below)
CHICKEN_NAME = re.compile(
    r"morley'?s|chicken\s*cottage|sam'?s\s*chicken|dixy|favou?rite\s*chicken"
    r"|chicken\s*valley|\bkfc\b|kentucky\s*fried|\bpfc\b|perfect\s*fried"
    r"|tennessee\s*fried|fried\s*chicken"
    r"|chicken\s*(shop|spot|hut|land|world|express|king|base|corner)",
    re.IGNORECASE,
)
FOOD_CAT_HINTS = ("restaurant", "fast_food")  # substring match on the category leaf
FOOD_CATS = COFFEE_CATS | CHICKEN_CATS | {"cafeteria", "food_truck", "food_stand"}

MIN_CONFIDENCE = 0.5
MIN_COUNT_GATE = 300  # abort if a class comes back suspiciously small


def fetch_raw() -> pd.DataFrame:
    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';")
    con.execute("INSTALL spatial; LOAD spatial;")
    print(f"querying Overture {RELEASE} places over London bbox (first run takes a few minutes)…")
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
        WHERE bbox.xmin BETWEEN {BBOX['xmin']} AND {BBOX['xmax']}
          AND bbox.ymin BETWEEN {BBOX['ymin']} AND {BBOX['ymax']}
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


def clip_and_dedupe(df: pd.DataFrame) -> pd.DataFrame:
    boundary = shape(json.loads(BOUNDARY.read_text()))
    pts = shapely.points(df["lon"].to_numpy(), df["lat"].to_numpy())
    df = df[shapely.contains(boundary, pts)].copy()

    # dedupe: same normalized name within ~25 m (h3 res-11 cell), keep max confidence
    import h3

    norm = (
        df["name"].fillna("").str.lower().str.replace(r"[^a-z0-9]+", "", regex=True)
    )
    cell = [h3.latlng_to_cell(la, lo, 11) for la, lo in zip(df["lat"], df["lon"])]
    df = df.assign(_norm=norm, _cell=cell)
    df = (
        df.sort_values("confidence", ascending=False)
        .drop_duplicates(subset=["_norm", "_cell"], keep="first")
        .drop(columns=["_norm", "_cell"])
    )
    return df


def main() -> None:
    if RAW_CACHE.exists() and "--refresh" not in sys.argv:
        print(f"using cached raw extract: {RAW_CACHE}")
        raw = pd.read_parquet(RAW_CACHE)
    else:
        raw = fetch_raw()
        RAW_CACHE.parent.mkdir(parents=True, exist_ok=True)
        raw.to_parquet(RAW_CACHE, index=False)
        print(f"cached {len(raw):,} bbox places to {RAW_CACHE}")

    df = raw[raw["confidence"] >= MIN_CONFIDENCE]
    df = classify(df)
    df = clip_and_dedupe(df)

    counts = df["kind"].value_counts()
    n_coffee, n_chicken = counts.get("coffee", 0), counts.get("chicken", 0)
    print(f"coffee: {n_coffee:,}   chicken: {n_chicken:,}")
    for kind in ("coffee", "chicken"):
        sample = df[df["kind"] == kind]["name"].head(8).tolist()
        print(f"  sample {kind}: {sample}")
    if n_coffee < MIN_COUNT_GATE or n_chicken < MIN_COUNT_GATE:
        raise SystemExit("count below sanity floor — extract looks truncated, aborting")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    df[["id", "kind", "name", "brand", "confidence", "lon", "lat"]].to_parquet(OUT, index=False)
    print(f"wrote {OUT} ({len(df):,} POIs)")


if __name__ == "__main__":
    main()
