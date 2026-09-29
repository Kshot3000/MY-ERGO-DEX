/* Shared Airlock app: snapshot-first data, accessible dialogs, and read-only Nautilus. */
(function () {
  "use strict";
  var FEE_WALLET = "9fcM5RWnAjmP4vx5bnW6yohB6H9bLq8sJbaPLHtwZLtQPB32Pvy";
  var MARKET_URL = "https://api.spectrum.fi/v1/price-tracking/markets";
  var state = {
    pairs: [],
    tokenMeta: {},
    dataSource: "loading",
    fetchedAt: null,
    wallet: null,
    refreshing: false,
    ready: false,
  };
  var listeners = [],
    initialized = false,
    walletPending = false;
  function $(s, r) {
    return (r || document).querySelector(s);
  }
  function $all(s, r) {
    return Array.from((r || document).querySelectorAll(s));
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[c];
    });
  }
  function icon(name) {
    var paths = {
      chevron: '<path d="m6 9 6 6 6-6"/>',
      external:
        '<path d="M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
      arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
      copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
      check: '<path d="m5 12 4 4L19 6"/>',
    };
    return (
      '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (paths[name] || paths.chevron) +
      "</svg>"
    );
  }
  function toast(msg) {
    var e = $("#toast");
    if (!e) return;
    e.textContent = msg;
    e.classList.add("show");
    clearTimeout(e._timer);
    e._timer = setTimeout(function () {
      e.classList.remove("show");
    }, 3400);
  }
  async function copyText(value, label) {
    try {
      await navigator.clipboard.writeText(value);
      toast((label || "Copied") + " copied");
    } catch (_) {
      var t = document.createElement("textarea");
      t.value = value;
      t.style.cssText = "position:fixed;opacity:0";
      (document.querySelector("dialog[open]") || document.body).appendChild(t);
      t.select();
      var ok = false;
      try {
        ok = document.execCommand("copy");
      } catch (_) {}
      t.remove();
      toast(
        ok
          ? (label || "Text") + " copied"
          : "Unable to copy. Please select the text manually.",
      );
    }
  }
  function bindCopyButtons() {
    $all("[data-copy]").forEach(function (b) {
      if (b._bound) return;
      b._bound = true;
      b.addEventListener("click", function (e) {
        e.stopPropagation();
        copyText(b.dataset.copy, b.dataset.copyLabel || "Token ID");
      });
    });
  }
  function openDialog(id) {
    var d = document.getElementById(id);
    if (!d || d.open) return;
    d._returnFocus = document.activeElement;
    d.showModal();
    document.body.style.overflow = "hidden";
  }
  function closeDialog(d) {
    if (d && d.open) d.close();
  }
  function validPair(p) {
    return (
      p &&
      p.base &&
      p.quote &&
      AELib.isValidTokenId(p.base.tokenId) &&
      AELib.isValidTokenId(p.quote.tokenId) &&
      Number.isInteger(p.base.decimals) &&
      Number.isInteger(p.quote.decimals) &&
      p.base.decimals >= 0 &&
      p.base.decimals <= 18 &&
      p.quote.decimals >= 0 &&
      p.quote.decimals <= 18 &&
      p.volume &&
      Number.isFinite(Number(p.lastPrice))
    );
  }
  function dateLabel() {
    if (!state.fetchedAt) return "time unavailable";
    var d = new Date(state.fetchedAt);
    return isNaN(d)
      ? "time unavailable"
      : new Intl.DateTimeFormat(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          timeZoneName: "short",
        }).format(d);
  }
  function setBadge() {
    var b = $("#src-badge");
    if (!b) return;
    b.className = "src-badge " + state.dataSource;
    b.textContent =
      state.dataSource === "loading"
        ? "Loading market data"
        : state.dataSource === "error"
          ? "Market data unavailable"
          : (state.dataSource === "live" ? "Live data" : "Snapshot") +
            " · " +
            dateLabel();
    b.title = state.fetchedAt
      ? "Source: " +
        (state.dataSource === "live" ? MARKET_URL : "bundled market snapshot") +
        "\nAs of " +
        state.fetchedAt
      : "No market data is available. Please try refreshing.";
  }
  function publish() {
    setBadge();
    state.ready = true;
    listeners.forEach(function (f) {
      f(state);
    });
  }
  async function fetchJSON(url, timeout) {
    var controller = new AbortController();
    var timer = setTimeout(function () {
      controller.abort();
    }, timeout || 6000);
    try {
      var r = await fetch(url, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!r.ok) throw new Error("Request failed");
      return await r.json();
    } finally {
      clearTimeout(timer);
    }
  }
  async function loadSnapshot() {
    var snap = await fetchJSON("data/markets.json");
    var pairs = (snap.pairs || []).filter(validPair);
    if (!pairs.length) throw new Error("Empty snapshot");
    state.pairs = pairs;
    state.dataSource = "snapshot";
    state.fetchedAt = snap.fetched_at || null;
  }
  async function refreshData(userInitiated) {
    if (state.refreshing) return;
    state.refreshing = true;
    $all("[data-refresh]").forEach(function (b) {
      b.disabled = true;
      b.classList.add("loading");
    });
    try {
      var raw = await fetchJSON(MARKET_URL, 4500);
      if (!Array.isArray(raw)) throw new Error("Unexpected response");
      var processed = AELib.processMarkets(raw);
      var pairs = processed.pairs.filter(validPair);
      if (!pairs.length) throw new Error("No markets");
      state.pairs = pairs;
      state.dataSource = "live";
      state.fetchedAt = processed.fetchedAt;
      publish();
      if (userInitiated) toast("Market data updated");
    } catch (_) {
      if (!state.pairs.length) {
        try {
          await loadSnapshot();
          publish();
        } catch (_) {
          state.dataSource = "error";
          publish();
        }
      }
      if (userInitiated)
        toast(
          state.pairs.length
            ? "Live feed unavailable. Keeping data from " + dateLabel() + "."
            : "Market data could not be loaded. Please try again.",
        );
    } finally {
      state.refreshing = false;
      $all("[data-refresh]").forEach(function (b) {
        b.disabled = false;
        b.classList.remove("loading");
      });
    }
  }
  function initData(callback) {
    if (callback) listeners.push(callback);
    if (state.ready && callback) callback(state);
    if (initialized) return;
    initialized = true;
    Promise.allSettled([
      fetchJSON("data/tokens.json").then(function (j) {
        (j.tokens || []).forEach(function (t) {
          if (AELib.isValidTokenId(t.tokenId)) state.tokenMeta[t.tokenId] = t;
        });
      }),
      loadSnapshot(),
    ]).then(function () {
      if (!state.pairs.length) state.dataSource = "error";
      publish();
      refreshData(false);
    });
  }
  function tokenLabel(id) {
    if (id === AELib.ERG_ID) return "ERG";
    var m = state.tokenMeta[id];
    if (m) return m.ticker || AELib.truncateId(id, 4);
    for (var p of state.pairs) {
      if (p.base.tokenId === id)
        return p.base.ticker || AELib.truncateId(id, 4);
      if (p.quote.tokenId === id)
        return p.quote.ticker || AELib.truncateId(id, 4);
    }
    return AELib.truncateId(id, 4);
  }
  function tokenDecimals(id) {
    if (id === AELib.ERG_ID) return 9;
    var m = state.tokenMeta[id];
    if (
      m &&
      Number.isInteger(m.decimals) &&
      m.decimals >= 0 &&
      m.decimals <= 18
    )
      return m.decimals;
    for (var p of state.pairs) {
      if (p.base.tokenId === id) return p.base.decimals;
      if (p.quote.tokenId === id) return p.quote.decimals;
    }
    return 0;
  }
  function tokenName(id) {
    if (id === AELib.ERG_ID) return "Ergo";
    var m = state.tokenMeta[id];
    var t = tokenLabel(id);
    if (m && m.name && m.name !== t) return m.name;
    return (
      {
        SigUSD: "SigmaUSD",
        SigRSV: "Sigma Reserve",
        RSN: "Rosen Bridge",
        rsADA: "Rosen wrapped ADA",
        rsBTC: "Rosen wrapped BTC",
      }[t] || t
    );
  }
  function tokenAvatar(id) {
    var tick = tokenLabel(id),
      special =
        id === AELib.ERG_ID
          ? "ergo"
          : /^(SigUSD|SigRSV|RSN|rsADA|rsBTC)$/.test(tick)
            ? tick.toLowerCase()
            : "";
    var mark =
      id === AELib.ERG_ID
        ? "Σ"
        : tick === "SigUSD"
          ? "$"
          : tick === "SigRSV"
            ? "R"
            : tick === "rsBTC"
              ? "₿"
              : tick.slice(0, 2).toUpperCase();
    return (
      '<span class="token-avatar ' +
      special +
      '" aria-hidden="true">' +
      esc(mark) +
      "</span>"
    );
  }
  function allTokens() {
    var map = new Map();
    Object.values(state.tokenMeta).forEach(function (t) {
      map.set(t.tokenId, t);
    });
    state.pairs.forEach(function (p) {
      [p.base, p.quote].forEach(function (t) {
        if (!map.has(t.tokenId)) map.set(t.tokenId, t);
      });
    });
    return Array.from(map.values());
  }
  function priceVsErg(id) {
    if (id === AELib.ERG_ID) return 1;
    var f = AELib.findErgPair(state.pairs, id);
    if (!f || !(f.pair.lastPrice > 0)) return null;
    return f.pair.base.tokenId === id ? f.pair.lastPrice : 1 / f.pair.lastPrice;
  }
  // Both API-side volumes can describe the same activity; use max, never sum them.
  function ergVolume(p) {
    var price = Number(p.lastPrice);
    if (!(price > 0)) return 0;
    var b = Number(p.volume.base) || 0,
      q = Number(p.volume.quote) || 0;
    if (p.base.tokenId === AELib.ERG_ID) return Math.max(b, q / price);
    if (p.quote.tokenId === AELib.ERG_ID) return Math.max(q, b * price);
    return 0;
  }
  function compact(n) {
    if (n == null || !Number.isFinite(Number(n))) return "—";
    if (n === 0) return "0";
    if (Math.abs(n) < 0.0001) return Number(n).toExponential(2);
    return new Intl.NumberFormat(undefined, {
      maximumFractionDigits: n >= 100 ? 2 : 6,
      notation: n >= 10000 ? "compact" : "standard",
    }).format(n);
  }
  function renderStats() {
    [
      ["stat-markets", state.pairs.length],
      ["stat-tokens", allTokens().length],
      [
        "stat-routes",
        state.pairs.filter(function (p) {
          return (
            !!p.reserves &&
            Number(p.reserves.erg.human) > 0 &&
            Number(p.reserves.token.human) > 0
          );
        }).length,
      ],
    ].forEach(function (v) {
      if ($("#" + v[0]))
        $("#" + v[0]).textContent = state.pairs.length
          ? v[1].toLocaleString()
          : "—";
    });
  }
  function walletApi() {
    return (window.ergoConnector && window.ergoConnector.nautilus) || null;
  }
  function renderWallet() {
    var btn = $("#wallet-btn"),
      content = $("#wallet-content");
    if (btn)
      btn.textContent = state.wallet
        ? AELib.truncateId(state.wallet.address, 5)
        : "Connect wallet";
    if (!content) return;
    if (state.wallet) {
      $("#wallet-title").textContent = "Your wallet";
      content.innerHTML =
        '<div class="wallet-info"><span class="muted">Nautilus · Read-only</span><strong>' +
        esc(AELib.formatAmount(state.wallet.ergBalanceRaw, 9)) +
        " ERG</strong><code>" +
        esc(state.wallet.address) +
        '</code></div><div class="wallet-actions"><button class="btn secondary" id="copy-wallet">Copy address</button><button class="btn secondary" id="disconnect-wallet">Disconnect</button></div>';
      $("#copy-wallet").onclick = function () {
        copyText(state.wallet.address, "Wallet address");
      };
      $("#disconnect-wallet").onclick = async function () {
        var b = $("#disconnect-wallet");
        b.disabled = true;
        try {
          var api = walletApi();
          if (api && api.disconnect) await api.disconnect();
          state.wallet = null;
          renderWallet();
          document.dispatchEvent(new Event("walletchange"));
          toast("Wallet disconnected");
        } catch (_) {
          b.disabled = false;
          toast(
            "Could not disconnect. Try again or revoke access in Nautilus.",
          );
        }
      };
    } else {
      $("#wallet-title").textContent = "Connect a wallet";
      var available = !!walletApi();
      content.innerHTML =
        '<button class="wallet-option" id="connect-nautilus" ' +
        (walletPending ? "disabled" : "") +
        '><span class="nautilus-avatar" aria-hidden="true">N</span><span><strong>Nautilus</strong><small>' +
        (walletPending
          ? "Waiting for wallet approval…"
          : available
            ? "Ergo browser wallet"
            : "Browser extension required") +
        '</small></span><span class="pill">' +
        (available ? "Detected" : "Ergo") +
        '</span></button><div id="wallet-error" class="wallet-error" role="status"></div>' +
        (!available
          ? '<p class="wallet-help">Nautilus isn’t detected in this browser. <a href="https://github.com/nautls/nautilus-wallet" target="_blank" rel="noopener noreferrer">Get Nautilus from its official project</a>, then reload this page. You can preview quotes without a wallet.</p>'
          : "");
      $("#connect-nautilus").onclick = connectWallet;
    }
  }
  async function connectWallet() {
    var api = walletApi();
    if (!api) {
      $("#wallet-error").textContent =
        "Install or enable Nautilus in a supported desktop browser, then reload to connect.";
      return;
    }
    if (walletPending) return;
    walletPending = true;
    renderWallet();
    try {
      var ok = await api.connect({ createErgoObject: false });
      if (!ok) throw new Error("declined");
      var ergo = await api.getContext();
      var results = await Promise.all([
        ergo.get_change_address(),
        ergo.get_balance(),
      ]);
      if (
        !AELib.isValidErgoAddress(results[0]) ||
        !/^\d+$/.test(String(results[1]))
      )
        throw new Error("invalid");
      state.wallet = { address: results[0], ergBalanceRaw: String(results[1]) };
      walletPending = false;
      renderWallet();
      document.dispatchEvent(new Event("walletchange"));
      toast("Nautilus connected");
    } catch (e) {
      walletPending = false;
      renderWallet();
      $("#wallet-error").textContent =
        e.message === "declined"
          ? "Connection declined. You can try again or keep exploring without a wallet."
          : "Could not read your wallet. Open Nautilus, unlock it, and try again.";
    }
  }
  document.addEventListener("DOMContentLoaded", function () {
    $all("[data-nav]").forEach(function (a) {
      if (a.dataset.nav === document.body.dataset.page) {
        a.classList.add("active");
        a.setAttribute("aria-current", "page");
      }
    });
    $all("[data-fee-wallet]").forEach(function (e) {
      e.textContent = FEE_WALLET;
    });
    $all("[data-copy-fee-wallet]").forEach(function (b) {
      b.onclick = function () {
        copyText(FEE_WALLET, "Fee recipient");
      };
    });
    $all("[data-close-dialog]").forEach(function (b) {
      b.onclick = function () {
        closeDialog(b.closest("dialog"));
      };
    });
    $all("dialog").forEach(function (d) {
      d.addEventListener("keydown", function (e) {
        if (e.key !== "Tab") return;
        var controls = $all('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]', d)
          .filter(function (control) { return control.getClientRects().length > 0; });
        if (!controls.length) return;
        var first = controls[0], last = controls[controls.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === d)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      });
      d.addEventListener("click", function (e) {
        if (e.target !== d) return;
        var r = d.getBoundingClientRect();
        if (
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom
        )
          d.close();
      });
      d.addEventListener("close", function () {
        if (!document.querySelector("dialog[open]"))
          document.body.style.overflow = "";
        if (d._returnFocus && document.contains(d._returnFocus))
          d._returnFocus.focus();
      });
    });
    $all(".theme-toggle").forEach(function (b) {
      function label() {
        b.setAttribute(
          "aria-label",
          "Switch to " +
            (document.documentElement.dataset.theme === "dark"
              ? "light"
              : "dark") +
            " theme",
        );
      }
      label();
      b.onclick = function () {
        var theme =
          document.documentElement.dataset.theme === "dark" ? "light" : "dark";
        document.documentElement.dataset.theme = theme;
        try {
          localStorage.setItem("airlock-theme", theme);
        } catch (_) {}
        label();
      };
    });
    $all("[data-refresh]").forEach(function (b) {
      b.onclick = function () {
        refreshData(true);
      };
    });
    if ($("#wallet-btn"))
      $("#wallet-btn").onclick = function () {
        renderWallet();
        openDialog("wallet-modal");
      };
    bindCopyButtons();
  });
  window.AstroApp = {
    state: state,
    initData: initData,
    refreshData: refreshData,
    tokenLabel: tokenLabel,
    tokenDecimals: tokenDecimals,
    tokenName: tokenName,
    tokenAvatar: tokenAvatar,
    allTokens: allTokens,
    priceVsErg: priceVsErg,
    ergVolume: ergVolume,
    compact: compact,
    renderStats: renderStats,
    copyText: copyText,
    toast: toast,
    esc: esc,
    icon: icon,
    $: $,
    $all: $all,
    FEE_WALLET: FEE_WALLET,
    bindCopyButtons: bindCopyButtons,
    connectWallet: connectWallet,
    openDialog: openDialog,
    closeDialog: closeDialog,
  };
})();
