/* Airlock swap previews. No transaction building, signing, or submission. */
(function () {
  "use strict";
  var A = AstroApp,
    ERG = AELib.ERG_ID,
    inToken = ERG,
    outToken = null,
    tokens = [],
    quote = null,
    slippage = 50,
    pendingSlip = 50,
    selecting = "out",
    initialized = false;
  function el(id) {
    return document.getElementById(id);
  }
  function fmt(raw, id) {
    return AELib.formatAmount(raw, A.tokenDecimals(id));
  }
  function rawText(raw, id) {
    return fmt(raw, id).replace(/,/g, "");
  }
  function setTokenButton(id, token) {
    el(id).innerHTML =
      A.tokenAvatar(token) +
      '<span class="token-symbol">' +
      A.esc(A.tokenLabel(token)) +
      "</span>" +
      A.icon("chevron");
    el(id).title =
      A.tokenName(token) + " · " + (token === ERG ? "Native ERG" : token);
  }
  function getTokens() {
    var ids = new Set([ERG]);
    A.state.pairs.forEach(function (p) {
      if (
        p.reserves &&
        Number(p.reserves.erg.human) > 0 &&
        Number(p.reserves.token.human) > 0
      )
        ids.add(p.reserves.token.tokenId);
    });
    return Array.from(ids)
      .map(function (id) {
        return {
          tokenId: id,
          ticker: A.tokenLabel(id),
          name: A.tokenName(id),
          vol:
            id === ERG
              ? Infinity
              : A.state.pairs.reduce(function (s, p) {
                  return (
                    s +
                    (p.base.tokenId === id || p.quote.tokenId === id
                      ? A.ergVolume(p)
                      : 0)
                  );
                }, 0),
        };
      })
      .sort(function (a, b) {
        return b.vol - a.vol || a.ticker.localeCompare(b.ticker);
      });
  }
  function reserves(inId, outId) {
    if (inId === ERG || outId === ERG) {
      var found = AELib.findErgPair(A.state.pairs, inId === ERG ? outId : inId);
      if (!found) return null;
      var r = found.pair.reserves;
      return {
        route: "direct",
        reserveInRaw: BigInt(inId === ERG ? r.erg.raw : r.token.raw),
        reserveOutRaw: BigInt(inId === ERG ? r.token.raw : r.erg.raw),
      };
    }
    var first = AELib.findErgPair(A.state.pairs, inId),
      second = AELib.findErgPair(A.state.pairs, outId);
    if (!first || !second) return null;
    return {
      route: "via-erg",
      leg1: {
        reserveInRaw: BigInt(first.pair.reserves.token.raw),
        reserveOutRaw: BigInt(first.pair.reserves.erg.raw),
      },
      leg2: {
        reserveInRaw: BigInt(second.pair.reserves.erg.raw),
        reserveOutRaw: BigInt(second.pair.reserves.token.raw),
      },
    };
  }
  function row(label, value, cls) {
    return (
      '<div class="quote-line"><span>' +
      A.esc(label) +
      '</span><span class="v ' +
      (cls || "") +
      '">' +
      A.esc(value) +
      "</span></div>"
    );
  }
  function routeLabel() {
    return (
      A.tokenLabel(inToken) +
      (quote.res.route === "via-erg" ? " → ERG → " : " → ") +
      A.tokenLabel(outToken)
    );
  }
  function feeLabel(q, res) {
    return (
      fmt(q.poolFeeRaw, inToken) +
      " " +
      A.tokenLabel(inToken) +
      (res.route === "via-erg"
        ? " + " + fmt(q.legs[1].poolFeeRaw, ERG) + " ERG"
        : "")
    );
  }
  function detailRows() {
    var q = quote.q,
      impact = Number(q.priceImpactBps) / 100;
    return (
      row(
        "Minimum received",
        fmt(AELib.applySlippage(q.amountOutRaw, slippage), outToken) +
          " " +
          A.tokenLabel(outToken),
      ) +
      row(
        "Price impact · estimated",
        impact.toFixed(2) + "%",
        impact > 5 ? "bad" : impact > 1 ? "warn" : "",
      ) +
      row("Pool fee · 0.5% per leg", feeLabel(q, quote.res)) +
      row(
        "Protocol fee · 0.25%",
        fmt(q.protocolFeeRaw, inToken) + " " + A.tokenLabel(inToken),
      ) +
      row("Slippage tolerance", slippage / 100 + "%") +
      '<p class="fee-note">Fees are modeled in the estimate. Nothing is collected.</p><div class="route-note">' +
      A.esc(routeLabel()) +
      "</div>"
    );
  }
  function message(text, button, error) {
    el("quote-message").textContent = text;
    el("quote-message").classList.toggle("error", !!error);
    el("preview-btn").textContent = button || "Enter an amount";
  }
  function recompute() {
    quote = null;
    el("preview-btn").disabled = true;
    el("quote-details").hidden = true;
    el("out-amount").textContent = "0";
    el("out-amount").classList.add("empty");
    el("out-amount").style.fontSize = "";
    el("quote-box").innerHTML = "";
    if (!outToken || !A.state.pairs.length) {
      message(
        "Market data is unavailable. Use the refresh button to try again.",
        "Data unavailable",
        true,
      );
      return;
    }
    setTokenButton("in-token-btn", inToken);
    setTokenButton("out-token-btn", outToken);
    el("in-meta").textContent = A.tokenName(inToken);
    el("out-meta").textContent = A.tokenName(outToken);
    var wallet = A.state.wallet;
    el("in-balance").textContent =
      inToken === ERG && wallet
        ? "Balance: " + fmt(wallet.ergBalanceRaw, ERG)
        : "Ergo network";
    el("try-amount").textContent =
      inToken === ERG && wallet ? "Max" : "Try 10 " + A.tokenLabel(inToken);
    var value = el("in-amount").value.trim().replace(/,/g, "");
    if (!value) {
      message("Enter an amount to explore your quote.");
      return;
    }
    if (inToken === outToken) {
      message("Choose two different tokens.", "Choose tokens", true);
      return;
    }
    try {
      if (!/^\d*(\.\d*)?$/.test(value) || value === ".")
        throw new Error(
          "Enter a valid amount using numbers and a decimal point.",
        );
      var decimals = A.tokenDecimals(inToken),
        fraction = value.split(".")[1] || "";
      if (/[1-9]/.test(fraction.slice(decimals)))
        throw new Error(
          decimals
            ? "This token supports up to " + decimals + " decimal places."
            : "This token uses whole numbers. Enter an integer.",
        );
      var amount = AELib.parseAmount(value, decimals);
      if (amount <= 0n) {
        message("Enter an amount greater than zero.");
        return;
      }
      var res = reserves(inToken, outToken);
      if (!res) {
        message(
          "No available ERG route for these tokens.",
          "No route available",
          true,
        );
        return;
      }
      var q =
        res.route === "direct"
          ? AELib.quoteExactIn(amount, res.reserveInRaw, res.reserveOutRaw)
          : AELib.quoteTwoLeg(amount, res.leg1, res.leg2);
      if (q.amountOutRaw <= 0n) {
        message(
          "Amount is too small to receive one unit of this token.",
          "Increase amount",
          true,
        );
        return;
      }
      quote = { q: q, res: res, amount: amount };
      var formatted = fmt(q.amountOutRaw, outToken);
      el("out-amount").textContent = formatted;
      el("out-amount").title = formatted + " " + A.tokenLabel(outToken);
      el("out-amount").classList.remove("empty");
      if (formatted.length > 9)
        el("out-amount").style.fontSize =
          formatted.length > 14 ? "22px" : "30px";
      var rate =
        Number(q.amountOutRaw) /
        Math.pow(10, A.tokenDecimals(outToken)) /
        (Number(amount) / Math.pow(10, decimals));
      el("quote-rate").textContent =
        "1 " +
        A.tokenLabel(inToken) +
        " ≈ " +
        A.compact(rate) +
        " " +
        A.tokenLabel(outToken);
      el("quote-details").hidden = false;
      el("quote-box").innerHTML = detailRows();
      el("preview-btn").disabled = false;
      el("preview-btn").textContent = "Preview swap";
      el("quote-message").textContent =
        Number(q.priceImpactBps) > 500
          ? "High estimated price impact. Review the details before proceeding."
          : "";
      el("quote-message").classList.toggle(
        "error",
        Number(q.priceImpactBps) > 500,
      );
    } catch (e) {
      message(
        e.message === "amount too small for this route"
          ? "Amount is too small for the route. Try a larger amount."
          : e.message,
        "Check amount",
        true,
      );
    }
  }
  function renderSelector() {
    var search = el("token-query").value.trim().toLowerCase(),
      current = selecting === "in" ? inToken : outToken;
    var list = tokens.filter(function (t) {
      return (t.ticker + " " + t.name + " " + t.tokenId)
        .toLowerCase()
        .includes(search);
    });
    el("selector-count").textContent = list.length;
    el("token-list").innerHTML = list.length
      ? list
          .map(function (t) {
            return (
              '<button class="token-option ' +
              (t.tokenId === current ? "current" : "") +
              '" data-select-token="' +
              t.tokenId +
              '" title="' +
              A.esc(t.tokenId) +
              '">' +
              A.tokenAvatar(t.tokenId) +
              '<span class="token-names"><strong>' +
              A.esc(t.ticker) +
              "</strong><small>" +
              A.esc(t.name) +
              '</small><small class="tid">' +
              (t.tokenId === ERG
                ? "Native ERG"
                : A.esc(AELib.truncateId(t.tokenId, 8))) +
              "</small></span><span>" +
              (t.tokenId === current ? A.icon("check") : "EIP-4") +
              "</span></button>"
            );
          })
          .join("")
      : '<div class="empty-state"><strong>No tokens found</strong>Try a name or the full 64-character token ID.</div>';
  }
  function selectToken(id) {
    if (
      !tokens.some(function (t) {
        return t.tokenId === id;
      })
    )
      return;
    if (selecting === "in") {
      if (id === outToken) outToken = inToken;
      inToken = id;
    } else {
      if (id === inToken) inToken = outToken;
      outToken = id;
    }
    A.closeDialog(el("token-modal"));
    recompute();
  }
  function openSelector(which) {
    selecting = which;
    el("token-query").value = "";
    renderSelector();
    A.openDialog("token-modal");
    el("token-query").focus();
  }
  function renderQuickTokens() {
    var quick = [ERG];
    ["SigUSD", "RSN", "SigRSV"].forEach(function (tick) {
      var t = tokens.find(function (t) {
        return t.ticker === tick;
      });
      if (t) quick.push(t.tokenId);
    });
    el("quick-tokens").innerHTML = quick
      .map(function (id) {
        return (
          '<button class="quick-token" data-select-token="' +
          id +
          '">' +
          A.tokenAvatar(id) +
          A.esc(A.tokenLabel(id)) +
          "</button>"
        );
      })
      .join("");
  }
  function renderSpotlights() {
    var selected = ["SigUSD", "RSN", "SigRSV"]
      .map(function (tick) {
        return tokens.find(function (t) {
          return t.ticker === tick;
        });
      })
      .filter(Boolean);
    el("market-cards").innerHTML = selected.length
      ? selected
          .map(function (t) {
            return (
              '<button class="market-card" data-market-token="' +
              t.tokenId +
              '" aria-label="Preview ERG to ' +
              A.esc(t.ticker) +
              '"><span class="market-card-head">' +
              A.tokenAvatar(t.tokenId) +
              "<span><strong>" +
              A.esc(t.ticker) +
              "</strong><small>" +
              A.esc(A.tokenName(t.tokenId)) +
              "</small></span>" +
              A.icon("arrow") +
              '</span><span class="market-card-bottom"><strong>' +
              A.compact(A.priceVsErg(t.tokenId)) +
              " <small>ERG</small></strong><small>Spot price</small></span></button>"
            );
          })
          .join("")
      : '<div class="empty-state">Market highlights will appear when data is available.</div>';
  }
  function preview() {
    if (!quote) return;
    el("pv-in").textContent =
      fmt(quote.amount, inToken) + " " + A.tokenLabel(inToken);
    el("pv-out").textContent =
      fmt(quote.q.amountOutRaw, outToken) + " " + A.tokenLabel(outToken);
    el("pv-rows").innerHTML =
      detailRows() + row("Data source", el("src-badge").textContent);
    A.openDialog("preview-modal");
  }
  function settings() {
    pendingSlip = slippage;
    el("custom-slip").value = [10, 50, 100].includes(slippage)
      ? ""
      : slippage / 100;
    renderSlippage();
    A.openDialog("settings-modal");
  }
  function renderSlippage() {
    var valid =
      Number.isInteger(pendingSlip) && pendingSlip >= 1 && pendingSlip < 5000;
    A.$all(".slip-btn").forEach(function (b) {
      var on = Number(b.dataset.slip) === pendingSlip;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    });
    el("save-settings").disabled = !valid;
    el("slip-feedback").classList.toggle("warn", !valid || pendingSlip > 500);
    el("slip-feedback").textContent = !valid
      ? "Enter a value from 0.01% to 49.99%, with at most two decimal places."
      : pendingSlip > 500
        ? "High slippage tolerance greatly reduces your minimum received."
        : "A " +
          pendingSlip / 100 +
          "% tolerance is applied to the estimated output.";
  }
  document.addEventListener("DOMContentLoaded", function () {
    try {
      var saved = Number(localStorage.getItem("airlock-slippage"));
      if (Number.isInteger(saved) && saved > 0 && saved < 5000)
        slippage = saved;
    } catch (_) {}
    el("slippage-label").textContent = slippage / 100 + "%";
    el("in-token-btn").onclick = function () {
      openSelector("in");
    };
    el("out-token-btn").onclick = function () {
      openSelector("out");
    };
    el("in-amount").addEventListener("input", recompute);
    el("flip").onclick = function () {
      var tmp = inToken;
      inToken = outToken;
      outToken = tmp;
      recompute();
    };
    el("try-amount").onclick = function () {
      el("in-amount").value =
        inToken === ERG && A.state.wallet
          ? rawText(A.state.wallet.ergBalanceRaw, ERG)
          : "10";
      recompute();
      el("in-amount").focus();
    };
    el("token-query").addEventListener("input", renderSelector);
    el("token-modal").addEventListener("click", function (e) {
      var b = e.target.closest("[data-select-token]");
      if (b) selectToken(b.dataset.selectToken);
    });
    el("market-cards").addEventListener("click", function (e) {
      var b = e.target.closest("[data-market-token]");
      if (!b) return;
      inToken = ERG;
      outToken = b.dataset.marketToken;
      recompute();
      el("in-amount").focus();
      window.scrollTo({
        top: 0,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
    });
    el("preview-btn").onclick = preview;
    el("settings-btn").onclick = settings;
    el("slippage-open").onclick = settings;
    A.$all(".slip-btn").forEach(function (b) {
      b.onclick = function () {
        pendingSlip = Number(b.dataset.slip);
        el("custom-slip").value = "";
        renderSlippage();
      };
    });
    el("custom-slip").addEventListener("input", function () {
      var v = el("custom-slip").value.trim();
      pendingSlip = /^(?:\d+|\d*\.\d{1,2})$/.test(v)
        ? Math.round(Number(v) * 100)
        : NaN;
      renderSlippage();
    });
    el("save-settings").onclick = function () {
      if (el("save-settings").disabled) return;
      slippage = pendingSlip;
      try {
        localStorage.setItem("airlock-slippage", String(slippage));
      } catch (_) {}
      el("slippage-label").textContent = slippage / 100 + "%";
      A.closeDialog(el("settings-modal"));
      recompute();
    };
    document.addEventListener("walletchange", recompute);
    A.initData(function () {
      if (el("preview-modal").open) {
        A.closeDialog(el("preview-modal"));
        A.toast("Market data changed. Please review your updated quote.");
      }
      tokens = getTokens();
      if (!initialized && A.state.pairs.length) {
        initialized = true;
        var sig = tokens.find(function (t) {
          return t.ticker === "SigUSD";
        });
        outToken = sig ? sig.tokenId : (tokens[1] || tokens[0]).tokenId;
        var params = new URLSearchParams(location.search);
        var from = params.get("from"),
          to = params.get("to");
        if (
          tokens.some(function (t) {
            return t.tokenId === from;
          })
        )
          inToken = from;
        if (
          tokens.some(function (t) {
            return t.tokenId === to;
          })
        )
          outToken = to;
        if (inToken === outToken) {
          inToken = ERG;
          if (outToken === ERG) outToken = (tokens[1] || tokens[0]).tokenId;
        }
      }
      ["in-token-btn", "out-token-btn", "flip"].forEach(function (id) {
        el(id).disabled = tokens.length < 2;
      });
      el("try-amount").disabled = tokens.length < 2;
      renderQuickTokens();
      renderSpotlights();
      recompute();
      if (el("token-modal").open) renderSelector();
    });
  });
})();
