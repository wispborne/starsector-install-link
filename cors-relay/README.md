# TriLink CORS relay

A tiny Cloudflare Worker that lets the TriLink page read `.version` files from
hosts that don't allow cross-origin reads (Bitbucket, Dropbox, and friends).

You don't need this for the install button to work — when someone clicks the
badge, TriOS downloads the mod itself, and TriOS isn't a browser, so cross-origin
rules don't apply to it. The relay only helps the two browser-side bits:

- the live mod-name preview while you're making a link, and
- the manual download link shown to players who don't have TriOS.

Without the relay, those two fall back gracefully for blocked hosts. With it, they
resolve to the real mod name and download link.

## What it does

It re-fetches the `.version` file on the server side and hands it back with the
cross-origin header the browser needs. It only relays `.version` files, only
handles GET, and caps the size — it is not a general-purpose proxy.

## Deploy it

1. Install the Cloudflare CLI: `npm install -g wrangler`
2. Sign in: `wrangler login`
3. From this folder: `wrangler deploy`
4. Copy the URL it prints, e.g. `https://trilink-cors.<your-name>.workers.dev`

## Turn it on

Point TriLink at the deployed Worker in one of two ways:

- Edit `CORS_PROXY` in `deeplink.js` and paste the URL, **or**
- Add this to `index.html` and `open.html`, before the other `<script>` tags:

  ```html
  <script>self.TRILINK_CORS_PROXY = 'https://trilink-cors.<your-name>.workers.dev';</script>
  ```

The free Cloudflare plan (100,000 requests/day) is far more than this needs.
