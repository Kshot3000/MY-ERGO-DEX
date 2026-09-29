/* ============================================================
   Airlock swap page — js/swap.js (v0.2.0)

   QUOTE ENGINE (honest by design):
   - Quotes are computed with x*y=k against RESERVE ESTIMATES derived from
     public Spectrum market data (see scripts/build-snapshots.py for the
     method). They are NOT live pool reserves — the API doesn't publish them.
   - 0.5% pool fee stays in reserves (Spectrum-style); 0.25% protocol fee is
     shown as a line item but is NOT collected in v1 ("goes live with
     Phase 2 settlement").
   - v1 NEVER creates or submits a transaction. The button opens an
     order-preview panel and is labeled "Phase 2: on-chain settlement".
   ============================================================ */
(function () {
  "use strict";

  var ERG, SLIPPAGE_BPS = 50; // default 0.5%
  var inToken = null, outToken = null;
  var currentQuote = null;

  function el(id) { return document.getElementById(id); }

  function swappableTokens() {
    // tokens with an ERG pair that has reserve estimates, sorted by ERG volume-ish
    var seen = {}, list = [];
    AstroApp.state.pairs.forEach(function (p) {
      if (!p.reserves) return;
      var tid = p.reserves.token.tokenId;
      if (seen[tid]) return;
      seen[tid] = true;
      list.push({ tokenId: tid, ticker: AstroApp.tokenLabel(tid) });
    });
    list.sort(function (a, b) { return a.ticker.localeCompare(b.ticker); });
    return [{ tokenId: ERG, ticker: "ERG" }].concat(list);
  }

  function fillSelect(sel, tokens, selectedId) {
    sel.innerHTML = "";
    tokens.forEach(function (t) {
      var o = document.createElement("option");
      o.value = t.tokenId;
      o.textContent = t.ticker;
      if (t.tokenId === selectedId) o.selected = true;
      sel.appendChild(o);
    });
  }

  // Resolve reserves for a direction: returns {reserveInRaw, reserveOutRaw, route}
  // route: 'direct' (ERG pair) or 'via-erg' (two legs).
  function resolveReserves(inId, outId) {
    if (inId === ERG || outId === ERG) {
      var other = inId === ERG ? outId : inId;
      var found = AELib.findErgPair(AstroApp.state.pairs, other);
      if (!found) return null;
      var r = found.pair.reserves;
      var ergRaw = BigInt(r.erg.raw), tokRaw = BigInt(r.token.raw);
      var inIsErg = inId === ERG;
      return {
        route: "direct",
        reserveInRaw: inIsErg ? ergRaw : tokRaw,
        reserveOutRaw: inIsErg ? tokRaw : ergRaw,
        pairNote: found.pair.base.ticker + "/" + found.pair.quote.ticker,
      };
    }
    // token -> token: route through ERG, two legs
    var legA = AELib.findErgPair(AstroApp.state.pairs, inId);
    var legB = AELib.findErgPair(AstroApp.state.pairs, outId);
    if (!legA || !legB) return null;
    var ra = legA.pair.reserves, rb = legB.pair.reserves;
    return {
      route: "via-erg",
      leg1: { reserveInRaw: BigInt(ra.token.raw), reserveOutRaw: BigInt(ra.erg.raw) },
      leg2: { reserveInRaw: BigInt(rb.erg.raw), reserveOutRaw: BigInt(rb.token.raw) },
      pairNote: AstroApp.tokenLabel(inId) + "→ERG→" + AstroApp.tokenLabel(outId),
    };
  }

  function fmt(raw, tokenId) {
    return AELib.formatAmount(raw, AstroApp.tokenDecimals(tokenId));
  }

  function recompute() {
    var inSel = el("in-token"), outSel = el("out-token"), amtEl = el("in-amount");
    inToken = inSel.value; outToken = outSel.value;
    var box = el("quote-box");
    currentQuote = null;

    // token meta line
    el("in-meta").textContent = inToken === ERG ? "native · 9 decimals"
      : "EIP-4 · " + AstroApp.tokenDecimals(inToken) + " decimals";
    el("out-meta").textContent = outToken === ERG ? "native · 9 decimals"
      : "EIP-4 · " + AstroApp.tokenDecimals(outToken) + " decimals";

    var rawText = (amtEl.value || "").trim();
    if (!rawText) { box.innerHTML = hint("Enter an amount to get a quote."); return; }
    if (inToken === outToken) { box.innerHTML = hint("Pick two different tokens."); return; }

    var amountIn;
    try {
      amountIn = AELib.parseAmount(rawText, AstroApp.tokenDecimals(inToken));
    } catch (e) { box.innerHTML = hint("That amount doesn't parse — use digits only."); return; }
    if (amountIn <= 0n) { box.innerHTML = hint("Amount must be greater than zero."); return; }

    var res = resolveReserves(inToken, outToken);
    if (!res) {
      box.innerHTML = hint("No liquid ERG route for this pair in current market data.");
      return;
    }

    try {
      var q = res.route === "direct"
        ? AELib.quoteExactIn(amountIn, res.reserveInRaw, res.reserveOutRaw)
        : AELib.quoteTwoLeg(amountIn, res.leg1, res.leg2);
      currentQuote = { q: q, res: res, amountIn: amountIn };

      var inDec = AstroApp.tokenDecimals(inToken), outDec = AstroApp.tokenDecimals(outToken);
      var inTick = AstroApp.tokenLabel(inToken), outTick = AstroApp.tokenLabel(outToken);
      var minRecv = AELib.applySlippage(q.amountOutRaw, SLIPPAGE_BPS);
      var impactPct = (Number(q.priceImpactBps) / 100).toFixed(2);

      // spot rate for display (out per in, human)
      var rateStr;
      try {
        var outH = Number(q.amountOutRaw) / Math.pow(10, outDec);
        var inH = Number(amountIn) / Math.pow(10, inDec);
        rateStr = inH > 0 ? (outH / inH).toPrecision(6) : "—";
      } catch (e) { rateStr = "—"; }

      var impactCls = Number(q.priceImpactBps) > 500 ? "bad" : Number(q.priceImpactBps) > 100 ? "warn" : "";

      var html = "";
      html += '<div class="quote-line"><span>Expected output</span><span class="v" style="color:var(--teal);font-size:1.02rem;font-weight:700">' +
        AstroApp.esc(fmt(q.amountOutRaw, outToken)) + " " + AstroApp.esc(outTick) + "</span></div>";
      html += '<div class="quote-line"><span>Rate (indicative)</span><span class="v">1 ' + AstroApp.esc(inTick) +
        " ≈ " + rateStr + " " + AstroApp.esc(outTick) + "</span></div>";
      html += '<div class="quote-line"><span>Price impact <span class="pill estimated">estimated depth</span></span>' +
        '<span class="v ' + impactCls + '">' + impactPct + "%</span></div>";
      html += '<div class="quote-line"><span>Pool fee (0.5%, stays in reserves)</span><span class="v">' +
        AstroApp.esc(fmt(q.poolFeeRaw, inToken)) + " " + AstroApp.esc(inTick) + "</span></div>";
      html += '<div class="quote-line"><span>Protocol fee (0.25%)</span><span class="v">' +
        AstroApp.esc(fmt(q.protocolFeeRaw, inToken)) + " " + AstroApp.esc(inTick) +
        '<br><span class="fee-note">goes live with Phase 2 settlement — not collected in v1</span></span></div>';
      html += '<div class="quote-line"><span>Minimum received (' + (SLIPPAGE_BPS / 100) + "% slippage)</span>" +
        '<span class="v">' + AstroApp.esc(fmt(minRecv, outToken)) + " " + AstroApp.esc(outTick) + "</span></div>";
      if (res.route === "via-erg") {
        html += '<div class="route-note">⇄ Routed via ERG in two legs (' +
          AstroApp.esc(res.pairNote) + "). Each leg pays the 0.5% pool fee; the 0.25% protocol fee applies once to your input.</div>";
      } else {
        html += '<div class="route-note" style="color:var(--muted);border-color:var(--line)">Direct route on the ' +
          AstroApp.esc(res.pairNote) + " market (estimated reserves).</div>";
      }
      box.innerHTML = html;
      el("preview-btn").disabled = false;
    } catch (e) {
      box.innerHTML = hint("Quote failed: " + AstroApp.esc(e.message));
      el("preview-btn").disabled = true;
    }
  }

  function hint(t) { return '<div style="color:var(--faint);font-size:0.88rem;padding:8px 2px">' + t + "</div>"; }

  function openPreview() {
    if (!currentQuote) return;
    var q = currentQuote.q, amountIn = currentQuote.amountIn;
    var inTick = AstroApp.tokenLabel(inToken), outTick = AstroApp.tokenLabel(outToken);
    var minRecv = AELib.applySlippage(q.amountOutRaw, SLIPPAGE_BPS);

    el("pv-in").textContent = fmt(amountIn, inToken) + " " + inTick;
    el("pv-out").textContent = fmt(q.amountOutRaw, outToken) + " " + outTick;
    var rows = "";
    rows += pvRow("Pool fee (0.5%)", fmt(q.poolFeeRaw, inToken) + " " + inTick, "kept in reserves (Spectrum-style)");
    rows += pvRow("Protocol fee (0.25%)", fmt(q.protocolFeeRaw, inToken) + " " + inTick, "Phase 2 — not collected in v1");
    rows += pvRow("Price impact", (Number(q.priceImpactBps) / 100).toFixed(2) + "%", "vs spot, on estimated depth");
    rows += pvRow("Minimum received", fmt(minRecv, outToken) + " " + outTick, (SLIPPAGE_BPS / 100) + "% slippage tolerance");
    rows += pvRow("Route", currentQuote.res.route === "direct" ? "Direct · " + currentQuote.res.pairNote : "Via ERG · " + currentQuote.res.pairNote, "");
    rows += pvRow("Settlement", "Phase 2", "v1 creates no transaction");
    el("pv-rows").innerHTML = rows;
    el("preview-modal").classList.add("open");
  }

  function pvRow(k, v, note) {
    return '<div class="quote-line"><span>' + AstroApp.esc(k) +
      (note ? '<br><span class="fee-note">' + AstroApp.esc(note) + "</span>" : "") +
      '</span><span class="v">' + AstroApp.esc(v) + "</span></div>";
  }

  document.addEventListener("DOMContentLoaded", function () {
    ERG = AELib.ERG_ID;
    AstroApp.initData(function () {
      var tokens = swappableTokens();
      var inSel = el("in-token"), outSel = el("out-token");
      fillSelect(inSel, tokens, ERG);
      // default quote token: SigUSD if present
      var sig = tokens.find(function (t) { return t.ticker === "SigUSD"; });
      fillSelect(outSel, tokens, sig ? sig.tokenId : (tokens[1] ? tokens[1].tokenId : ERG));
      el("pair-count").textContent = tokens.length - 1;

      inSel.addEventListener("change", recompute);
      outSel.addEventListener("change", recompute);
      el("in-amount").addEventListener("input", recompute);
      el("flip").addEventListener("click", function () {
        var a = inSel.value; inSel.value = outSel.value; outSel.value = a;
        recompute();
      });
      AstroApp.$all(".slip-btn").forEach(function (b) {
        b.addEventListener("click", function () {
          AstroApp.$all(".slip-btn").forEach(function (x) { x.classList.remove("on"); });
          b.classList.add("on");
          SLIPPAGE_BPS = parseInt(b.getAttribute("data-slip"), 10);
          recompute();
        });
      });
      el("preview-btn").addEventListener("click", openPreview);
      el("modal-close").addEventListener("click", function () {
        el("preview-modal").classList.remove("open");
      });
      el("preview-modal").addEventListener("click", function (e) {
        if (e.target === el("preview-modal")) el("preview-modal").classList.remove("open");
      });
      recompute();
    });
  });
})();
