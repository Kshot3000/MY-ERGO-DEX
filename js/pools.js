/* Searchable and paginated market browser. All reserves are estimates. */
(function () {
  "use strict";
  var A = AstroApp,
    page = 0,
    pageSize = 15,
    filter = "all",
    expanded = new Set();
  function el(id) {
    return document.getElementById(id);
  }
  function copy(id) {
    return (
      '<button class="copy-btn" data-copy="' +
      A.esc(id) +
      '" data-copy-label="Token ID" aria-label="Copy token ID">' +
      A.icon("copy") +
      "</button>"
    );
  }
  function detail(p) {
    function field(k, v) {
      return (
        '<div><div class="k">' +
        A.esc(k) +
        '</div><div class="val">' +
        v +
        "</div></div>"
      );
    }
    return (
      '<div class="detail-grid">' +
      field(
        "Base token",
        A.esc(A.tokenLabel(p.base.tokenId)) +
          " · " +
          p.base.decimals +
          ' decimals<br><span class="tid">' +
          A.esc(p.base.tokenId) +
          "</span>" +
          copy(p.base.tokenId),
      ) +
      field(
        "Quote token",
        A.esc(A.tokenLabel(p.quote.tokenId)) +
          " · " +
          p.quote.decimals +
          ' decimals<br><span class="tid">' +
          A.esc(p.quote.tokenId) +
          "</span>" +
          copy(p.quote.tokenId),
      ) +
      field(
        "Reported volume",
        A.compact(p.volume.base) +
          " " +
          A.esc(p.base.ticker) +
          " / " +
          A.compact(p.volume.quote) +
          " " +
          A.esc(p.quote.ticker) +
          '<br><span class="cell-note">The provider does not specify a time window.</span>',
      ) +
      field(
        "Liquidity actions",
        "Adding and removing liquidity are not available in v1.",
      ) +
      '<div class="full-span"><div class="k">Reserve methodology</div><div class="val">' +
      A.esc(
        p.reserves
          ? p.reserves.method
          : "Pool reserves are not published for this market. Quotes may route through ERG when both legs are available.",
      ) +
      "</div></div></div>"
    );
  }
  function render() {
    A.renderStats();
    var q = el("pool-search").value.trim().toLowerCase(),
      sort = el("sort-by").value;
    var pairs = A.state.pairs
      .filter(function (p) {
        return (
          (filter !== "erg" ||
            p.base.tokenId === AELib.ERG_ID ||
            p.quote.tokenId === AELib.ERG_ID) &&
          (!q ||
            (
              p.base.ticker +
              " " +
              p.quote.ticker +
              " " +
              p.base.tokenId +
              " " +
              p.quote.tokenId
            )
              .toLowerCase()
              .includes(q))
        );
      })
      .slice();
    pairs.sort(function (a, b) {
      if (sort === "name")
        return (a.base.ticker + "/" + a.quote.ticker).localeCompare(
          b.base.ticker + "/" + b.quote.ticker,
        );
      if (sort === "price") return b.lastPrice - a.lastPrice;
      return A.ergVolume(b) - A.ergVolume(a);
    });
    var pages = Math.max(1, Math.ceil(pairs.length / pageSize));
    page = Math.min(page, pages - 1);
    var start = page * pageSize,
      slice = pairs.slice(start, start + pageSize);
    el("pool-count").textContent = pairs.length.toLocaleString();
    el("pools-table").querySelector("tbody").innerHTML = slice.length
      ? slice
          .map(function (p, i) {
            var idx = start + i,
              key = p.id,
              open = expanded.has(key),
              base = p.base.tokenId,
              quote = p.quote.tokenId,
              vol = A.ergVolume(p),
              canQuote =
                (base === AELib.ERG_ID ||
                  AELib.findErgPair(A.state.pairs, base)) &&
                (quote === AELib.ERG_ID ||
                  AELib.findErgPair(A.state.pairs, quote));
            return (
              '<tr class="row-main" aria-expanded="' +
              open +
              '"><td><div class="asset-cell"><span class="token-pair-icons">' +
              A.tokenAvatar(base) +
              A.tokenAvatar(quote) +
              '</span><button class="pair-name" data-expand="' +
              A.esc(key) +
              '" aria-expanded="' +
              open +
              '" aria-controls="pool-detail-' +
              idx +
              '">' +
              A.esc(p.base.ticker) +
              " / " +
              A.esc(p.quote.ticker) +
              A.icon("chevron") +
              "</button></div></td><td>" +
              A.compact(p.lastPrice) +
              '<span class="cell-note">' +
              A.esc(p.quote.ticker) +
              " per " +
              A.esc(p.base.ticker) +
              "</span></td><td>" +
              (vol ? A.compact(vol) + " ERG" : "—") +
              '<span class="cell-note">' +
              (vol ? "Reported" : "No ERG volume") +
              "</span></td><td>" +
              (p.reserves
                ? A.compact(p.reserves.erg.human) +
                  ' ERG<span class="cell-note">+ ' +
                  A.compact(p.reserves.token.human) +
                  " " +
                  A.esc(A.tokenLabel(p.reserves.token.tokenId)) +
                  " · estimated</span>"
                : '<span class="muted">Not published</span>') +
              "</td><td>" +
              (canQuote
                ? '<a class="quote-link" href="index.html?from=' +
                  base +
                  "&amp;to=" +
                  quote +
                  '">Preview</a>'
                : '<span class="cell-note">No quote route</span>') +
              '</td></tr><tr class="detail" id="pool-detail-' +
              idx +
              '" ' +
              (open ? "" : "hidden") +
              '><td colspan="5">' +
              detail(p) +
              "</td></tr>"
            );
          })
          .join("")
      : '<tr><td colspan="5"><div class="empty-state"><strong>' +
        (!A.state.pairs.length
          ? "Market data unavailable"
          : "No matching markets") +
        "</strong>" +
        (!A.state.pairs.length
          ? "Refresh the data to try again."
          : "Try another token name or clear your search.") +
        "</div></td></tr>";
    el("page-info").textContent = pairs.length
      ? start +
        1 +
        "–" +
        Math.min(start + pageSize, pairs.length) +
        " of " +
        pairs.length +
        " markets"
      : "0 markets";
    el("prev-page").disabled = page === 0;
    el("next-page").disabled = page >= pages - 1;
    A.bindCopyButtons();
    A.$all("[data-expand]").forEach(function (b) {
      b.onclick = function () {
        var key = b.dataset.expand,
          open = !expanded.has(key);
        if (open) expanded.add(key);
        else expanded.delete(key);
        b.setAttribute("aria-expanded", String(open));
        b.closest("tr").setAttribute("aria-expanded", String(open));
        el(b.getAttribute("aria-controls")).hidden = !open;
      };
    });
  }
  document.addEventListener("DOMContentLoaded", function () {
    el("pool-search").oninput = function () {
      page = 0;
      render();
    };
    el("sort-by").onchange = function () {
      page = 0;
      render();
    };
    A.$all("[data-filter]").forEach(function (b) {
      b.onclick = function () {
        filter = b.dataset.filter;
        page = 0;
        A.$all("[data-filter]").forEach(function (x) {
          var on = x === b;
          x.classList.toggle("on", on);
          x.setAttribute("aria-pressed", String(on));
        });
        render();
      };
    });
    el("prev-page").onclick = function () {
      page--;
      render();
    };
    el("next-page").onclick = function () {
      page++;
      render();
    };
    A.initData(render);
  });
})();
