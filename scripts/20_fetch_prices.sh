#!/bin/zsh
# Download HM Land Registry Price Paid yearly CSVs + OS Code-Point Open.
# Resumable (curl -C -); files land in data/raw/ and are gitignored.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/raw

# 2011+ feeds the historical district series; 2023+ feeds the per-hex medians.
# Past-year files are immutable — CI caches them (~4 GB total, limit is 10 GB).
PPD_BASE="http://prod.publicdata.landregistry.gov.uk.s3-website-eu-west-1.amazonaws.com"
failed=()
for year in {2011..2026}; do
  f="data/raw/pp-${year}.csv"
  echo "== ${f}"
  # One flaky year must not abandon the other fifteen; collect and report at the
  # end so a rerun (curl -C - resumes) only has to pick up the stragglers.
  curl -fL -C - --retry 3 --retry-delay 5 -o "$f" "${PPD_BASE}/pp-${year}.csv" || failed+=("$year")
done
if (( ${#failed[@]} )); then
  echo "FAILED years: ${failed[*]} — rerun this script to resume" >&2
  exit 1
fi

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
