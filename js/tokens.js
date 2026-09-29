/* Token directory with full-ID search, explorer links and quote deep links. */
(function () {
  "use strict";
  var A = AstroApp,
    page = 0,
    pageSize = 15,
    filter = "all";
  function el(id) {
    return document.getElementById(id);
  }
  function render() {
    A.renderStats();
    var q = el("token-search").value.trim().toLowerCase(),
      sort = el("sort-by").value;
    var rows = A.allTokens()
      .map(function (t) {
        return {
          meta: t,
          price: A.priceVsErg(t.tokenId),
          quotable:
            t.tokenId === AELib.ERG_ID ||
            !!AELib.findErgPair(A.state.pairs, t.tokenId),
          volume: A.state.pairs.reduce(function (v, p) {
            return (
              v +
              (p.base.tokenId === t.tokenId || p.quote.tokenId === t.tokenId
                ? A.ergVolume(p)
                : 0)
            );
          }, 0),
        };
      })
      .filter(function (r) {
        return (
          (filter !== "quotable" || r.quotable) &&
          (!q ||
            (
              A.tokenLabel(r.meta.tokenId) +
              " " +
              A.tokenName(r.meta.tokenId) +
              " " +
              r.meta.tokenId
            )
              .toLowerCase()
              .includes(q))
        );
      });
    rows.sort(function (a, b) {
      if (sort === "name")
        return A.tokenLabel(a.meta.tokenId).localeCompare(
          A.tokenLabel(b.meta.tokenId),
        );
      if (sort === "price") return (b.price || 0) - (a.price || 0);
      return b.volume - a.volume;
    });
    var pages = Math.max(1, Math.ceil(rows.length / pageSize));
    page = Math.min(page, pages - 1);
    var start = page * pageSize,
      slice = rows.slice(start, start + pageSize);
    el("token-count").textContent = rows.length.toLocaleString();
    el("tokens-table").querySelector("tbody").innerHTML = slice.length
      ? slice
          .map(function (r) {
            var t = r.meta,
              id = t.tokenId,
              isErg = id === AELib.ERG_ID,
              explorer = isErg
                ? "https://explorer.ergoplatform.com/"
                : "https://explorer.ergoplatform.com/en/token/" + id;
            return (
              '<tr><td><div class="asset-cell">' +
              A.tokenAvatar(id) +
              "<span><strong>" +
              A.esc(A.tokenLabel(id)) +
              "</strong><small>" +
              A.esc(A.tokenName(id)) +
              "</small></span></div></td><td>" +
              A.compact(r.price) +
              "</td><td>" +
              (r.volume ? A.compact(r.volume) : "—") +
              '</td><td><span class="tid" title="' +
              id +
              '">' +
              (isErg ? "Native ERG" : AELib.truncateId(id, 6)) +
              "</span> " +
              (!isErg
                ? '<button class="copy-btn" data-copy="' +
                  id +
                  '" data-copy-label="Token ID" aria-label="Copy ' +
                  A.esc(A.tokenLabel(id)) +
                  ' token ID">' +
                  A.icon("copy") +
                  "</button>"
                : "") +
              '<span class="cell-note">' +
              A.tokenDecimals(id) +
              " decimals</span></td><td>" +
              (r.quotable
                ? '<a class="quote-link" href="index.html?from=' +
                  id +
                  (isErg ? "" : "&amp;to=" + AELib.ERG_ID) +
                  '">Preview</a> &nbsp; '
                : "") +
              '<a class="quote-link" href="' +
              explorer +
              '" target="_blank" rel="noopener noreferrer" aria-label="View ' +
              A.esc(A.tokenLabel(id)) +
              ' on Ergo explorer">' +
              A.icon("external") +
              "</a></td></tr>"
            );
          })
          .join("")
      : '<tr><td colspan="5"><div class="empty-state"><strong>No matching tokens</strong>Try a different name or paste the full token ID.</div></td></tr>';
    el("page-info").textContent = rows.length
      ? start +
        1 +
        "–" +
        Math.min(start + pageSize, rows.length) +
        " of " +
        rows.length +
        " tokens"
      : "0 tokens";
    el("prev-page").disabled = page === 0;
    el("next-page").disabled = page >= pages - 1;
    A.bindCopyButtons();
  }
  document.addEventListener("DOMContentLoaded", function () {
    el("token-search").oninput = function () {
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
