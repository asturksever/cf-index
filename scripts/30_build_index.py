#!/usr/bin/env python3
"""Build the Coffee–Fried Chicken Index hex grid and price correlation.

- H3 res-9 grid over the Greater London boundary
- Gaussian k-ring smoothing of POI counts (σ=1 in hex-distance units, k≤2)
- score = (coffee − chicken) / (coffee + chicken) on smoothed counts, in [−1, 1]
- median sale price per hex (sales pooled over grid_disk k=1, n ≥ MIN_SALES)
- Pearson (score vs log price) + Spearman across qualifying hexes

Outputs public/data/hexes.geojson (minified) and public/data/summary.json.
"""

import json
import math
from collections import Counter
from datetime import date
from pathlib import Path

import h3
import numpy as np
import pandas as pd
from scipy import stats
from shapely.geometry import shape

RES = 9
SMOOTH_W = {0: 1.0, 1: math.exp(-0.5), 2: math.exp(-2.0)}  # gaussian σ=1 by grid distance
MIN_MASS = 1.5   # min weighted POI mass for a hex to get a score
MIN_SALES = 8    # min pooled sales for a hex to get a median price
SCATTER_MAX = 2000

BOUNDARY = Path("data/raw/london_boundary.geojson")
POIS = Path("data/build/pois.parquet")
SALES = Path("data/build/sales.parquet")
OUT_HEX = Path("public/data/hexes.geojson")
OUT_SUMMARY = Path("public/data/summary.json")


def main() -> None:
    boundary = json.loads(BOUNDARY.read_text())
    cells = set(h3.h3shape_to_cells(h3.geo_to_h3shape(boundary), RES))
    print(f"grid: {len(cells):,} res-{RES} cells")

    pois = pd.read_parquet(POIS)
    counts = {"coffee": Counter(), "chicken": Counter()}
    for kind, lat, lon in zip(pois["kind"], pois["lat"], pois["lon"]):
        counts[kind][h3.latlng_to_cell(lat, lon, RES)] += 1
    n_coffee = int(pois["kind"].eq("coffee").sum())
    n_chicken = int(pois["kind"].eq("chicken").sum())

    # smoothed counts + score
    rows = {}
    for cell in cells:
        cs = fs = 0.0
        for d, w in SMOOTH_W.items():
            for n in h3.grid_ring(cell, d):
                cs += w * counts["coffee"].get(n, 0)
                fs += w * counts["chicken"].get(n, 0)
        mass = cs + fs
        score = (cs - fs) / mass if mass >= MIN_MASS else None
        rows[cell] = {
            "c": counts["coffee"].get(cell, 0),
            "f": counts["chicken"].get(cell, 0),
            "cs": round(cs, 1),
            "fs": round(fs, 1),
            "score": None if score is None else round(score, 3),
        }

    scored = {c: r for c, r in rows.items() if r["score"] is not None}
    svals = np.array([r["score"] for r in scored.values()])
    order = svals.argsort().argsort()  # rank
    for (cell, r), rank in zip(scored.items(), order):
        r["pct"] = int(round(100 * rank / max(len(svals) - 1, 1)))

    # prices: sales per cell, pooled over immediate neighbors
    sales = pd.read_parquet(SALES)
    sale_prices = Counter()
    sale_lists: dict[str, list] = {}
    for price, lat, lon in zip(sales["price"], sales["lat"], sales["lon"]):
        cell = h3.latlng_to_cell(lat, lon, RES)
        sale_lists.setdefault(cell, []).append(price)
    for cell, r in scored.items():
        pooled = []
        for n in h3.grid_disk(cell, 1):
            pooled.extend(sale_lists.get(n, ()))
        if len(pooled) >= MIN_SALES:
            r["price"] = int(np.median(pooled))
            r["n"] = len(pooled)
        else:
            r["price"] = None
            r["n"] = len(pooled)

    # correlation
    qual = [(r["score"], r["price"]) for r in scored.values() if r["price"]]
    xs = np.array([q[0] for q in qual])
    ys = np.array([q[1] for q in qual])
    pearson = stats.pearsonr(xs, np.log(ys))
    spearman = stats.spearmanr(xs, ys)
    print(
        f"scored hexes: {len(scored):,}  with price: {len(qual):,}  "
        f"pearson(log) r={pearson.statistic:.3f}  spearman ρ={spearman.statistic:.3f}"
    )

    # scatter sample (deterministic)
    rng = np.random.default_rng(42)
    idx = rng.choice(len(qual), size=min(SCATTER_MAX, len(qual)), replace=False)
    scatter = [[round(float(xs[i]), 3), int(ys[i])] for i in sorted(idx)]

    # emit geojson
    features = []
    for cell, r in scored.items():
        ring = [[round(lng, 5), round(lat, 5)] for lat, lng in h3.cell_to_boundary(cell)]
        ring.append(ring[0])
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [ring]},
                "properties": {"h3": cell, **r},
            }
        )
    OUT_HEX.parent.mkdir(parents=True, exist_ok=True)
    OUT_HEX.write_text(
        json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":"))
    )

    summary = {
        "generated": date.today().isoformat(),
        "release": "Overture 2026-07-22.0",
        "res": RES,
        "n_hexes": len(scored),
        "n_coffee": n_coffee,
        "n_chicken": n_chicken,
        "n_sales": int(len(sales)),
        "corr_n": len(qual),
        "pearson_log_r": round(float(pearson.statistic), 3),
        "pearson_p": float(f"{pearson.pvalue:.2e}"),
        "spearman_rho": round(float(spearman.statistic), 3),
        "spearman_p": float(f"{spearman.pvalue:.2e}"),
        "score_quantiles": {
            str(q): round(float(np.percentile(svals, q)), 3) for q in (5, 25, 50, 75, 95)
        },
        "scatter": scatter,
    }
    OUT_SUMMARY.write_text(json.dumps(summary, separators=(",", ":")))
    size_mb = OUT_HEX.stat().st_size / 1e6
    print(f"wrote {OUT_HEX} ({size_mb:.1f} MB) and {OUT_SUMMARY}")
    if size_mb > 8:
        print("WARNING: hexes.geojson larger than expected")


if __name__ == "__main__":
    main()
