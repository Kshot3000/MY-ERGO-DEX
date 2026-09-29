/* ============================================================
   Airlock pure-logic library (aelib)
   UMD: loads as window.AELib in the browser, require()able in node.
   No DOM access here — every function is unit-testable.

   Money model: all token amounts are BigInt RAW units (nanoErg = 1e-9 ERG,
   per EIP-4 decimals). Integer math only — no float drift in quotes.
   ============================================================ */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.AELib = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var ERG_ID = "0".repeat(64);
  var POOL_FEE_BPS = 50; // 0.5% — Spectrum-style AMM, kept in reserves
  var PROTOCOL_FEE_BPS = 25; // 0.25% — protocol fee (goes live with Phase 2 settlement)
  var BPS = 10000n;
  // Reserve-estimation heuristic: assumed pool depth ~= this multiple of
  // reported volume. The Spectrum price-tracking API does not publish
  // reserves, so quotes are indicative. Documented in docs.html + code.
  var VOL_DEPTH_MULT = 10;

  /* ---------- validation ---------- */

  // EIP-4 token id: 64 lowercase/uppercase hex chars. ERG itself is 64 zeros.
  function isValidTokenId(id) {
    return typeof id === "string" && /^[0-9a-fA-F]{64}$/.test(id);
  }

  function isValidErgoAddress(addr) {
    // P2PK Ergo addresses are base58, ~51 chars, start with '9'.
    return typeof addr === "string" && /^9[1-9A-HJ-NP-Za-km-z]{50}$/.test(addr);
  }

  /* ---------- formatting ---------- */

  // BigInt raw -> human string with up to `decimals` places, trailing zeros trimmed.
  function formatAmount(raw, decimals) {
    raw = BigInt(raw);
    var neg = raw < 0n;
    if (neg) raw = -raw;
    var s = raw.toString().padStart(decimals + 1, "0");
    var intPart = s.slice(0, s.length - decimals);
    var fracPart = s.slice(s.length - decimals).replace(/0+$/, "");
    // thousands separators on the integer part
    intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (neg ? "-" : "") + intPart + (fracPart ? "." + fracPart : "");
  }

  // Human decimal string -> BigInt raw units (truncates excess precision).
  function parseAmount(human, decimals) {
    if (typeof human !== "string") human = String(human);
    human = human.trim().replace(/,/g, "");
    if (!/^\d*(\.\d*)?$/.test(human) || human === "" || human === ".") {
      throw new Error("Invalid amount: " + human);
    }
    var parts = human.split(".");
    var intPart = parts[0] === "" ? "0" : parts[0];
    var fracPart = (parts[1] || "").slice(0, decimals).padEnd(decimals, "0");
    return BigInt(intPart + fracPart);
  }

  function truncateId(id, keep) {
    keep = keep || 8;
    if (!id || id.length <= keep * 2 + 3) return id;
    return id.slice(0, keep) + "…" + id.slice(-keep);
  }

  /* ---------- AMM quote engine (x * y = k) ---------- */

  // Exact-in quote against a constant-product pool.
  // amountInRaw: BigInt (BEFORE protocol fee), reserveInRaw/reserveOutRaw: BigInt.
  // Returns { amountOutRaw, protocolFeeRaw, poolFeeRaw, priceImpactBps,
  //           executionPriceRaw (out per in, scaled 1e18), spotPriceRaw }.
  //
  // Fee model (matches Spectrum-style pools + Airlock protocol fee):
  //   1. protocolFee = 0.25% of input — earmarked for the protocol fee
  //      recipient; NOT collected on-chain in v1 (labeled "Phase 2").
  //   2. poolFee = 0.5% of the post-protocol-fee input — stays in reserves.
  //   3. swap executes on the remainder via x*y=k.
  function quoteExactIn(
    amountInRaw,
    reserveInRaw,
    reserveOutRaw,
    protocolFeeBps,
  ) {
    amountInRaw = BigInt(amountInRaw);
    reserveInRaw = BigInt(reserveInRaw);
    reserveOutRaw = BigInt(reserveOutRaw);
    if (amountInRaw <= 0n) throw new Error("amount must be > 0");
    if (reserveInRaw <= 0n || reserveOutRaw <= 0n) {
      throw new Error("pool has no liquidity");
    }

    var feeBps = protocolFeeBps == null ? PROTOCOL_FEE_BPS : protocolFeeBps;
    if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps >= 10000)
      throw new Error("invalid protocol fee");
    var protocolFeeRaw = (amountInRaw * BigInt(feeBps)) / BPS;
    var afterProtocol = amountInRaw - protocolFeeRaw;
    var poolFeeRaw = (afterProtocol * BigInt(POOL_FEE_BPS)) / BPS;
    var effectiveIn = afterProtocol - poolFeeRaw;

    // x*y=k: out = R_out * effIn / (R_in + effIn)
    var amountOutRaw =
      (reserveOutRaw * effectiveIn) / (reserveInRaw + effectiveIn);

    // price impact vs infinitesimal spot price (unitless; decimals cancel)
    // spot = R_out / R_in ; exec = out / effectiveIn
    // impact_bps = (spot - exec)/spot * 10000
    //            = 1 - out*(R_in)/(R_out*effIn)  ... in bps:
    var impactBps =
      BPS - (amountOutRaw * reserveInRaw * BPS) / (reserveOutRaw * effectiveIn);
    if (impactBps < 0n) impactBps = 0n;

    return {
      amountOutRaw: amountOutRaw,
      protocolFeeRaw: protocolFeeRaw,
      poolFeeRaw: poolFeeRaw,
      effectiveInRaw: effectiveIn,
      priceImpactBps: impactBps,
      // scaled prices for display (1e18 fixed point, unitless ratios)
      spotPriceX1e18: (reserveOutRaw * 1000000000000000000n) / reserveInRaw,
      execPriceX1e18:
        effectiveIn > 0n
          ? (amountOutRaw * 1000000000000000000n) / effectiveIn
          : 0n,
    };
  }

  // Minimum received after slippage tolerance (slippageBps, e.g. 50 = 0.5%).
  function applySlippage(amountOutRaw, slippageBps) {
    amountOutRaw = BigInt(amountOutRaw);
    var b = BigInt(slippageBps);
    if (b < 0n || b >= BPS) throw new Error("bad slippage");
    return (amountOutRaw * (BPS - b)) / BPS;
  }

  /* ---------- market data processing (live path mirrors build-snapshots.py) ---------- */

  // rawMarkets: array straight from api.spectrum.fi/v1/price-tracking/markets
  // Returns { pairs: [...], fetchedAt } with dedupe + reserve estimates.
  // Pair shape matches data/markets.json so UI code is identical for both paths.
  function processMarkets(rawMarkets, fetchedAt) {
    var best = {}; // key: sorted ids joined -> {score, m, bv, qv}
    rawMarkets.forEach(function (m) {
      try {
        var b = m.baseId,
          q = m.quoteId;
        var ba = m.baseVolume.units.asset,
          qa = m.quoteVolume.units.asset;
        var bv = m.baseVolume.value / Math.pow(10, ba.decimals);
        var qv = m.quoteVolume.value / Math.pow(10, qa.decimals);
        var key = [b, q].sort().join("_");
        var score = bv + qv;
        if (!best[key] || score > best[key].score) {
          best[key] = { score: score, m: m, bv: bv, qv: qv };
        }
      } catch (e) {
        /* skip malformed */
      }
    });

    var pairs = Object.keys(best).map(function (key) {
      var entry = best[key];
      var m = entry.m,
        bv = entry.bv,
        qv = entry.qv;
      var b = m.baseId,
        q = m.quoteId;
      var ba = m.baseVolume.units.asset,
        qa = m.quoteVolume.units.asset;
      var price = m.lastPrice; // human quote-units per human base-unit
      var pair = {
        id: m.id,
        base: { tokenId: b, ticker: ba.ticker, decimals: ba.decimals },
        quote: { tokenId: q, ticker: qa.ticker, decimals: qa.decimals },
        lastPrice: price,
        volume: {
          base: bv,
          quote: qv,
          window: "undocumented (as reported by api.spectrum.fi)",
        },
      };
      if ((b === ERG_ID || q === ERG_ID) && price && price > 0) {
        var reserves;
        if (b === ERG_ID) {
          // ERG(base)/X(quote): price = X per ERG
          var vx = Math.max(bv * price, qv);
          var rx = (VOL_DEPTH_MULT * vx) / 2;
          var rerg = rx / price;
          reserves = {
            erg: { human: rerg, raw: String(BigInt(Math.floor(rerg * 1e9))) },
            token: {
              tokenId: q,
              human: rx,
              raw: String(BigInt(Math.floor(rx * Math.pow(10, qa.decimals)))),
            },
          };
        } else {
          // X(base)/ERG(quote): price = ERG per X
          var verg = Math.max(bv * price, qv);
          var rerg2 = (VOL_DEPTH_MULT * verg) / 2;
          var rx2 = rerg2 / price;
          var tdec = ba.decimals;
          reserves = {
            erg: { human: rerg2, raw: String(BigInt(Math.floor(rerg2 * 1e9))) },
            token: {
              tokenId: b,
              human: rx2,
              raw: String(BigInt(Math.floor(rx2 * Math.pow(10, tdec)))),
            },
          };
        }
        reserves.estimated = true;
        reserves.method =
          "heuristic: depth ~= " +
          VOL_DEPTH_MULT +
          "x reported volume; " +
          "reserves split 50/50 by value at spot price. Real pool reserves " +
          "are NOT published by the API.";
        pair.reserves = reserves;
      }
      return pair;
    });

    return { pairs: pairs, fetchedAt: fetchedAt || new Date().toISOString() };
  }

  // Find the ERG pair for a token id; returns {pair, tokenIsBase} or null.
  function findErgPair(pairs, tokenId) {
    for (var i = 0; i < pairs.length; i++) {
      var p = pairs[i];
      if (!p.reserves) continue;
      if (p.base.tokenId === tokenId && p.quote.tokenId === ERG_ID)
        return { pair: p, tokenIsBase: true };
      if (p.quote.tokenId === tokenId && p.base.tokenId === ERG_ID)
        return { pair: p, tokenIsBase: false };
    }
    return null;
  }

  // Two-leg quote X -> ERG -> Y. Returns combined quote + per-leg detail.
  function quoteTwoLeg(amountInRaw, leg1, leg2) {
    // leg = {reserveInRaw, reserveOutRaw}
    var q1 = quoteExactIn(amountInRaw, leg1.reserveInRaw, leg1.reserveOutRaw);
    if (q1.amountOutRaw <= 0n)
      throw new Error("amount too small for this route");
    // The protocol fee is modeled once on the original input, never on ERG again.
    var q2 = quoteExactIn(
      q1.amountOutRaw,
      leg2.reserveInRaw,
      leg2.reserveOutRaw,
      0,
    );
    return {
      amountOutRaw: q2.amountOutRaw,
      protocolFeeRaw: q1.protocolFeeRaw, // protocol fee taken once, on the original input
      // Different token denominations must not be summed. Use legs for display.
      poolFeeRaw: q1.poolFeeRaw,
      poolFeesRaw: [q1.poolFeeRaw, q2.poolFeeRaw],
      priceImpactBps:
        BPS - ((BPS - q1.priceImpactBps) * (BPS - q2.priceImpactBps)) / BPS,
      legs: [q1, q2],
    };
  }

  return {
    ERG_ID: ERG_ID,
    POOL_FEE_BPS: POOL_FEE_BPS,
    PROTOCOL_FEE_BPS: PROTOCOL_FEE_BPS,
    VOL_DEPTH_MULT: VOL_DEPTH_MULT,
    isValidTokenId: isValidTokenId,
    isValidErgoAddress: isValidErgoAddress,
    formatAmount: formatAmount,
    parseAmount: parseAmount,
    truncateId: truncateId,
    quoteExactIn: quoteExactIn,
    quoteTwoLeg: quoteTwoLeg,
    applySlippage: applySlippage,
    processMarkets: processMarkets,
    findErgPair: findErgPair,
  };
});
