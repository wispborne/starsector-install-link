# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

TriLink: a fully **client-side, no-backend** static site. It generates one-click
"Install with TriOS" badge links for Starsector mod forum posts, and hosts the relay page
those badges point at. There is no build step and no server — it's a folder of static files
you open directly or publish to GitHub Pages unchanged.

## Commands

```bash
npm test             # node --test tests/*.test.js
node --test tests/deeplink.test.js   # run one test file
npm run gen-badges   # regenerate badges/*.svg from scripts/gen-install-badges.js
npx serve .          # optional local static server (or just open index.html)
```

There is no lint or build command; the only Node dependency-free tooling is the test runner
and the badge generator. The badge SVGs are committed — only regenerate them if you change
the label, icon, or palette.

## Architecture

Two HTML entry points, sharing a chain of plain `<script>`-loaded modules. **Script load
order matters** and must stay `hjson → version.js → deeplink.js → (install.js | open.js)`,
because each later module reads the previous one off the global (`window.Version`,
`window.Deeplink`, `Hjson`). See the `<script>` tags in [index.html](index.html) and
[open.html](open.html).

- **[index.html](index.html) + [install.js](install.js)** — the generator UI. Author pastes
  a `.version`/`.zip`/`mod_info.json` URL (or drops a file), adds optional dependencies,
  picks a badge style, and copies the BBCode/URL. Produces a link to `open.html`.
- **[open.html](open.html) + [open.js](open.js)** — the launcher/relay the badge links to.
  Reads its query string, reconstructs `starsector-mod://install?…`, and fires it from JS
  (via a hidden iframe so a missing handler doesn't navigate away), with a manual-download
  fallback. The relay exists because forum BBCode (SMF) rewrites any non-`http(s)` URI, so
  the badge can't embed the custom scheme directly.

### The two shared modules

- **[deeplink.js](deeplink.js)** — the heart of the app. **Pure** functions for building,
  parsing, and normalizing links: `buildSchemeTarget`/`buildParams`/`entryToParam` (write),
  `parseEntry` (read), `normalizeVersionData`/`extractRemoteLink`/`extractModId`/
  `extractDependencies`/`readModFile` (interpret a parsed mod file), and `toRawGithubURL`.
  The one impure function is `resolveVersion()` (browser-only `fetch` + Hjson parse).
- **[version.js](version.js)** — a faithful JS port of TriOS's Dart `Version`
  parser/comparator. Keep it behaviorally identical to the Dart original so versions parse
  and order the same on both sides; `deeplink.js` routes all version formatting through it.

Both follow a **UMD pattern**: `module.exports` for Node tests, `window.X` global in the
browser. Keep that dual-export shape when editing — the tests `require()` these files
directly and the browser loads them as globals.

### Conventions worth preserving

- **Keep helpers in `deeplink.js` pure** (take already-parsed objects, no fetch/DOM) so they
  stay unit-testable without a network. `resolveVersion` is the deliberate exception.
- **Mod files are parsed with Hjson, not JSON** — `.version` and `mod_info.json` are
  hand-written and carry comments, trailing commas, unquoted/single-quoted values, and
  drifting key casing. Match keys case-insensitively (see `getDirectDownloadURL`) and parse
  loosely.
- **Graceful degradation**: anything touching the network (`.version` live preview, launch
  detection) must never block link generation or the scheme launch. `resolveVersion` always
  resolves to `{ data }` or `{ error }` and never rejects.
- **GitHub URLs**: `github.com/.../blob/...` serves HTML, not the file. `toRawGithubURL`
  rewrites blob/raw URLs to `raw.githubusercontent.com`; this is applied both at generation
  time (install.js) and again in open.js, so old pre-existing buttons still resolve.
- **Optional CORS relay**: some hosts (Bitbucket, Dropbox, …) block cross-origin reads, so the
  browser can't read their `.version` files. `resolveVersion` reads directly first and falls
  back to the relay in [cors-relay/](cors-relay/) (a self-hosted Cloudflare Worker) only when
  that fails. The relay is off unless `CORS_PROXY`/`self.TRILINK_CORS_PROXY` is set, so the
  site stays fully static by default. The relay only ever changes the browser-side preview and
  the no-TriOS download fallback — it never affects the one-click install, which TriOS (a
  desktop app, not a browser) does itself with no CORS limits.
- The `starsector-mod://` scheme is a proposed **community standard**, not TriOS-specific.
  The wire format (URL-encoded JSON `{url, id?, version?}` entries) is documented in detail
  in [README.md](README.md) — consult it before changing the link shape, and keep producer
  (deeplink.js) tolerant of bare-URL entries on the consumer side.

## Tests

`tests/deeplink.test.js` and `tests/version.test.js` use the built-in `node:test` runner and
cover the pure functions of each module. When adding a pure helper to `deeplink.js` or
changing `version.js` comparison/parse behavior, extend these.
