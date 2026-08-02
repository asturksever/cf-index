# ☕ The Coffee–Fried Chicken Index 🍗

An interactive map of Greater London scoring every ~0.1 km² hex from **−1 (all
fried chicken)** to **+1 (all coffee)**, correlated with house prices. Type a
postcode, get your neighbourhood's verdict.

**Index:** `score = (coffee − chicken) / (coffee + chicken)` on
Gaussian-smoothed POI counts over an H3 res-9 grid (k-ring ≤ 2, σ = 1).
Inspired by Glaeser, Kim & Luca (2018), *[Nowcasting Gentrification: Using
Yelp Data to Quantify Neighborhood
Change](https://www.aeaweb.org/articles?id=10.1257%2Fpandp.20181034)* (cafés
lead house-price rises) and Maguire, Burgoine & Monsivais (2015), *[Area
deprivation and the food environment over
time](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4415115/)* (takeaway
density tracks deprivation).

Current build: **Spearman ρ ≈ 0.38** between hex score and median sale price
(~8.3k hexes). Correlation, not causation.

## Data

| What | Source | Licence |
|---|---|---|
| Coffee & chicken POIs | [Overture Maps](https://overturemaps.org) Places, release 2026-07-22.0 | CDLA-Permissive 2.0 |
| House prices | [HM Land Registry Price Paid Data](https://www.gov.uk/government/collections/price-paid-data) 2023–now (category A) | OGL v3 |
| Postcode → coords | OS Code-Point Open | OGL v3 |
| Postcode lookup (UI) | [postcodes.io](https://postcodes.io) | — |
| Boundary | OSM relation 175342 | ODbL |

Classification: Overture categories `cafe`/`coffee_shop`/`coffee_roastery` vs
`chicken_restaurant`/`chicken_wings_restaurant`, plus a name regex for the
chains (Morley's, Chicken Cottage, Sam's, Dixy, KFC…) over fast-food places.
Confidence ≥ 0.5, deduped by name within ~25 m.

## Run it

```sh
npm install && npm run dev          # frontend on :5176

python3 -m venv .venv && .venv/bin/pip install .
.venv/bin/python scripts/15_fetch_boundary.py
.venv/bin/python scripts/10_fetch_pois.py     # cached extract committed
./scripts/20_fetch_prices.sh                  # ~500 MB of Price Paid CSVs
.venv/bin/python scripts/25_prices_to_points.py
.venv/bin/python scripts/30_build_index.py    # → public/data/
```

Deploys to GitHub Pages on push to `main`; `data.yml` rebuilds
`public/data/` monthly.
