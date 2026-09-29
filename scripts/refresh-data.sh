#!/usr/bin/env bash
# Airlock — data snapshot refresh
# Re-pulls public market/token data and rebuilds data/*.json.
#
# WHY THIS EXISTS: neither api.spectrum.fi nor api.ergoplatform.com sends
# Access-Control-Allow-Origin headers, so browsers cannot call them directly
# (fetch fails with a CORS error). We therefore fetch at build time with curl
# and bake the results into data/*.json. The site JS tries a live fetch first
# and falls back to these snapshots, showing a visible "Data as of" label.
#
# Usage: ./scripts/refresh-data.sh
set -euo pipefail
cd "$(dirname "$0")/.."

TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "[airlock] fetching Spectrum price-tracking markets..."
curl -sS --max-time 60 "https://api.spectrum.fi/v1/price-tracking/markets" \
  -o data/markets.raw.json
echo "[airlock] fetching Ergo explorer chain info..."
curl -sS --max-time 30 "https://api.ergoplatform.com/api/v1/info" \
  -o data/explorer-info.raw.json
echo "[airlock] building snapshots (dedupe, reserve estimates, token ranking)..."
FETCHED_AT="$TS" python3 scripts/build-snapshots.py
echo "[airlock] done. Snapshots in data/ are timestamped $TS"
