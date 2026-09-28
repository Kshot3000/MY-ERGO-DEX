/* ============================================================
   AstroErg pools page — js/pools.js (v0.2.0)
   Table of all unique pairs from market data. Reserve figures are
   ESTIMATES (labeled) for ERG pairs; non-ERG pairs show n/a.
   Add/remove liquidity buttons are disabled + labeled Phase 2.
   ============================================================ */
(function () {
  "use strict";

  function fmtUsd(n) {
    if (n == null || !isFinite(n)) return "—";
    if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
    return n.toFixed(2);
  }

  function pairKey(p) {
    return [p.base.tokenId, p.quote.tokenId].sort().join("_");
  }

  function render(pairs) {
    var q = (document.getElementById("pool-search").value || "").toLowerCase();
    // sort: ERG volume desc
    var sorted = pairs.slice().sort(function (a, b) {
      return ergVol(b) - ergVol(a);
    });
    var html = "";
    var shown = 0;
    sorted.forEach(function (p, idx) {
      var label = (p.base.ticker + "/" + p.quote.ticker).toLowerCase();
      if (q && label.indexOf(q) < 0) return;
      shown++;
      var price = p.lastPrice != null ? Number(p.lastPrice).toPrecision(6) : "—";
      var vol = ergVol(p);
      var reservesCell;
      if (p.reserves) {
        reservesCell =
          '<span class="num">' + fmtUsd(p.reserves.erg.human) + " ERG</span> + " +
          '<span class="num">' + fmtUsd(p.reserves.token.human) + " " + AstroApp.esc(AstroApp.tokenLabel(p.reserves.token.tokenId)) + "</span> " +
          '<span class="pill estimated">estimated</span>';
      } else {
        reservesCell = '<span style="color:var(--faint)">n/a — not published</span>';
      }
      var rowId = "pr" + idx;
      html += '<tr class="row-main" data-row="' + rowId + '">' +
        '<td><span class="ticker">' + AstroApp.esc(p.base.ticker) + "/" + AstroApp.esc(p.quote.ticker) + "</span></td>" +
        '<td class="num">' + price + ' <span style="color:var(--faint);font-size:0.72rem">' + AstroApp.esc(p.quote.ticker) + " per " + AstroApp.esc(p.base.ticker) + "</span></td>" +
        '<td class="num">' + fmtUsd(vol) + ' <span style="color:var(--faint);font-size:0.72rem">ERG</span></td>' +
        '<td>' + reservesCell + "</td>" +
        '<td><button class="btn small" disabled title="Phase 2: adding liquidity needs the on-chain contracts (fork of the CC0 Spectrum contracts + testnet shakedown + community review). Not available in v1.">+ Add <span class="pill phase2">P2</span></button> ' +
        '<button class="btn small ghost" disabled title="Phase 2: removing liquidity needs the on-chain contracts. Not available in v1.">− Remove <span class="pill phase2">P2</span></button></td>' +
        "</tr>";
      html += '<tr class="detail" id="' + rowId + '" style="display:none"><td colspan="5">' +
        detailHtml(p) + "</td></tr>";
    });
    document.querySelector("#pools-table tbody").innerHTML = html ||
      '<tr><td colspan="5" style="color:var(--faint)">No pairs match.</td></tr>';
    document.getElementById("pool-count").textContent = shown;
    AstroApp.$all("tr.row-main").forEach(function (tr) {
      tr.addEventListener("click", function (e) {
        if (e.target.tagName === "BUTTON") return;
        var d = document.getElementById(tr.getAttribute("data-row"));
        d.style.display = d.style.display === "none" ? "" : "none";
      });
    });
    AstroApp.bindCopyButtons();
  }

  // rough ERG-denominated volume for sorting
  function ergVol(p) {
    var q = p.quote, b = p.base, price = p.lastPrice;
    var bv = p.volume.base, qv = p.volume.quote;
    var e = 0;
    if (b.tokenId === AELib.ERG_ID) e += bv;
    else if (q.tokenId === AELib.ERG_ID && price) e += bv * price;
    if (q.tokenId === AELib.ERG_ID) e += qv;
    else if (b.tokenId === AELib.ERG_ID && price) e += qv / price;
    return e;
  }

  function detailHtml(p) {
    var g = '<div class="detail-grid">';
    g += d("Market id", '<span class="tid">' + AstroApp.esc(p.id) + '</span> <button class="copy-btn" data-copy="' + AstroApp.esc(p.id) + '" data-copy-label="Market ID">copy</button>');
    g += d("Base", AstroApp.esc(p.base.ticker) + ' <span class="tid">' + AstroApp.esc(AELib.truncateId(p.base.tokenId)) + "</span>");
    g += d("Quote", AstroApp.esc(p.quote.ticker) + ' <span class="tid">' + AstroApp.esc(AELib.truncateId(p.quote.tokenId)) + "</span>");
    g += d("Reported volume", fmtUsd(p.volume.base) + " " + AstroApp.esc(p.base.ticker) + " + " + fmtUsd(p.volume.quote) + " " + AstroApp.esc(p.quote.ticker) + " <span class='fee-note'>(" + AstroApp.esc(p.volume.window) + ")</span>");
    if (p.reserves) {
      g += d("Estimated reserves", fmtUsd(p.reserves.erg.human) + " ERG / " + fmtUsd(p.reserves.token.human) + " " + AstroApp.esc(AstroApp.tokenLabel(p.reserves.token.tokenId)));
      g += d("Estimation method", AstroApp.esc(p.reserves.method));
    } else {
      g += d("Reserves", "Not published by the API for this pair — quotes route via ERG.");
    }
    g += d("Liquidity actions", "Disabled in v1. On-chain add/remove ships in Phase 2 with the contract fork + testnet shakedown.");
    return g + "</div>";
  }

  function d(k, v) {
    return '<div><div class="k">' + k + '</div><div class="val">' + v + "</div></div>";
  }

  document.addEventListener("DOMContentLoaded", function () {
    AstroApp.initData(function (state) {
      render(state.pairs);
      document.getElementById("pool-search").addEventListener("input", function () {
        render(state.pairs);
      });
    });
  });
})();
