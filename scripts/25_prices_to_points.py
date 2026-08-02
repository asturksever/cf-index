#!/usr/bin/env python3
"""Turn Land Registry Price Paid CSVs into the two tables the index needs.

1. data/build/sales.parquet — recent (2023+) Greater London sales geocoded to
   lat/lon via OS Code-Point Open, for the per-hex median price.
2. data/build/district_series.parquet — every year since 2011 aggregated to
   postcode district (outcode) medians, for the historical comparison. No
   geocoding needed here: the outcode is the first half of the postcode.
"""

from pathlib import Path

import duckdb
import numpy as np
from pyproj import Transformer

PPD_GLOB = "data/raw/pp-*.csv"
CPO_GLOB = "data/raw/codepo_gb/Data/CSV/*.csv"
OUT_SALES = Path("data/build/sales.parquet")
OUT_SERIES = Path("data/build/district_series.parquet")

# Hex medians describe the London of the POI snapshot, so they stay recent.
# The district series deliberately reaches back much further.
RECENT_FROM = "2023-01-01"
SERIES_FROM = 2011
RECENT_YEAR_SENTINEL = 9999  # rows holding the trailing-12-month aggregate

PPD_COLUMNS = [
    "id", "price", "date", "postcode", "property_type", "old_new", "duration",
    "paon", "saon", "street", "locality", "town", "district", "county",
    "ppd_category", "record_status",
]


def main() -> None:
    con = duckdb.connect()
    ppd_cols = ", ".join(f"'{c}': 'VARCHAR'" for c in PPD_COLUMNS)

    con.execute(
        f"""
        CREATE TABLE sales_all AS
        SELECT
          CAST(price AS BIGINT)                            AS price,
          substr(date, 1, 10)                              AS date,
          CAST(substr(date, 1, 4) AS INT)                  AS year,
          upper(regexp_replace(postcode, '\\s+', '', 'g'))  AS pc_key,
          upper(split_part(trim(postcode), ' ', 1))        AS outcode
        -- auto_detect=false: with 16 years in the glob the sniffer infers
        -- BIGINT/TIMESTAMP from some files and then rejects our all-VARCHAR
        -- schema. Reading everything as text and casting explicitly is the
        -- only way to stay immune to per-year formatting drift.
        FROM read_csv('{PPD_GLOB}', header=false, columns={{{ppd_cols}}}, auto_detect=false)
        WHERE county = 'GREATER LONDON'
          AND ppd_category = 'A'
          AND postcode IS NOT NULL AND postcode <> ''
        """
    )
    n_all, n_oc = con.execute(
        "SELECT count(*), count(DISTINCT outcode) FROM sales_all"
    ).fetchone()
    yr_lo, yr_hi = con.execute("SELECT min(year), max(year) FROM sales_all").fetchone()
    print(f"London category-A sales {yr_lo}–{yr_hi}: {n_all:,} across {n_oc} outcodes")
    if not 200 <= n_oc <= 400:
        raise SystemExit(f"{n_oc} outcodes is outside the plausible London range")

    # --- 1. recent geocoded sales ---
    con.execute(
        f"""
        CREATE TABLE cpo AS
        SELECT
          upper(regexp_replace(column0, '\\s+', '', 'g')) AS pc_key,
          CAST(column2 AS DOUBLE) AS easting,
          CAST(column3 AS DOUBLE) AS northing
        FROM read_csv('{CPO_GLOB}', header=false, all_varchar=true)
        """
    )
    n_recent = con.execute(
        f"SELECT count(*) FROM sales_all WHERE date >= '{RECENT_FROM}'"
    ).fetchone()[0]
    df = con.execute(
        f"""
        SELECT s.price, s.date, s.outcode, c.easting, c.northing
        FROM sales_all s JOIN cpo c USING (pc_key)
        WHERE s.date >= '{RECENT_FROM}'
        """
    ).df()

    unmatched = n_recent - len(df)
    pct = 100 * unmatched / n_recent if n_recent else 0
    print(f"recent ({RECENT_FROM}+): {n_recent:,}; geocoded: {len(df):,}; unmatched: {unmatched:,} ({pct:.2f}%)")
    if pct > 5:
        raise SystemExit("unmatched postcode rate implausibly high — check Code-Point join")

    tr = Transformer.from_crs(27700, 4326, always_xy=True)
    lon, lat = tr.transform(df["easting"].to_numpy(), df["northing"].to_numpy())
    df["lon"] = np.round(lon, 6)
    df["lat"] = np.round(lat, 6)

    med = df["price"].median()
    print(f"median recent sale price: £{med:,.0f}")
    if not 300_000 < med < 900_000:
        raise SystemExit("median London price outside plausible band — check filters")

    OUT_SALES.parent.mkdir(parents=True, exist_ok=True)
    df[["price", "date", "outcode", "lon", "lat"]].to_parquet(OUT_SALES, index=False)
    print(f"wrote {OUT_SALES}")

    # --- 2. district-year series (+ trailing-12m and London-wide rows) ---
    series = con.execute(
        f"""
        WITH yearly AS (
          SELECT outcode, year, CAST(median(price) AS BIGINT) AS med, count(*) AS n
          FROM sales_all WHERE year >= {SERIES_FROM} GROUP BY 1, 2
        ),
        london_yearly AS (
          SELECT '_london' AS outcode, year, CAST(median(price) AS BIGINT) AS med, count(*) AS n
          FROM sales_all WHERE year >= {SERIES_FROM} GROUP BY 2
        ),
        recent AS (
          SELECT outcode, {RECENT_YEAR_SENTINEL} AS year,
                 CAST(median(price) AS BIGINT) AS med, count(*) AS n
          FROM sales_all
          WHERE date >= strftime(current_date - INTERVAL 365 DAY, '%Y-%m-%d')
          GROUP BY 1
        ),
        london_recent AS (
          SELECT '_london' AS outcode, {RECENT_YEAR_SENTINEL} AS year,
                 CAST(median(price) AS BIGINT) AS med, count(*) AS n
          FROM sales_all
          WHERE date >= strftime(current_date - INTERVAL 365 DAY, '%Y-%m-%d')
        )
        SELECT * FROM yearly
        UNION ALL SELECT * FROM london_yearly
        UNION ALL SELECT * FROM recent
        UNION ALL SELECT * FROM london_recent
        """
    ).df()
    con.close()

    series.to_parquet(OUT_SERIES, index=False)
    n_recent_rows = int((series["year"] == RECENT_YEAR_SENTINEL).sum())
    print(f"wrote {OUT_SERIES} ({len(series):,} rows, {n_recent_rows} trailing-12m aggregates)")


if __name__ == "__main__":
    main()
