/* Airlock tests — run with: node --test tests/
   Covers: quote math (x*y=k incl. fees), fee math, formatting (ERG 9-dec),
   API parsing with a real-response fixture, token-ID validation. */
"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const AELib = require("../js/aelib.js");

const ERG = AELib.ERG_ID;
const SIGUSD = "03faf2cb329f2e90d6d23b58d91bbb6c046aa143261cc21f52fbe2824bfcbf04";
const FEE_WALLET = "9fcM5RWnAjmP4vx5bnW6yohB6H9bLq8sJbaPLHtwZLtQPB32Pvy";

describe("token validation", () => {
  it("accepts the canonical 64-hex token IDs", () => {
    assert.ok(AELib.isValidTokenId(SIGUSD));
    assert.ok(AELib.isValidTokenId("003bd19d0187117f130b62e1bcab0939929ff5c7709f843c5c4dd158949285d0")); // SigRSV
    assert.ok(AELib.isValidTokenId(ERG));
  });
  it("rejects malformed IDs", () => {
    assert.ok(!AELib.isValidTokenId("03faf2cb"));                 // too short
    assert.ok(!AELib.isValidTokenId("z".repeat(64)));             // non-hex
    assert.ok(!AELib.isValidTokenId("03faf2cb329f2e90d6d23b58d91bbb6c046aa143261cc21f52fbe2824bfcbf0")); // 63 chars
    assert.ok(!AELib.isValidTokenId(""));                        // empty
    assert.ok(!AELib.isValidTokenId(null));                       // null
  });
  it("validates the protocol fee wallet as an Ergo P2PK address", () => {
    assert.ok(AELib.isValidErgoAddress(FEE_WALLET));
    assert.ok(!AELib.isValidErgoAddress("not-an-address"));
    assert.ok(!AELib.isValidErgoAddress("8fcM5RWnAjmP4vx5bnW6yohB6H9bLq8sJbaPLHtwZLtQPB32Pvy")); // wrong prefix
  });
});

describe("amount formatting (ERG has 9 decimals)", () => {
  it("formats raw nanoErg to human strings", () => {
    assert.equal(AELib.formatAmount(1000000000n, 9), "1");
    assert.equal(AELib.formatAmount(1234567890n, 9), "1.23456789");
    assert.equal(AELib.formatAmount(1500000n, 6), "1.5");
    assert.equal(AELib.formatAmount(0n, 9), "0");
    assert.equal(AELib.formatAmount(1n, 9), "0.000000001");
    assert.equal(AELib.formatAmount(1234567890123n, 9), "1,234.567890123");
  });
  it("parses human strings back to raw units (truncating excess precision)", () => {
    assert.equal(AELib.parseAmount("1", 9), 1000000000n);
    assert.equal(AELib.parseAmount("1.5", 9), 1500000000n);
    assert.equal(AELib.parseAmount("0.000000001", 9), 1n);
    assert.equal(AELib.parseAmount("1.1234567899", 9), 1123456789n); // truncated, not rounded
    assert.equal(AELib.parseAmount("1,234.5", 9), 1234500000000n);   // commas ok
  });
  it("round-trips", () => {
    for (const raw of [0n, 1n, 999999999n, 1000000000n, 123456789012345678n]) {
      assert.equal(AELib.parseAmount(AELib.formatAmount(raw, 9), 9), raw);
    }
  });
  it("rejects garbage input", () => {
    assert.throws(() => AELib.parseAmount("abc", 9));
    assert.throws(() => AELib.parseAmount("", 9));
    assert.throws(() => AELib.parseAmount("1.2.3", 9));
  });
  it("truncates token IDs for display", () => {
    assert.equal(AELib.truncateId(SIGUSD, 8), "03faf2cb…4bfcbf04");
  });
});

describe("AMM quote engine (x*y=k)", () => {
  const R_IN = 1_000_000n, R_OUT = 2_000_000n, AMT = 10_000n;

  it("computes exact fee splits: 0.25% protocol, 0.5% pool", () => {
    const q = AELib.quoteExactIn(AMT, R_IN, R_OUT);
    assert.equal(q.protocolFeeRaw, 25n);                       // 10000 * 25 / 10000
    assert.equal(q.poolFeeRaw, 49n);                           // (10000-25) * 50 / 10000 = 49 (floored)
    assert.equal(q.effectiveInRaw, AMT - 25n - 49n);           // 9926
    assert.equal(q.amountOutRaw, (R_OUT * 9926n) / (R_IN + 9926n));
  });
  it("never decreases k (constant-product invariant)", () => {
    for (const amt of [1n, 100n, 10_000n, 500_000n]) {
      const q = AELib.quoteExactIn(amt, R_IN, R_OUT);
      const kBefore = R_IN * R_OUT;
      const kAfter = (R_IN + q.effectiveInRaw) * (R_OUT - q.amountOutRaw);
      assert.ok(kAfter >= kBefore, `k decreased for amt=${amt}`);
    }
  });
  it("output is always positive and below reserves", () => {
    const q = AELib.quoteExactIn(AMT, R_IN, R_OUT);
    assert.ok(q.amountOutRaw > 0n && q.amountOutRaw < R_OUT);
  });
  it("price impact grows with trade size and is tiny for dust", () => {
    const dust = AELib.quoteExactIn(1000n, 1_000_000_000_000n, 1_000_000_000_000n);
    const whale = AELib.quoteExactIn(500_000_000n, 1_000_000_000n, 1_000_000_000n);
    assert.ok(dust.priceImpactBps < 50n, `dust impact=${dust.priceImpactBps}bps`);
    assert.ok(whale.priceImpactBps > 1000n, "whale trade should move price >10%");
    assert.ok(whale.priceImpactBps > dust.priceImpactBps);
  });
  it("tiny trade executes near spot price (minus the 0.5% pool fee)", () => {
    const q = AELib.quoteExactIn(100000n, 1_000_000_000n, 2_000_000_000n);
    // spot = 2.0 out per in; exec trails by ~ the 0.5% pool fee + 0.25% protocol fee
    const ratio = Number(q.execPriceX1e18) / Number(q.spotPriceX1e18);
    assert.ok(ratio > 0.99 && ratio <= 1.0, `ratio=${ratio}`);
  });
  it("rejects zero/negative amounts and empty pools", () => {
    assert.throws(() => AELib.quoteExactIn(0n, R_IN, R_OUT));
    assert.throws(() => AELib.quoteExactIn(AMT, 0n, R_OUT));
    assert.throws(() => AELib.quoteExactIn(AMT, R_IN, 0n));
  });
  it("applies slippage tolerance correctly", () => {
    assert.equal(AELib.applySlippage(10000n, 50), 9950n);   // 0.5%
    assert.equal(AELib.applySlippage(10000n, 100), 9900n);  // 1%
    assert.equal(AELib.applySlippage(9999n, 50), 9949n);    // floors
    assert.throws(() => AELib.applySlippage(100n, 10000));  // 100% invalid
  });
  it("two-leg routing equals sequential single-leg quotes", () => {
    const leg1 = { reserveInRaw: 1_000_000n, reserveOutRaw: 3_000_000n };  // X -> ERG
    const leg2 = { reserveInRaw: 3_000_000n, reserveOutRaw: 9_000_000n };  // ERG -> Y
    const two = AELib.quoteTwoLeg(50_000n, leg1, leg2);
    const s1 = AELib.quoteExactIn(50_000n, leg1.reserveInRaw, leg1.reserveOutRaw);
    const s2 = AELib.quoteExactIn(s1.amountOutRaw, leg2.reserveInRaw, leg2.reserveOutRaw);
    assert.equal(two.amountOutRaw, s2.amountOutRaw);
    assert.equal(two.protocolFeeRaw, s1.protocolFeeRaw); // protocol fee taken once
    assert.equal(two.poolFeeRaw, s1.poolFeeRaw + s2.poolFeeRaw);
  });
});

describe("market data processing (real-response fixture)", () => {
  const raw = JSON.parse(
    fs.readFileSync(path.join(__dirname, "fixtures", "markets-sample.json"), "utf8")
  );

  it("loads the real fixture (4 valid + 1 malformed market)", () => {
    assert.equal(raw.length, 5);
  });

  it("dedupes markets by token pair, keeping the highest-volume one", () => {
    const { pairs } = AELib.processMarkets(raw, "2026-09-28T00:00:00Z");
    const sigPairs = pairs.filter(
      (p) => new Set([p.base.tokenId, p.quote.tokenId]).has(SIGUSD) &&
             new Set([p.base.tokenId, p.quote.tokenId]).has(ERG)
    );
    assert.equal(sigPairs.length, 1); // two ERG/SigUSD markets -> one pair
    assert.ok(sigPairs[0].volume.base > 1_000_000, "kept the big pool, not the dust one");
  });

  it("skips malformed entries without throwing", () => {
    const { pairs } = AELib.processMarkets(raw);
    assert.equal(pairs.length, 3); // ERG/SigUSD, ERG/COMET, GIF/BBC
  });

  it("estimates reserves for ERG pairs and labels them estimated", () => {
    const { pairs } = AELib.processMarkets(raw);
    const ergPairs = pairs.filter((p) => p.reserves);
    assert.equal(ergPairs.length, 2);
    for (const p of ergPairs) {
      assert.equal(p.reserves.estimated, true);
      assert.ok(p.reserves.method.includes("10x"));
      assert.ok(BigInt(p.reserves.erg.raw) > 0n);
      assert.ok(BigInt(p.reserves.token.raw) > 0n);
    }
    // spot price of the estimate matches the market price (50/50 by value)
    const sig = ergPairs.find((p) => p.reserves.token.tokenId === SIGUSD);
    const spot = sig.reserves.token.human / sig.reserves.erg.human; // SigUSD per ERG
    assert.ok(Math.abs(spot - sig.lastPrice) / sig.lastPrice < 1e-9);
  });

  it("gives non-ERG pairs price+volume but no reserves", () => {
    const { pairs } = AELib.processMarkets(raw);
    const gif = pairs.find((p) => p.base.ticker === "GIF");
    assert.ok(gif);
    assert.ok(!("reserves" in gif));
    assert.ok(gif.lastPrice > 0);
  });

  it("findErgPair locates quotable pairs", () => {
    const { pairs } = AELib.processMarkets(raw);
    const found = AELib.findErgPair(pairs, SIGUSD);
    assert.ok(found && found.pair.reserves);
    assert.equal(AELib.findErgPair(pairs, "f".repeat(64)), null);
  });

  it("an end-to-end quote works off processed fixture data", () => {
    const { pairs } = AELib.processMarkets(raw);
    const { pair } = AELib.findErgPair(pairs, SIGUSD);
    const r = pair.reserves;
    // 1 ERG -> SigUSD
    const q = AELib.quoteExactIn(1_000_000_000n, BigInt(r.erg.raw), BigInt(r.token.raw));
    assert.ok(q.amountOutRaw > 0n);
    // ~0.3 SigUSD per ERG at fixture prices (2 decimals -> ~30 raw units)
    const outHuman = Number(q.amountOutRaw) / 100;
    assert.ok(outHuman > 0.2 && outHuman < 0.4, `out=${outHuman} SigUSD`);
  });
});
