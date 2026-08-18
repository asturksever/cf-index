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

Also on the map: **coffee and fried-chicken density heatmaps** as separate
layers, a **price-growth mode** tinting each hex by how much its postcode
district's median sale price has multiplied since 2011, and a **value-spots
mode**.

### Artisanal index (chains excluded)

A Costa and an independent roaster say different things about a high street, so
the index is also computed with the chains taken out
([#2](https://github.com/asturksever/cf-index/issues/2)). A coffee POI counts as
a chain if it matches a known brand list (Costa, Starbucks, Pret, the
supermarket and forecourt cafés), or shares an Overture brand with 3+ other
sites, or repeats the same name at 8+ sites across London. That last threshold
is deliberately high: several unrelated independents are called "Bridge Cafe",
and a lower cut would brand them all a chain.

That splits 10,886 coffee shops into **2,451 chain / 8,435 independent**. 7,752
hexes have enough independents to score. **124 hexes flip from coffee-leaning to
chicken-leaning** once chains come out, and the largest falls are in Enfield,
Ruislip, Uxbridge and Greenford — outer high streets whose coffee presence is a
Costa rather than a roastery.

### Value spots

A modern rerun of [Londonist's 2015 coffee-and-chicken
method](https://londonist.com/2015/10/decide-where-to-live-in-london-using-the-coffee-and-chicken-method):
find the places where the coffee-to-chicken mix already looks gentrified but
prices have not caught up. Both terms are percentile ranks, so one £2M sale
cannot swamp a hex:

```
value = rank(index score) − rank(median price)      # −1 … +1
```

+1 means a hex's coffee standing runs as far ahead of its price standing as
London allows. Best-value districts in the current build: RM3, TN16, DA14,
E16, DA5, TW14, SE28, RM8. Chelsea scores a perfect +1.00 on the index and
still comes out neutral here, because you are paying for it.

### Why 2011 and not 2016

The historical window is 15 years by design. A 2016 baseline sits almost
entirely inside the post-referendum era, when London prices were close to
flat — districts barely separate, so there is little variance left to
correlate against. Starting in 2011 spans the 2012–2016 boom and a full
gentrification cycle, which is where the between-district spread lives. The
pipeline computes both windows and reports them side by side, so the
comparison itself is the justification rather than an assertion.

## Data

| What | Source | Licence |
|---|---|---|
| Coffee & chicken POIs | [Overture Maps](https://overturemaps.org) Places, release 2026-07-22.0 | CDLA-Permissive 2.0 |
| House prices | [HM Land Registry Price Paid Data](https://www.gov.uk/government/collections/price-paid-data) 2011–now, category A (2023+ for per-hex medians, full span for district history) | OGL v3 |
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
./scripts/20_fetch_prices.sh                  # ~4 GB of Price Paid CSVs (resumable)
.venv/bin/python scripts/25_prices_to_points.py
.venv/bin/python scripts/30_build_index.py    # → public/data/
```

Deploys to GitHub Pages on push to `main`; `data.yml` rebuilds
`public/data/` monthly.
