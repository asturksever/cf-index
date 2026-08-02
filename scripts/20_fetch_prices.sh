#!/bin/zsh
# Download HM Land Registry Price Paid yearly CSVs + OS Code-Point Open.
# Resumable (curl -C -); files land in data/raw/ and are gitignored.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/raw

PPD_BASE="http://prod.publicdata.landregistry.gov.uk.s3-website-eu-west-1.amazonaws.com"
for year in 2023 2024 2025 2026; do
  f="data/raw/pp-${year}.csv"
  echo "== ${f}"
  curl -fL -C - --retry 3 -o "$f" "${PPD_BASE}/pp-${year}.csv"
done

# OS Code-Point Open: postcode -> OSGB easting/northing
CPO_ZIP="data/raw/codepo_gb.zip"
if [ ! -d data/raw/codepo_gb/Data/CSV ]; then
  echo "== Code-Point Open"
  curl -fL --retry 3 -o "$CPO_ZIP" \
    "https://api.os.uk/downloads/v1/products/CodePointOpen/downloads?area=GB&format=CSV&redirect"
  unzip -oq "$CPO_ZIP" -d data/raw/codepo_gb
fi

ls -lh data/raw/pp-*.csv "$CPO_ZIP" 2>/dev/null || true
echo "done"
