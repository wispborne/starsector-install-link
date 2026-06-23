# TriLink

**TriLink** is a fully **client-side, no-backend** site that lets Starsector mod authors generate a one-click
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
| `version.js` | Canonical version parser/comparator — a faithful JS port of TriOS's Dart `Version`, so versions parse and order the same on both sides. |
| `badges/install-badge*.svg` | The committed badge images — flat + for-the-badge styles, right side in cyan/blue/purple/green/amber/red, left side in TriOS navy or gray. |
| `vendor/hjson.min.js` | Browser build of the HJSON parser used to read `.version` files. |
| `scripts/gen-install-badges.js` | Dev tool that regenerates the badge SVGs. Self-contained — no dependencies. |
| `tests/deeplink.test.js` | Unit tests for `deeplink.js`. |
| `tests/version.test.js` | Unit tests for `version.js`. |

## How it works

Forum BBCode can't contain a custom URI scheme (SMF rewrites anything non-`http(s)`), so the
badge links to `open.html` — a normal `https` page — which reconstructs and fires the
`starsector-mod://install?…` scheme in JavaScript. All install semantics live in the mod
manager; this site only builds and relays the link. The scheme is a proposed community standard,
not TriOS-specific — any manager that registers it works.

## The `starsector-mod://` URI scheme

This section is for anyone who wants to understand or implement the protocol itself —
mod-manager authors, tinkerers, or the merely curious. TriLink is just one producer of
these links; the scheme is a proposed community standard and is not TriOS-specific. Any
manager that registers an OS handler for `starsector-mod://` can consume the same links.

### Shape

```
starsector-mod://install?mod=<entry>&dep=<entry>&dep=<entry>…
```

- **Scheme + host/action:** `starsector-mod://install`. `install` is the action; it's the
  only one defined today, but the slot leaves room for future verbs.
- **`mod`** — required, exactly one. The mod to install.
- **`dep`** — optional, repeated once per dependency. Order is not significant; a manager
  should resolve and install dependencies as needed.

### Entry format

Each `mod`/`dep` value is a **JSON object, URL-encoded** as a normal query-string value
(percent-encoding via `URLSearchParams`). The object has three fields:

| Field | Required | Meaning |
|-------|----------|---------|
| `url` | yes | Where to get the mod. Either a `.version` file URL or a direct archive (`.zip`) URL. |
| `id`  | yes (in TriLink) | The mod's `mod_info.json` id (e.g. `nexerelin`). Lets a manager skip a mod that's already installed. |
| `version` | optional | A version paired with `id`, used as a floor: a manager skips the entry when the *installed* copy is that version or newer, and installs from `url` otherwise. Its meaning differs by position — see below. |

TriLink requires `id` on every entry but treats `version` as optional, and a consumer should
treat all of `id`/`version` as optional for tolerance — older or hand-built links may omit
them, and any omitted field is left out of the JSON entirely.

**What `version` means depends on the entry:**

- On the **`mod`** entry it's the version the link installs. A `.version` URL fills it in
  automatically; a `.zip` can't, so it's typed in (or left blank). When present, a manager
  can skip the mod if the installed copy is already that version or newer.
- On a **`dep`** entry it's the dependency's **minimum required version** — opt-in in TriLink
  via the "Require this version or newer" checkbox (off by default). When omitted, the
  dependency is installed only when it's missing entirely; when present, a manager installs/
  upgrades only if the installed copy is below it.

Either way the comparison a manager runs is the same: *installed ≥ `version` → skip, else
install from `url`.*

Decoded, a single entry looks like:

```json
{"url":"https://raw.githubusercontent.com/user/repo/master/mod.version","id":"nexerelin","version":"0.11.2"}
```

A full decoded link with one dependency:

```
starsector-mod://install?mod={"url":"https://…/MyMod.version","id":"mymod","version":"1.4.0"}&dep={"url":"https://…/LazyLib.version","id":"lw_lazylib","version":"2.8"}
```

(In the wire form every `{`, `"`, `:` etc. is percent-encoded.)

For maximum tolerance, a consumer should also accept a **bare URL string** in place of the
JSON object (treated as `{ url, id: null, version: null }`).

### `url`: `.version` files vs. direct archives

The `url` can point at either:

- **A `.version` file** — the small metadata file Starsector's
  [Version Checker](https://fractalsoftworks.com/forum/index.php?topic=8181.0) format
  uses. It's [HJSON](https://hjson.github.io/) (JSON with comments, trailing commas, and
  unquoted keys), so parse it loosely. The fields that matter here:
  - `masterVersionFile` — the canonical remote `.version` URL. Preferred source: it
    auto-updates and lets a manager re-resolve later.
  - `directDownloadURL` — a direct link to the mod archive.
  - `modName`, `modVersion` (`{ major, minor, patch }`) — used for display.
  - Field casing drifts in the wild (`directDownloadURL`, `DirectDownloadUrl`, …), so
    match keys case-insensitively.
- **A direct archive URL** — a `.zip` the manager downloads and extracts directly.

A `.version` URL is preferred because it carries the id, version, and a self-updating
remote pointer; a direct archive is the simpler fallback.

### Why a relay page (`open.html`) is needed

Forum BBCode can't embed a custom URI scheme — SMF (the forum software) rewrites anything
that isn't `http(s)`. So the badge links to `open.html`, a plain `https` page, which
reconstructs the `starsector-mod://install?…` URL from its own query string and fires it
from JavaScript (via a hidden iframe, so a missing handler doesn't navigate the page away).
If no OS handler responds, the page shows a manual-download fallback. If you're building
links outside a forum and can use the scheme directly, you don't need the relay at all.

### Implementing a consumer

To handle these links in your own manager:

1. Register an OS protocol handler for `starsector-mod://`.
2. On invocation, parse the query string. Read the single `mod` and any `dep` values;
   JSON-decode each (falling back to treating the value as a bare URL).
3. For each entry, if `url` is a `.version` file, fetch and parse it (HJSON) to get the
   archive URL, id, and version; otherwise treat `url` as the archive directly.
4. Use `id` (when present) to skip mods already installed, then download + install the rest.

The pure helpers in [`deeplink.js`](deeplink.js) (`buildSchemeTarget`, `parseEntry`,
`normalizeVersionData`, `extractRemoteLink`, …) are a working reference for the
build/parse/normalize steps and are covered by [`tests/deeplink.test.js`](tests/deeplink.test.js).

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
