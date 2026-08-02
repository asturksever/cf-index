#!/usr/bin/env python3
"""Geocode Greater London Price Paid sales to lat/lon points.

Reads data/raw/pp-*.csv (headerless Land Registry format), filters to
Greater London standard sales (ppd_category = 'A'), joins OS Code-Point Open
for OSGB coordinates, transforms to WGS84, writes data/build/sales.parquet.
"""

from pathlib import Path

import duckdb
import numpy as np
from pyproj import Transformer

PPD_GLOB = "data/raw/pp-*.csv"
CPO_GLOB = "data/raw/codepo_gb/Data/CSV/*.csv"
OUT = Path("data/build/sales.parquet")

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
        CREATE TABLE sales AS
        SELECT
          CAST(price AS BIGINT)                          AS price,
          substr(date, 1, 10)                            AS date,
          upper(regexp_replace(postcode, '\\s+', '', 'g')) AS pc_key
        FROM read_csv('{PPD_GLOB}', header=false, columns={{{ppd_cols}}})
        WHERE county = 'GREATER LONDON'
          AND ppd_category = 'A'
          AND postcode IS NOT NULL AND postcode <> ''
        """
    )
    n_sales = con.execute("SELECT count(*) FROM sales").fetchone()[0]

    # Code-Point Open: col1 postcode, col3 easting, col4 northing (headerless)
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

    df = con.execute(
        """
        SELECT s.price, s.date, c.easting, c.northing
        FROM sales s JOIN cpo c USING (pc_key)
        """
    ).df()
    con.close()

    unmatched = n_sales - len(df)
    pct = 100 * unmatched / n_sales if n_sales else 0
    print(f"London category-A sales: {n_sales:,}; geocoded: {len(df):,}; unmatched: {unmatched:,} ({pct:.2f}%)")
    if pct > 5:
        raise SystemExit("unmatched postcode rate implausibly high — check Code-Point join")

    tr = Transformer.from_crs(27700, 4326, always_xy=True)
    lon, lat = tr.transform(df["easting"].to_numpy(), df["northing"].to_numpy())
    df["lon"] = np.round(lon, 6)
    df["lat"] = np.round(lat, 6)

    med = df["price"].median()
    print(f"median sale price: £{med:,.0f}")
    if not 300_000 < med < 900_000:
        raise SystemExit("median London price outside plausible band — check filters")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    df[["price", "date", "lon", "lat"]].to_parquet(OUT, index=False)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
