#!/usr/bin/env python3
"""Build the Coffee–Fried Chicken Index hex grid, price history and correlations.

- H3 res-9 grid seeded from the POIs (only cells within smoothing reach)
- Gaussian k-ring smoothing of POI counts (σ=1 in hex-distance units, k≤2)
- score = (coffee − chicken) / (coffee + chicken) on smoothed counts, in [−1, 1]
- median sale price per hex (sales pooled over grid_disk k=1, n ≥ MIN_SALES)
- per postcode district: annual median series since 2011 and price multiples
- correlations: score vs current price, and score vs district growth over both
  a 15-year and a 10-year window

Outputs <public>/{hexes.json,pois.geojson,districts.json,summary.json}.
"""

import json
import math
import sys
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

import h3
import numpy as np
import pandas as pd
from scipy import stats

sys.path.insert(0, str(Path(__file__).parent))
from cities import build_dir, parse_city, public_dir  # noqa: E402

RES = 9
# A res-9 hex is ~174 m across, which is a tenth of a pixel at national zoom —
# the country-wide view renders as blank map without a coarser tier. Res 6
# (~36 km², roughly a town) is scored from the same POI counts, not by
# averaging res-9 scores, so it is the same metric at a different grain.
COARSE_RES = 6
COARSE_MIN_SHOPS = 3  # a whole town on 2 shops is noise, not a reading
SMOOTH_W = {0: 1.0, 1: math.exp(-0.5), 2: math.exp(-2.0)}  # gaussian σ=1 by grid distance
MIN_MASS = 1.5   # min weighted POI mass for a hex to get a score
MIN_SALES = 8    # min pooled sales for a hex to get a median price
SCATTER_MAX = 2000

# Two growth windows. 2011 is the headline: it spans the whole 2012–2016 boom
# and the gentrification cycle the index proxies, so districts actually spread
# out. 2016 is carried alongside as the control — post-referendum London prices
# were close to flat, which compresses between-district variance.
Y0_LONG, Y0_SHORT = 2011, 2016
RECENT_YEAR_SENTINEL = 9999
MIN_DISTRICT_SALES = 30  # per district-year, else that year is a gap




def build_districts(this_year: int, series_path: Path) -> dict:
    """Annual median series + growth multiples per postcode district."""
    ds = pd.read_parquet(series_path)
    recent = {
        r.outcode: (r.med, r.n)
        for r in ds[ds.year == RECENT_YEAR_SENTINEL].itertuples()
    }
    years = list(range(Y0_LONG, this_year + 1))

    districts = {}
    for outcode, g in ds[ds.year != RECENT_YEAR_SENTINEL].groupby("outcode"):
        med = {int(r.year): int(r.med) for r in g.itertuples() if r.n >= MIN_DISTRICT_SALES}
        rec = recent.get(outcode)
        rec_med = rec[0] if rec and rec[1] >= MIN_DISTRICT_SALES else None

        def multiple(y0):
            base = med.get(y0)
            return round(rec_med / base, 2) if rec_med and base else None

        districts[outcode] = {
            "y0": Y0_LONG,
            "m": [med.get(y) for y in years],
            "mult15": multiple(Y0_LONG),
            "mult10": multiple(Y0_SHORT),
        }

    # dense rank on the long-window multiple, fastest-growing first
    ranked = sorted(
        (oc for oc, d in districts.items() if oc != "_city" and d["mult15"]),
        key=lambda oc: -districts[oc]["mult15"],
    )
    for i, oc in enumerate(ranked, start=1):
        districts[oc]["rank15"] = i
    districts["_meta"] = {"n_ranked": len(ranked), "years": years}
    return districts


def main() -> None:
    slug, cfg = parse_city()
    build, public = build_dir(slug), public_dir(slug)
    out_hex = public / "hexes.json"
    out_pois = public / "pois.geojson"
    this_year = date.today().year
    pois = pd.read_parquet(build / "pois.parquet")

    # Candidate cells come from the POIs, not from filling the boundary. Only a
    # cell within SMOOTH_W's reach of a shop can ever score, and filling the
    # whole UK at res 9 would enumerate ~2.3M cells to score maybe 40k of them.
    # This also means the national build needs no boundary polygon fill at all.
    seeds = {
        h3.latlng_to_cell(lat, lon, RES)
        for lat, lon in zip(pois["lat"], pois["lon"])
    }
    reach = max(SMOOTH_W)
    cells = set()
    for seed in seeds:
        cells.update(h3.grid_disk(seed, reach))
    # sorted, not a raw set: keeps feature order (and therefore the committed
    # output) byte-identical across runs when the inputs have not changed
    cells = sorted(cells)
    print(f"grid: {len(cells):,} res-{RES} cells from {len(seeds):,} occupied cells")
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
    # Average ranks for ties. argsort().argsort() would hand equal scores
    # arbitrary distinct ranks, and since the cell set iterates in a different
    # order every process, the same hex would report a different percentile on
    # each build — scores bunch hard near +1, so that hit thousands of hexes.
    ranks = stats.rankdata(svals, method="average") - 1
    for (cell, r), rank in zip(scored.items(), ranks):
        r["pct"] = int(round(100 * rank / max(len(svals) - 1, 1)))

    # prices + outcode: sales per cell, pooled over immediate neighbours
    districts = build_districts(this_year, build / "district_series.parquet")
    sales = pd.read_parquet(build / "sales.parquet")
    sale_prices: dict[str, list] = {}
    sale_outcodes: dict[str, list] = {}
    for price, outcode, lat, lon in zip(
        sales["price"], sales["outcode"], sales["lat"], sales["lon"]
    ):
        cell = h3.latlng_to_cell(lat, lon, RES)
        sale_prices.setdefault(cell, []).append(price)
        sale_outcodes.setdefault(cell, []).append(outcode)

    for cell, r in scored.items():
        pooled, pooled_oc = [], []
        for n in h3.grid_disk(cell, 1):
            pooled.extend(sale_prices.get(n, ()))
            pooled_oc.extend(sale_outcodes.get(n, ()))
        if len(pooled) >= MIN_SALES:
            r["price"] = int(np.median(pooled))
            r["n"] = len(pooled)
            # A hex is small enough that its sales almost all share one district;
            # the mode is a clean assignment without needing district polygons.
            r["outcode"] = Counter(pooled_oc).most_common(1)[0][0]
            r["apprec"] = districts.get(r["outcode"], {}).get("mult15")
        else:
            r["price"] = None
            r["n"] = len(pooled)
            r["outcode"] = None
            r["apprec"] = None

    # "Value spots" — the Londonist coffee-and-chicken method: places where the
    # coffee-to-chicken mix already looks gentrified but prices have not caught
    # up. Both terms are percentile ranks so a £2M outlier cannot swamp the
    # index, and value = rank(score) - rank(price), i.e. how far a hex's coffee
    # standing runs ahead of what its prices imply. +1 = best-value.
    priced = [(c, r) for c, r in scored.items() if r["price"]]
    if priced:
        s_rank = stats.rankdata([r["score"] for _, r in priced], method="average")
        p_rank = stats.rankdata([r["price"] for _, r in priced], method="average")
        n = len(priced)
        denom = max(n - 1, 1)
        for (cell, r), sr, pr in zip(priced, s_rank, p_rank):
            r["value"] = round(float((sr - pr) / denom), 3)
        vvals = np.array([r["value"] for _, r in priced])
        print(
            "value quantiles:",
            {q: round(float(np.percentile(vvals, q)), 2) for q in (5, 25, 50, 75, 95)},
        )

    # correlation: score vs current price, per hex
    qual = [(r["score"], r["price"]) for r in scored.values() if r["price"]]
    xs = np.array([q[0] for q in qual])
    ys = np.array([q[1] for q in qual])
    pearson = stats.pearsonr(xs, np.log(ys))
    spearman = stats.spearmanr(xs, ys)
    print(
        f"scored hexes: {len(scored):,}  with price: {len(qual):,}  "
        f"pearson(log) r={pearson.statistic:.3f}  spearman ρ={spearman.statistic:.3f}"
    )

    # Scale diagnostic. Nationally the score-vs-price link all but vanishes,
    # because at UK scale the index separates town from countryside rather than
    # rich from poor: a village with two cafes and no chicken shop scores the
    # same +1 as Chelsea. Restricting to dense high streets recovers it, which
    # confirms this is a within-city pattern rather than a national one. The UI
    # states both numbers instead of leading with the flattering one.
    DENSE_MASS = 20.0
    dense = [
        (r["score"], r["price"])
        for r in scored.values()
        if r["price"] and (r["cs"] + r["fs"]) >= DENSE_MASS
    ]
    if len(dense) >= 50:
        d_rho = float(stats.spearmanr(*zip(*dense)).statistic)
        print(f"dense-only (mass>={DENSE_MASS:g}): spearman rho={d_rho:.3f} (n={len(dense):,})")
    else:
        d_rho = None

    # correlation: district mean score vs district growth, both windows.
    # Aggregating score up to the district keeps n honest (~250, not ~8,500).
    dist_scores = defaultdict(list)
    for r in scored.values():
        if r["outcode"]:
            dist_scores[r["outcode"]].append(r["score"])

    def growth_corr(key, y0):
        """Spearman of score vs growth, raw and net of the starting price level.

        The raw number is dominated by mean reversion — cheap districts multiply
        faster from a low base regardless of what is on the high street — so the
        partial correlation, which holds the starting price fixed, is the one
        that actually tests whether the index predicts growth.
        """
        rows = [
            (float(np.mean(v)), districts[oc][key], districts[oc]["m"][y0 - Y0_LONG])
            for oc, v in dist_scores.items()
            if districts.get(oc, {}).get(key) and districts[oc]["m"][y0 - Y0_LONG]
        ]
        if len(rows) < 10:
            return {"rho": None, "p": None, "partial": None, "partial_p": None, "n": len(rows)}
        score, growth, base = (np.array(c) for c in zip(*rows))
        res = stats.spearmanr(score, growth)
        # partial correlation on ranks: residualise both against the base rank
        rs, rg, rb = (stats.rankdata(a) for a in (score, growth, base))
        resid = lambda y: y - np.polyval(np.polyfit(rb, y, 1), rb)
        part = stats.pearsonr(resid(rs), resid(rg))
        return {
            "rho": float(res.statistic),
            "p": float(res.pvalue),
            "partial": float(part.statistic),
            "partial_p": float(part.pvalue),
            "n": len(rows),
        }

    g15 = growth_corr("mult15", Y0_LONG)
    g10 = growth_corr("mult10", Y0_SHORT)
    for label, g in ((Y0_LONG, g15), (Y0_SHORT, g10)):
        print(
            f"district growth {label}→now vs score: ρ={g['rho']:.3f} "
            f"(net of {label} price level: {g['partial']:+.3f}, p={g['partial_p']:.2g}, n={g['n']})"
        )

    apprecs = np.array([r["apprec"] for r in scored.values() if r["apprec"]])
    print(
        "apprec quantiles:",
        {q: round(float(np.percentile(apprecs, q)), 2) for q in (5, 25, 50, 75, 95)},
    )

    # best-value districts: mean hex value, restricted to districts with enough
    # hexes that one cheap outlier cannot carry the whole postcode
    dist_value = defaultdict(list)
    for r in scored.values():
        if r["outcode"] and r.get("value") is not None:
            dist_value[r["outcode"]].append(r["value"])
    top_value = sorted(
        (
            {"outcode": oc, "value": round(float(np.mean(v)), 3), "n": len(v)}
            for oc, v in dist_value.items()
            if len(v) >= 5
        ),
        key=lambda d: -d["value"],
    )[:10]
    print("top value districts:", ", ".join(f"{d['outcode']} {d['value']:+.2f}" for d in top_value))

    # scatter sample (deterministic)
    rng = np.random.default_rng(42)
    idx = rng.choice(len(qual), size=min(SCATTER_MAX, len(qual)), replace=False)
    scatter = [[round(float(xs[i]), 3), int(ys[i])] for i in sorted(idx)]

    # Emit H3 ids + properties, NOT polygon geometry. Each ring is 7 coordinate
    # pairs of pure boilerplate that h3-js can regenerate from the id in the
    # browser, and at national scale that boilerplate is ~80% of the payload.
    # Drop null-valued props rather than emitting `"apprec": null`: MapLibre
    # cannot compare an expression against null, so ['has', ...] is the only
    # workable no-data test in a paint expression.
    out_hex.write_text(
        json.dumps(
            {
                "res": RES,
                "hexes": [
                    {"h3": cell, **{k: v for k, v in r.items() if v is not None}}
                    for cell, r in scored.items()
                ],
            },
            separators=(",", ":"),
        )
    )

    # Coarse tier for the zoomed-out view.
    coarse_counts = {}
    for kind, lat, lon in zip(pois["kind"], pois["lat"], pois["lon"]):
        cell = h3.latlng_to_cell(lat, lon, COARSE_RES)
        rec = coarse_counts.setdefault(cell, {"c": 0, "f": 0})
        rec["c" if kind == "coffee" else "f"] += 1
    coarse = [
        {
            "h3": cell,
            "c": rec["c"],
            "f": rec["f"],
            "score": round((rec["c"] - rec["f"]) / (rec["c"] + rec["f"]), 3),
        }
        for cell, rec in sorted(coarse_counts.items())
        if rec["c"] + rec["f"] >= COARSE_MIN_SHOPS
    ]
    (public / "hexes_coarse.json").write_text(
        json.dumps({"res": COARSE_RES, "hexes": coarse}, separators=(",", ":"))
    )
    print(f"coarse tier: {len(coarse):,} res-{COARSE_RES} cells")

    # emit raw POI points for the density heatmaps
    kmap = {"coffee": "c", "chicken": "f"}
    poi_features = [
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]},
            "properties": {"k": kmap[kind]},
        }
        for kind, lat, lon in zip(pois["kind"], pois["lat"], pois["lon"])
    ]
    out_pois.write_text(
        json.dumps(
            {"type": "FeatureCollection", "features": poi_features}, separators=(",", ":")
        )
    )

    (public / "districts.json").write_text(json.dumps(districts, separators=(",", ":")))

    summary = {
        "city": cfg["name"],
        "slug": slug,
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
        "apprec": {
            "y0": Y0_LONG,
            "y0_short": Y0_SHORT,
            "rho15": round(g15["rho"], 3),
            "p15": float(f"{g15['p']:.2e}"),
            "partial15": round(g15["partial"], 3),
            "partial15_p": float(f"{g15['partial_p']:.2e}"),
            "rho10": round(g10["rho"], 3),
            "partial10": round(g10["partial"], 3),
            "n_districts": g15["n"],
            "city_mult15": districts.get("_city", {}).get("mult15"),
        },
        "top_value": top_value,
        "scale": {
            "rho_dense": None if d_rho is None else round(d_rho, 3),
            "n_dense": len(dense),
            "dense_mass": DENSE_MASS,
        },
        "scatter": scatter,
    }
    (public / "summary.json").write_text(json.dumps(summary, separators=(",", ":")))

    hex_mb = out_hex.stat().st_size / 1e6
    poi_mb = out_pois.stat().st_size / 1e6
    print(
        f"wrote {out_hex} ({hex_mb:.1f} MB), {out_pois} ({poi_mb:.1f} MB), "
        f"{public}/districts.json, {public}/summary.json"
    )
    # National builds are legitimately bigger than a city; the browser fetches
    # this once and gzip roughly quarters it.
    if hex_mb > 12:
        print(f"WARNING: {out_hex.name} larger than expected ({hex_mb:.1f} MB)")


if __name__ == "__main__":
    main()
