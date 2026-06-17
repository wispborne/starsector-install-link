# Starsector — Install with TriOS

A fully **client-side, no-backend** site that lets Starsector mod authors generate a one-click
**"Install with TriOS"** button for their forum posts. A reader who has [TriOS](https://github.com/wispborne/TriOS)
installed clicks the badge and the mod (and any dependencies) installs in one step.

There is nothing to run server-side: it's a folder of static files. Open it locally or publish
it to GitHub Pages unchanged.

## What's here

| File | Role |
|------|------|
| `index.html` | The link generator UI — paste a mod's `.version` (or `.zip`) URL, add optional dependencies, copy the BBCode/URL. |
| `open.html` + `open.js` | The launcher page the badge links to. Reads its query string, fires the `starsector-mod://install?…` scheme, and shows a manual download fallback if no manager handles it. |
| `install.js` | Generator logic for `index.html`. |
| `deeplink.js` | Shared pure helpers (scheme builder, `.version` detection/parse/normalize, fetch resolver). |
| `install-badge*.svg` | The committed badge images (default cyan + blue/purple/green/amber/red variants). |
| `vendor/hjson.min.js` | Browser build of the HJSON parser used to read `.version` files. |
| `scripts/gen-install-badges.js` | Dev tool that regenerates the badge SVGs. Self-contained — no dependencies. |
| `tests/deeplink.test.js` | Unit tests for `deeplink.js`. |

## How it works

Forum BBCode can't contain a custom URI scheme (SMF rewrites anything non-`http(s)`), so the
badge links to `open.html` — a normal `https` page — which reconstructs and fires the
`starsector-mod://install?…` scheme in JavaScript. All install semantics live in the mod
manager; this site only builds and relays the link. The scheme is a proposed community standard,
not TriOS-specific — any manager that registers it works.

## Run it locally

It's static, so just open `index.html` in a browser. (The `.version` live-preview uses
`fetch()`, which works for hosts that allow cross-origin reads — e.g. `raw.githubusercontent.com`;
it degrades gracefully otherwise and never blocks link generation.)

If you prefer a local server, any static server works, for example:

```bash
npx serve .
```

## Deploy to GitHub Pages

Push this folder to a repo and enable Pages (serve from the root). All asset paths are relative,
so it works under any subpath. `open.html?mod=…` query strings are passed through to the page.

## Tests

```bash
npm test          # node --test tests/*.test.js
```

## Regenerate the badge images

The SVGs are committed, so you only need this if you change the label, icon, or palette:

```bash
npm run gen-badges   # node scripts/gen-install-badges.js
```
