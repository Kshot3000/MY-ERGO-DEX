# Airlock — Ergo quote explorer

A redesigned static interface for [MY-ERGO-DEX](https://kshot3000.github.io/MY-ERGO-DEX/): focused swap previews, searchable token selection, responsive market tables, and clear data provenance.

**Airlock v1 previews quotes only. It does not create, sign, or submit transactions.** Connecting Nautilus is read-only. No swaps, liquidity deposits, or fee payments take place in this version.

## Update your GitHub website

1. Extract `MY-ERGO-DEX-redesign.zip` on your computer.
2. Open `Kshot3000/MY-ERGO-DEX` on GitHub and select the `main` branch.
3. Choose **Add file → Upload files**.
4. Upload the extracted files and folders to the repository root, replacing the matching files. Upload the contents themselves, not the ZIP or a new enclosing folder. Keep `index.html`, `pools.html`, `tokens.html`, and `docs.html` at the root.
5. Commit the upload. If GitHub Pages already publishes the root of `main`, it will redeploy automatically. Otherwise, select **Settings → Pages → Deploy from a branch → main → /(root)** and save.
6. Wait for the Pages deployment to finish, then refresh the website. If the old design remains, perform a hard refresh.

No build command, API key, server, npm installation, or paid service is required to host this site. Font files and data snapshots are included.

Uploading the ZIP alone will not update GitHub Pages; GitHub needs the extracted website files.

## What changed

- Cohesive charcoal and Ergo-orange design across Swap, Pools, Tokens, and Docs.
- Light and dark themes, stored locally in the browser.
- Large amount fields, token search by ticker/name/full ID, quick selections, and reversible pairs.
- Quote details, validated custom slippage, and an accessible review dialog.
- Nautilus discovery, approval/decline states, address and ERG balance display, and disconnect.
- Search, sorting, pagination, keyboard-operable pool details, and links from markets/tokens into swap previews.
- Responsive layouts tested from 320 px to 1440 px, native modal focus handling, visible focus states, and reduced-motion support.
- Snapshot-first loading, followed by a bounded live refresh. Source timestamps remain visible; an unsuccessful refresh never makes a snapshot look live.
- Corrected two-leg quote accounting: the protocol fee applies once, pool fees retain their denominations, and compounded price impact stays within 100%.
- Raw reserve integers serialized as strings so JSON does not discard integer precision.
- Invalid or cleared input immediately clears the old quote and disables its preview.

## Data and quote methodology

Market feed: `https://api.spectrum.fi/v1/price-tracking/markets`.

This feed reports prices and volume, not actual pool reserves. Airlock estimates depth as ten times the larger of reported quote-side volume and base-side volume converted at spot. It splits that estimate equally by value and uses constant-product AMM calculations with BigInt raw token amounts.

- Modeled pool fee: **0.5% per route leg**.
- Modeled protocol fee: **0.25% of the original input, once per quote**.
- Nothing is collected in v1.
- Planned protocol fee recipient, unchanged from the original project: `9fcM5RWnAjmP4vx5bnW6yohB6H9bLq8sJbaPLHtwZLtQPB32Pvy`.
- Token-to-token quotes route through ERG.
- Price impact, minimum received, and reserves are all indicative estimates.
- The API does not specify the volume window, so the UI says **reported volume**, never “24h volume.” ERG-equivalent volume is shown only for ERG markets; both sides are not added together.
- Token names and monogram icons do not imply token verification.

Bundled snapshot timestamp: **2026-09-28T22:24:16Z**. The UI displays this in the visitor’s local timezone. This redesign preserves the original market observations; it does not invent new prices or historical charts.

Refresh the snapshots from a machine with API access:

```bash
bash scripts/refresh-data.sh
```

Commit the resulting `data/` files to publish the refreshed snapshot. Browser CORS restrictions or an unavailable API can prevent live refresh; the bundled snapshot remains usable and visibly timestamped.

## Preview locally

Use a local HTTP server (opening `index.html` with a `file://` URL can block JSON loading):

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080/`.

## Verification

```bash
node --test tests/airlock.test.js
```

24 automated logic tests pass. Browser checks cover swap inputs and errors, token selection, direct and two-leg quotes, settings validation, previews, themes, market search/details, token search/pagination, and all four pages at desktop, tablet, and narrow phone widths. Wallet success, rejection, failure, and disconnect are verified with a simulated Nautilus connector; a real-wallet extension connection is not verified. No transaction signing or submission was tested or added.

## Files

- `index.html`, `pools.html`, `tokens.html`, `docs.html`: GitHub Pages entry points.
- `css/style.css`: shared responsive themes and components.
- `js/aelib.js`: pure quote, fee, and formatting logic.
- `js/app.js`: data loading, shared UI, and read-only wallet connection.
- `js/swap.js`, `js/pools.js`, `js/tokens.js`: page interactions.
- `assets/`: local favicon and Inter font; font license in `assets/fonts/OFL.txt`.
- `data/`: included snapshots and original raw API responses.
- `scripts/`: snapshot refresh tools.
- `tests/`: quote regression tests and original API fixture.
- `js/fx-starfield.js`: retained legacy source; no longer loaded by any page.

The original future roadmap remains: investigate contract-based settlement, test on testnet, and seek review before enabling on-chain swaps or liquidity operations. This UI update does not implement that roadmap or imply an audit.
