/* ============================================================
   Airlock shared app shell — js/app.js (v0.2.0)
   - loads market data: tries live Spectrum API, falls back to the baked
     snapshot (CORS blocks browsers from api.spectrum.fi)
   - token metadata directory (always from baked data/tokens.json)
   - Nautilus (EIP-12) wallet connect, wrapped in try/catch
   - shared DOM helpers: toast, copy-to-clipboard, nav, footer fee wallet
   ============================================================ */
(function () {
  "use strict";

  var FEE_WALLET = "9fcM5RWnAjmP4vx5bnW6yohB6H9bLq8sJbaPLHtwZLtQPB32Pvy";
  var SPECTRUM_MARKETS_URL = "https://api.spectrum.fi/v1/price-tracking/markets";

  var state = {
    pairs: [],          // processed pairs (live or snapshot)
    tokenMeta: {},      // tokenId -> metadata from data/tokens.json
    dataSource: "loading", // 'live' | 'snapshot'
    fetchedAt: null,
    wallet: null,       // { address, ergBalanceRaw }
  };

  /* ---------------- tiny DOM helpers ---------------- */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function toast(msg) {
    var el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove("show"); }, 2600);
  }

  function copyText(text, label) {
    function done() { toast((label || "Copied") + " ✓"); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(); });
    } else { fallback(); }
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { toast("Copy failed — select manually"); }
      document.body.removeChild(ta);
    }
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* ---------------- data loading ---------------- */

  function fetchWithTimeout(url, ms) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(new Error("timeout")); }, ms);
      fetch(url, { cache: "no-store" }).then(
        function (r) { clearTimeout(timer); r.ok ? resolve(r) : reject(new Error("HTTP " + r.status)); },
        function (e) { clearTimeout(timer); reject(e); }
      );
    });
  }

  function setBadge() {
    var badge = $("#src-badge");
    if (!badge) return;
    badge.classList.remove("loading", "snapshot");
    if (state.dataSource === "live") {
      badge.textContent = "● LIVE market data";
      badge.title = "Fetched live from api.spectrum.fi just now";
    } else if (state.dataSource === "snapshot") {
      badge.classList.add("snapshot");
      var when = state.fetchedAt ? new Date(state.fetchedAt).toLocaleString() : "unknown";
      badge.textContent = "◐ SNAPSHOT · as of " + when;
      badge.title = "Browsers can't reach the Spectrum API directly (no CORS headers). " +
        "Showing the baked snapshot pulled at build time. Re-pull with scripts/refresh-data.sh.";
    } else {
      badge.classList.add("loading");
      badge.textContent = "○ loading…";
    }
  }

  function loadTokenMeta() {
    return fetch("data/tokens.json", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        (j.tokens || []).forEach(function (t) { state.tokenMeta[t.tokenId] = t; });
      })
      .catch(function () { /* metadata optional; pairs still work */ });
  }

  // Callback style so pages can render progressively.
  function initData(onReady) {
    setBadge();
    loadTokenMeta().then(function () {
      // Try live first…
      fetchWithTimeout(SPECTRUM_MARKETS_URL, 9000)
        .then(function (r) { return r.json(); })
        .then(function (raw) {
          var processed = AELib.processMarkets(raw);
          state.pairs = processed.pairs;
          state.dataSource = "live";
          state.fetchedAt = processed.fetchedAt;
          setBadge();
          onReady(state);
        })
        .catch(function () {
          // …fall back to the baked snapshot (expected in browsers: no CORS).
          fetch("data/markets.json", { cache: "no-store" })
            .then(function (r) { return r.json(); })
            .then(function (snap) {
              state.pairs = snap.pairs || [];
              state.dataSource = "snapshot";
              state.fetchedAt = snap.fetched_at || null;
              setBadge();
              onReady(state);
            })
            .catch(function () {
              state.dataSource = "snapshot";
              setBadge();
              onReady(state);
            });
        });
    });
  }

  function tokenLabel(tokenId) {
    var meta = state.tokenMeta[tokenId];
    if (meta) return meta.ticker;
    // fall back to pair data
    for (var i = 0; i < state.pairs.length; i++) {
      var p = state.pairs[i];
      if (p.base.tokenId === tokenId) return p.base.ticker;
      if (p.quote.tokenId === tokenId) return p.quote.ticker;
    }
    return AELib.truncateId(tokenId, 6);
  }

  function tokenDecimals(tokenId) {
    var meta = state.tokenMeta[tokenId];
    if (meta && meta.decimals != null) return meta.decimals;
    for (var i = 0; i < state.pairs.length; i++) {
      var p = state.pairs[i];
      if (p.base.tokenId === tokenId) return p.base.decimals;
      if (p.quote.tokenId === tokenId) return p.quote.decimals;
    }
    return 0;
  }

  /* ---------------- Nautilus wallet (EIP-12, docs-only — untested live) ---------------- */

  function walletApi() {
    try {
      if (window.ergoConnector && window.ergoConnector.nautilus) {
        return window.ergoConnector.nautilus;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  function connectWallet() {
    var btn = $("#wallet-btn"), chip = $("#wallet-chip");
    var api = walletApi();
    if (!api) {
      toast("Nautilus wallet not detected — install it to connect");
      return;
    }
    toast("Requesting Nautilus connection…");
    Promise.resolve()
      .then(function () { return api.connect({ createErgoObject: false }); })
      .then(function (ok) {
        if (!ok) throw new Error("connection declined");
        return api.getContext();
      })
      .then(function (ergo) {
        return Promise.all([ergo.get_change_address(), ergo.get_balance("ERG")])
          .then(function (res) {
            state.wallet = { address: res[0], ergBalanceRaw: res[1] };
            renderWallet();
            toast("Wallet connected ✓");
          });
      })
      .catch(function (e) {
        console.warn("[airlock] wallet connect failed:", e);
        toast("Wallet connection failed — see console");
      });
  }

  function renderWallet() {
    var btn = $("#wallet-btn"), chip = $("#wallet-chip");
    if (!state.wallet || !chip) return;
    var addr = state.wallet.address;
    var erg = "—";
    try { erg = AELib.formatAmount(state.wallet.ergBalanceRaw, 9) + " ERG"; } catch (e) {}
    chip.querySelector(".addr").textContent = addr;
    chip.querySelector(".bal").textContent = erg;
    chip.style.display = "inline-flex";
    if (btn) btn.style.display = "none";
    chip.title = "Connected via Nautilus (EIP-12). Balances are read-only in v1.";
  }

  /* ---------------- chrome: nav + footer ---------------- */

  function markActiveNav() {
    var page = document.body.getAttribute("data-page");
    $all("nav.mainnav a").forEach(function (a) {
      if (a.getAttribute("data-nav") === page) a.classList.add("active");
    });
  }

  function renderFeeWallet() {
    $all("[data-fee-wallet]").forEach(function (el) {
      el.textContent = FEE_WALLET;
    });
    $all("[data-copy-fee-wallet]").forEach(function (btn) {
      btn.addEventListener("click", function () { copyText(FEE_WALLET, "Fee wallet address"); });
    });
  }

  function bindCopyButtons() {
    $all("[data-copy]").forEach(function (btn) {
      if (btn._bound) return;
      btn._bound = true;
      btn.addEventListener("click", function (ev) {
        ev.stopPropagation();
        copyText(btn.getAttribute("data-copy"), btn.getAttribute("data-copy-label") || "Copied");
      });
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    markActiveNav();
    renderFeeWallet();
    bindCopyButtons();
    var btn = $("#wallet-btn");
    if (btn) btn.addEventListener("click", connectWallet);
  });

  // public surface
  window.AstroApp = {
    state: state,
    initData: initData,
    tokenLabel: tokenLabel,
    tokenDecimals: tokenDecimals,
    copyText: copyText,
    toast: toast,
    esc: esc,
    $: $,
    $all: $all,
    FEE_WALLET: FEE_WALLET,
    bindCopyButtons: bindCopyButtons,
    connectWallet: connectWallet,
  };
})();
