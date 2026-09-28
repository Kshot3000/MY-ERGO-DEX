# AstroErg — Ergo-native DEX quote terminal

A SundaeSwap-style swap interface for Ergo (EIP-4) tokens with a deep-space
mission-control theme. **v1 is a quote terminal: it computes indicative swap
quotes from public market data and does not settle anything on-chain.**

Live: `https://kshot3000.github.io/MY-ERGO-DEX/` (GitHub Pages)

## Honest status

| What | Status |
|---|---|
| Swap quotes (x·y=k, 0.5% pool fee) | ✅ Works — against *estimated* reserves (see below) |
| Token directory + pool browser | ✅ Works — public Spectrum/explorer data |
| Nautilus wallet connect (EIP-12) | ⚠️ Implemented from docs, **untested live** — read-only address/balance display, graceful fallback |
| On-chain swap settlement | ❌ **Phase 2** — preview panel only, button disabled |
| Add/remove liquidity | ❌ **Phase 2** — buttons disabled with explanation |
| Protocol fee (0.25%) | ❌ Shown as a line item, **not collected in v1** |
| Audits | ❌ None — never claimed |

## Name

**AstroErg** — verified collision-free 2026-09-28 against CoinGecko/CoinMarketCap,
X/Twitter, and GitHub. Rejected: `AstroDEX`/`AstroSwap` (taken — Cardano DEX /
FHEVM project), `StarDEX` (taken — dead ERC-20), `NebulaDEX` (taken — Base DEX),
`Ergonaut` (taken — Ergo community handbook at ergonaut.space), `NovaDEX`
(taken — Solana DEX, NVX token), `OrbitDEX` (taken — Stellar AMM + Orbit
Finance + @OrbitPerps).

## How quotes work

Spectrum's public price-tracking API publishes `lastPrice` + volumes per
market — **not pool reserves**. AstroErg estimates reserves as:

1. Spot price `p = lastPrice` (verified: human quote-units per human base-unit)
2. Quote-denominated reported volume `V = max(baseVol × p, quoteVol)`
3. Assumed depth `D = 10 × V` ← the heuristic guess, labeled everywhere
4. Reserves `R_quote = D/2`, `R_base = R_quote / p` (50/50 by value at spot)

Every reserve figure carries an `estimated` label in the UI. Token→token pairs
route via ERG in two legs (labeled). Full methodology: `docs.html#methodology`,
`scripts/build-snapshots.py`.

## Data strategy (CORS)

Neither `api.spectrum.fi` nor `api.ergoplatform.com` sends
`Access-Control-Allow-Origin` headers, so browsers can't call them directly.
The app tries a live fetch first, then falls back to baked snapshots in
`data/` with a visible **"SNAPSHOT · as of \<timestamp\>"** badge.

```bash
./scripts/refresh-data.sh   # re-pull snapshots (curl + python3, no deps)
```

Snapshots: `data/markets.json` (353 unique pairs @ 2026-09-28), `data/tokens.json`
(40 tokens, explorer-enriched).

## Project layout

```
index.html  pools.html  tokens.html  docs.html   # pages (?v= cache-busted assets)
css/style.css                                        # deep-space theme
js/aelib.js      # pure logic (UMD: browser + node) — quotes, fees, formatting
js/app.js        # data loading (live→snapshot), Nautilus wallet, chrome
js/swap.js       # swap UI + order preview
js/pools.js      # pools table
js/tokens.js     # token directory
js/fx-starfield.js  # animated starfield canvas
data/            # baked snapshots (+ raw API responses)
scripts/         # refresh-data.sh, build-snapshots.py
tests/           # node --test suite (23 tests)
```

## Fees

- **Protocol fee 0.25%** of swap input → recipient
  `9fcM5RWnAjmP4vx5bnW6yohB6H9bLq8sJbaPLHtwZLtQPB32Pvy`
  (click-to-copy in UI + docs). Goes live with Phase 2 settlement.
- **Pool fee 0.5%** kept in reserves (Spectrum-style), accrues to LPs.

## Tests

```bash
node --test tests/astroerg.test.js
```

23 tests, all passing: x·y=k quote math incl. fees, k-invariant, price impact,
slippage, two-leg routing, 0.25% fee math, ERG 9-decimal formatting round-trips,
API parsing with a real-response fixture (dedupe, reserve estimation, malformed
entries), token-ID + Ergo-address validation.

## Roadmap

- **Phase 1 (this):** quote terminal. No contracts, no custody, no fake trades.
- **Phase 2:** fork the CC0 Spectrum contracts (`spectrum-finance/ergo-dex`) →
  testnet shakedown → community review → mainnet with capped liquidity. Only
  then do settlement/liquidity buttons activate and the 0.25% fee flow.
- **Phase 3:** limit orders, deeper routing.

## Risks (also in docs.html)

Unaudited code (no formal audit industry in Ergo — we won't claim otherwise),
MEV/front-running on public mempools, pool-box contention (single UTXO per
pool → retries), executor-order dependency, estimated depth in v1 quotes,
token-ID lookalikes.

---

Built by [@kshot9000](https://x.com/kshot9000) · Market data: Spectrum Finance
public API · Chain data: Ergo explorer · Not financial advice.
