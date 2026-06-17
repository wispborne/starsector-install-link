/*
 * Shared deep-link install helpers.
 *
 * Pure functions usable both in the browser (loaded via <script>, exposed as
 * window.Deeplink) and in Node for unit tests (module.exports). The fetch-based
 * resolveVersion() is browser-only and depends on the vendored Hjson global.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Deeplink = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SCHEME = 'starsector-mod://install';

  // Each mod/dep is an entry { url, id? }. The param VALUE is a JSON object,
  // URL-encoded by URLSearchParams — e.g. mod={"url":"https://…","id":"nexerelin"}.
  // `id` is optional (the manager uses it to skip already-installed mods); when
  // absent the key is omitted entirely.
  function entryToParam(entry) {
    var obj = { url: String(entry.url).trim() };
    if (entry.id != null && String(entry.id).trim()) obj.id = String(entry.id).trim();
    return JSON.stringify(obj);
  }

  // Parse a decoded param value back into an entry { url, id }. Returns null if it
  // has no usable url. Tolerates a bare URL string (treated as { url, id: null }).
  function parseEntry(value) {
    if (!value || !String(value).trim()) return null;
    try {
      var obj = JSON.parse(value);
      if (obj && obj.url && String(obj.url).trim()) {
        return { url: String(obj.url).trim(), id: obj.id != null ? String(obj.id) : null };
      }
      return null;
    } catch (e) {
      return { url: String(value).trim(), id: null }; // forgiving: bare URL
    }
  }

  // Build the query (URLSearchParams) for a main mod entry + array of dep entries.
  // Returns null when the mod entry is missing/has no url — a defined "malformed"
  // result, not a throw.
  function buildParams(mod, deps) {
    if (!mod || !mod.url || !String(mod.url).trim()) return null;
    var params = new URLSearchParams();
    params.set('mod', entryToParam(mod));
    (deps || []).forEach(function (d) {
      if (d && d.url && String(d.url).trim()) params.append('dep', entryToParam(d));
    });
    return params;
  }

  // Build the full custom scheme URL from a main mod entry + dep entries.
  function buildSchemeTarget(mod, deps) {
    var params = buildParams(mod, deps);
    return params ? SCHEME + '?' + params.toString() : null;
  }

  // True if the URL points at a .version file (ignores query string / fragment).
  function isVersionFile(url) {
    if (!url || typeof url !== 'string') return false;
    var clean = url.split('#')[0].split('?')[0].trim();
    return /\.version$/i.test(clean);
  }

  // Extract a URL-decoded filename from a URL. Mirrors version.js filenameFromURL.
  function filenameFromURL(url) {
    try {
      var clean = String(url).split('#')[0].split('?')[0];
      var segs = clean.split('/');
      return decodeURIComponent(segs[segs.length - 1]) || clean;
    } catch (e) {
      return url;
    }
  }

  // Format a modVersion object. Mirrors version.js formatVersion (no "v" prefix).
  function formatVersion(v) {
    if (!v) return '';
    var major = String(v.major), minor = String(v.minor), patch = String(v.patch);
    if (patch === '0') return minor === '0' ? major : major + '.' + minor;
    if (/^[0-9]+$/.test(patch)) return major + '.' + minor + '.' + patch;
    return major + '.' + minor + patch; // non-numeric patch: append without a dot
  }

  // Normalize an already-parsed .version object. Mirrors fetcher.js normalization.
  // Returns { data } or { error } — pure, so it is unit-testable without a network.
  function normalizeVersionData(parsed) {
    if (!parsed || typeof parsed !== 'object') return { error: 'PARSE_FAILED' };
    if (!parsed.modName || !parsed.modVersion) return { error: 'INVALID_DATA' };
    var mv = parsed.modVersion;
    return {
      data: {
        modName: String(parsed.modName),
        modVersion: {
          major: String(mv.major != null ? mv.major : '0'),
          minor: String(mv.minor != null ? mv.minor : '0'),
          patch: String(mv.patch != null ? mv.patch : '0')
        },
        directDownloadURL: parsed.directDownloadURL || null,
        modThreadId: parsed.modThreadId != null ? String(parsed.modThreadId) : null
      }
    };
  }

  // Browser-only: fetch + parse + normalize a .version URL. Requires the vendored
  // Hjson global. Always resolves to { data } or { error } and never rejects, so a
  // CORS/network failure degrades gracefully and never blocks the scheme launch.
  function resolveVersion(url) {
    return fetch(url).then(function (res) {
      if (!res.ok) return { error: 'FETCH_FAILED', message: 'HTTP ' + res.status };
      return res.text().then(function (body) {
        var parsed;
        try {
          parsed = Hjson.parse(body);
        } catch (e) {
          return { error: 'PARSE_FAILED' };
        }
        return normalizeVersionData(parsed);
      });
    }).catch(function () {
      return { error: 'FETCH_FAILED', message: 'could not fetch (network or CORS)' };
    });
  }

  return {
    entryToParam: entryToParam,
    parseEntry: parseEntry,
    buildParams: buildParams,
    buildSchemeTarget: buildSchemeTarget,
    isVersionFile: isVersionFile,
    filenameFromURL: filenameFromURL,
    formatVersion: formatVersion,
    normalizeVersionData: normalizeVersionData,
    resolveVersion: resolveVersion
  };
});
