/* ============================================================
   Airlock tokens page — js/tokens.js (v0.2.0)
   Token directory: metadata from baked data/tokens.json, prices derived
   from the loaded pairs (live when available, else snapshot).
   ============================================================ */
(function () {
  "use strict";

  // price of token in ERG, from any ERG pair
  function priceVsErg(pairs, tokenId) {
    if (tokenId === AELib.ERG_ID) return 1;
    for (var i = 0; i < pairs.length; i++) {
      var p = pairs[i], price = p.lastPrice;
      if (!price || price <= 0) continue;
      if (p.base.tokenId === tokenId && p.quote.tokenId === AELib.ERG_ID) return price;       // ERG per base
      if (p.quote.tokenId === tokenId && p.base.tokenId === AELib.ERG_ID) return 1 / price;   // ERG per quote
    }
    return null;
  }

  function ergVolume(pairs, tokenId) {
    var v = 0;
    pairs.forEach(function (p) {
      var price = p.lastPrice;
      if (p.base.tokenId === tokenId) {
        v += (p.quote.tokenId === AELib.ERG_ID && price) ? p.volume.base * price : 0;
      }
      if (p.quote.tokenId === tokenId) {
        v += (p.base.tokenId === AELib.ERG_ID && price) ? p.volume.quote / price : 0;
      }
    });
    return v;
  }

  function fmtN(n) {
    if (n == null || !isFinite(n)) return "—";
    if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
    if (n >= 1) return n.toFixed(2);
    return n.toPrecision(3);
  }

  function render(state) {
    var q = (document.getElementById("token-search").value || "").toLowerCase();
    var metas = Object.keys(state.tokenMeta).map(function (id) { return state.tokenMeta[id]; });
    // include any pair tokens missing from metadata
    var seen = {};
    metas.forEach(function (m) { seen[m.tokenId] = true; });
    state.pairs.forEach(function (p) {
      [p.base, p.quote].forEach(function (a) {
        if (!seen[a.tokenId]) {
          seen[a.tokenId] = true;
          metas.push({ tokenId: a.tokenId, ticker: a.ticker, name: a.ticker, decimals: a.decimals, description: "" });
        }
      });
    });

    var rows = metas.map(function (m) {
      return {
        meta: m,
        price: priceVsErg(state.pairs, m.tokenId),
        vol: ergVolume(state.pairs, m.tokenId),
      };
    }).filter(function (r) {
      if (!q) return true;
      return (r.meta.ticker + " " + r.meta.name + " " + r.meta.tokenId).toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) { return b.vol - a.vol; });

    var html = "";
    rows.forEach(function (r) {
      var m = r.meta;
      var isErg = m.tokenId === AELib.ERG_ID;
      var explorer = isErg
        ? "https://explorer.ergoplatform.com/"
        : "https://explorer.ergoplatform.com/en/token/" + m.tokenId;
      html += "<tr>" +
        '<td><span class="ticker">' + AstroApp.esc(m.ticker) + '</span><br><span style="color:var(--faint);font-size:0.76rem">' + AstroApp.esc(m.name || "") + "</span></td>" +
        '<td><span class="tid">' + AstroApp.esc(isErg ? "native (64 zeros)" : AELib.truncateId(m.tokenId)) + "</span>" +
        (isErg ? "" : ' <button class="copy-btn" data-copy="' + AstroApp.esc(m.tokenId) + '" data-copy-label="Token ID">copy</button>') + "</td>" +
        '<td class="num">' + m.decimals + "</td>" +
        '<td class="num">' + (r.price == null ? "—" : r.price < 0.01 ? r.price.toExponential(2) : r.price.toFixed(4)) + "</td>" +
        '<td class="num">' + fmtN(r.vol) + "</td>" +
        '<td><a href="' + explorer + '" target="_blank" rel="noopener">explorer ↗</a></td>' +
        "</tr>";
    });
    document.querySelector("#tokens-table tbody").innerHTML = html ||
      '<tr><td colspan="6" style="color:var(--faint)">No tokens match.</td></tr>';
    document.getElementById("token-count").textContent = rows.length;
    AstroApp.bindCopyButtons();
  }

  document.addEventListener("DOMContentLoaded", function () {
    AstroApp.initData(function (state) {
      render(state);
      document.getElementById("token-search").addEventListener("input", function () {
        render(state);
      });
    });
  });
})();
