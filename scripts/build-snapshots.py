#!/usr/bin/env python3
"""Airlock snapshot builder.

Reads data/markets.raw.json (Spectrum price-tracking feed) and produces:
  data/markets.json — deduped pairs + reserve ESTIMATES (see method below)
  data/tokens.json  — top tokens by volume, enriched via Ergo explorer

RESERVE ESTIMATION METHOD (honest heuristic — documented, not hidden):
  Spectrum's public price-tracking API publishes lastPrice and per-side volumes
  per market, but NOT pool reserves. To power the v1 quote engine we estimate
  reserves as follows, for each unique ERG-paired market:

    1. Spot price p = lastPrice, in HUMAN units of quote per human unit of base
       (verified 2026-09-28: ERG/SigUSD lastPrice 0.305 ≈ SigUSD-per-ERG while
       ERG traded ~$0.32, i.e. price is quote-per-base in display units).
    2. Quote-denominated reported volume V = max(baseVol_human * p,
       quoteVol_human). (API does not document the volume window; we treat it
       as "reported volume" and label it as such in the UI.)
    3. Assumed pool depth D = VOL_DEPTH_MULT * V, with VOL_DEPTH_MULT = 10.
       This multiplier is a GUESS: real constant-product pools are typically a
       small multiple of daily volume deep, but we cannot observe reserves, so
       quotes are indicative and price-impact figures scale with this guess.
    4. Reserves: R_quote_human = D / 2, R_base_human = R_quote_human / p.
       Stored as raw integer units (x * 10**decimals).

  Every reserve value in markets.json carries "estimated": true and the method
  name, so the UI can label depth-sensitive figures accordingly. Non-ERG pairs
  get price + volume only (no reserve estimate) and the swapper routes those
  through ERG as two legs, labeled as such.

Dedup: markets are grouped by unordered {baseId, quoteId}; the entry with the
highest reported volume wins (the feed lists several stale pool versions per
pair, e.g. three ERG/SigUSD markets).
"""
import json
import os
import sys
import time
import urllib.request

RAW = "data/markets.raw.json"
OUT_MARKETS = "data/markets.json"
OUT_TOKENS = "data/tokens.json"
EXPLORER = "https://api.ergoplatform.com/api/v1"
ERG_ID = "0" * 64
VOL_DEPTH_MULT = 10.0


def human(raw_value, decimals):
    return raw_value / (10 ** decimals)


def explorer_token(token_id, retries=3):
    """Fetch EIP-4 token metadata from the Ergo explorer. Returns dict or None."""
    url = f"{EXPLORER}/tokens/{token_id}"
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=20) as r:
                return json.load(r)
        except Exception:
            time.sleep(1 + attempt)
    return None


def main():
    fetched_at = os.environ.get("FETCHED_AT") or time.strftime(
        "%Y-%m-%dT%H:%M:%SZ", time.gmtime()
    )
    with open(RAW) as f:
        raw_markets = json.load(f)

    # --- dedupe by unordered token pair, keep highest-volume market ---
    best = {}
    for m in raw_markets:
        try:
            b, q = m["baseId"], m["quoteId"]
            ba, qa = m["baseVolume"]["units"]["asset"], m["quoteVolume"]["units"]["asset"]
            bv = human(m["baseVolume"]["value"], ba["decimals"])
            qv = human(m["quoteVolume"]["value"], qa["decimals"])
            key = tuple(sorted((b, q)))
            score = bv + qv
            if key not in best or score > best[key][0]:
                best[key] = (score, m, bv, qv)
        except (KeyError, TypeError, ZeroDivisionError):
            continue

    pairs = []
    for (score, m, bv, qv) in best.values():
        b, q = m["baseId"], m["quoteId"]
        ba, qa = m["baseVolume"]["units"]["asset"], m["quoteVolume"]["units"]["asset"]
        price = m.get("lastPrice")

        pair = {
            "id": m["id"],
            "base": {"tokenId": b, "ticker": ba["ticker"], "decimals": ba["decimals"]},
            "quote": {"tokenId": q, "ticker": qa["ticker"], "decimals": qa["decimals"]},
            "lastPrice": price,  # human quote-units per human base-unit
            "volume": {
                "base": bv,
                "quote": qv,
                "window": "undocumented (as reported by api.spectrum.fi)",
            },
        }

        # reserve estimate for ERG pairs only
        if (b == ERG_ID or q == ERG_ID) and price and price > 0:
            # orient: base=B, quote=Q as listed; price p = Q per B (human)
            if b == ERG_ID:
                # market is ERG(base)/X(quote): p = X per ERG
                p_erg_per_x = price  # X per ERG
                # depth in X terms from reported volume
                v_x = max(bv * p_erg_per_x, qv)
                d_x = VOL_DEPTH_MULT * v_x
                r_x = d_x / 2.0
                r_erg = r_x / p_erg_per_x if p_erg_per_x else 0
                reserves = {
                    "erg": {"human": r_erg, "raw": int(r_erg * 10 ** 9)},
                    "token": {
                        "tokenId": q,
                        "human": r_x,
                        "raw": int(r_x * 10 ** qa["decimals"]),
                    },
                }
            else:
                # market is X(base)/ERG(quote): p = ERG per X
                p_x_per_erg = price  # ERG per X
                v_erg = max(bv * p_x_per_erg, qv)
                d_erg = VOL_DEPTH_MULT * v_erg
                r_erg = d_erg / 2.0
                r_x = r_erg / p_x_per_erg if p_x_per_erg else 0
                reserves = {
                    "erg": {"human": r_erg, "raw": int(r_erg * 10 ** 9)},
                    "token": {
                        "tokenId": b,
                        "human": r_x,
                        "raw": int(r_x * 10 ** ba["decimals"]),
                    },
                }
            pair["reserves"] = reserves
            pair["reserves"]["estimated"] = True
            pair["reserves"]["method"] = (
                f"heuristic: depth ~= {VOL_DEPTH_MULT:g}x reported volume; "
                "reserves split 50/50 by value at spot price. Real pool "
                "reserves are NOT published by the API."
            )

        pairs.append(pair)

    # --- compute token ERG-volume cleanly from pairs ---
    token_agg = {}
    for pair in pairs:
        b, q = pair["base"], pair["quote"]
        price = pair["lastPrice"]
        bv, qv = pair["volume"]["base"], pair["volume"]["quote"]
        for asset, vol in ((b, bv), (q, qv)):
            agg = token_agg.setdefault(
                asset["tokenId"],
                {"ticker": asset["ticker"], "decimals": asset["decimals"],
                 "volErg": 0.0, "markets": 0, "priceVsErg": None},
            )
            agg["markets"] += 1
            if asset["tokenId"] == ERG_ID:
                agg["volErg"] += vol
            elif price and price > 0:
                other = q if asset["tokenId"] == b["tokenId"] else b
                if other["tokenId"] == ERG_ID:
                    if asset["tokenId"] == b["tokenId"]:
                        # price = ERG per unit of base
                        agg["volErg"] += vol * price
                        agg["priceVsErg"] = price
                    else:
                        # price = units of quote per ERG
                        agg["volErg"] += vol / price
                        agg["priceVsErg"] = 1.0 / price

    ranked = sorted(token_agg.items(), key=lambda kv: kv[1]["volErg"], reverse=True)

    # --- enrich top tokens via explorer (name, description, emission) ---
    tokens = []
    TOP_N = 40
    for tid, agg in ranked[:TOP_N]:
        meta = explorer_token(tid) if tid != ERG_ID else None
        tokens.append({
            "tokenId": tid,
            "ticker": agg["ticker"],
            "name": (meta or {}).get("name") or agg["ticker"],
            "description": (meta or {}).get("description") or "",
            "decimals": agg["decimals"],
            "emissionAmount": (meta or {}).get("emissionAmount"),
            "priceVsErg": agg["priceVsErg"],
            "volumeErg": agg["volErg"],
            "markets": agg["markets"],
            "explorerUrl": f"https://explorer.ergoplatform.com/en/token/{tid}"
            if tid != ERG_ID else "https://explorer.ergoplatform.com/",
        })
    # always include ERG itself first
    erg_agg = token_agg.get(ERG_ID, {"ticker": "ERG", "decimals": 9,
                                     "volErg": 0, "markets": 0})
    erg_entry = {
        "tokenId": ERG_ID, "ticker": "ERG", "name": "Ergo",
        "description": "Native currency of the Ergo blockchain (EIP-4 asset id of 64 zeros).",
        "decimals": 9, "emissionAmount": None, "priceVsErg": 1.0,
        "volumeErg": erg_agg["volErg"], "markets": erg_agg["markets"],
        "explorerUrl": "https://explorer.ergoplatform.com/",
    }
    tokens = [erg_entry] + [t for t in tokens if t["tokenId"] != ERG_ID]

    with open(OUT_MARKETS, "w") as f:
        json.dump({
            "fetched_at": fetched_at,
            "source": "https://api.spectrum.fi/v1/price-tracking/markets",
            "pairs": pairs,
            "reserveMethod": (
                "Reserves are ESTIMATES: depth ~= 10x reported volume, split "
                "50/50 by value at the reported spot price. The Spectrum API "
                "does not publish reserves."
            ),
        }, f)
    with open(OUT_TOKENS, "w") as f:
        json.dump({
            "fetched_at": fetched_at,
            "sources": [
                "https://api.spectrum.fi/v1/price-tracking/markets",
                "https://api.ergoplatform.com/api/v1/tokens/<id>",
            ],
            "tokens": tokens,
        }, f)

    print(f"[build] {len(pairs)} unique pairs, {len(tokens)} tokens -> "
          f"{OUT_MARKETS}, {OUT_TOKENS} @ {fetched_at}")


if __name__ == "__main__":
    sys.exit(main())
