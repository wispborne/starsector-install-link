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

  // Pull the directDownloadURL out of a parsed .version object, matching the key
  // case-insensitively — authors hand-write these files and the casing drifts
  // (directdownloadurl, DirectDownloadUrl, …). Returns the trimmed URL string, or
  // null when the field is absent or blank. Pure, so it is unit-testable.
  function getDirectDownloadURL(parsed) {
    if (!parsed || typeof parsed !== 'object') return null;
    for (var key in parsed) {
      if (Object.prototype.hasOwnProperty.call(parsed, key) && key.toLowerCase() === 'directdownloadurl') {
        var val = parsed[key];
        var str = val != null && String(val).trim();
        return str || null;
      }
    }
    return null;
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
        directDownloadURL: getDirectDownloadURL(parsed),
        modThreadId: parsed.modThreadId != null ? String(parsed.modThreadId) : null
      }
    };
  }

  // Pick the best "remote link" to use as a mod source from a parsed .version
  // object. Prefers masterVersionFile — the canonical remote .version URL, which
  // auto-updates and lets TriOS skip already-installed mods — and falls back to
  // directDownloadURL. Pure (takes an already-parsed object), so it is unit-
  // testable without a parser or network. Returns null when neither field is set.
  function extractRemoteLink(parsed) {
    if (!parsed || typeof parsed !== 'object') return null;
    var master = parsed.masterVersionFile != null && String(parsed.masterVersionFile).trim();
    var direct = parsed.directDownloadURL != null && String(parsed.directDownloadURL).trim();
    var url = master || direct || null;
    if (!url) return null;
    return {
      url: url,
      source: master ? 'masterVersionFile' : 'directDownloadURL',
      modName: parsed.modName != null ? String(parsed.modName) : null
    };
  }

  // Extract the mod id (and display name) from a parsed mod_info.json object.
  // mod_info.json isn't strict JSON either — it carries comments, trailing commas
  // and single-quoted values — so callers parse it with Hjson first. Pure, so it
  // is unit-testable. Returns null when there's no usable id.
  function extractModId(parsed) {
    if (!parsed || typeof parsed !== 'object') return null;
    var id = parsed.id != null && String(parsed.id).trim();
    if (!id) return null;
    return { id: id, name: parsed.name != null ? String(parsed.name) : null };
  }

  // Extract dependency entries from a parsed mod_info.json. A mod_info.json may
  // carry a `dependencies` array of { id, name, version? }; we keep id (required)
  // and name (optional) per entry. Returns [] when there's no dependencies array
  // or none carry a usable id. Pure, so it is unit-testable.
  function extractDependencies(parsed) {
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.dependencies)) return [];
    return parsed.dependencies.map(function (d) {
      if (!d || typeof d !== 'object') return null;
      var id = d.id != null && String(d.id).trim();
      if (!id) return null;
      return { id: id, name: d.name != null ? String(d.name) : null };
    }).filter(Boolean);
  }

  // Classify a parsed mod file (.version or mod_info.json) and pull out whatever
  // is useful to fill into the form. The two formats are field-disjoint — a
  // .version carries masterVersionFile/directDownloadURL but no top-level id, and
  // a mod_info.json carries an id but neither link — so no filename hint is
  // needed. Returns:
  //   { kind: 'version', url, source, modName } | { kind: 'modinfo', id, modName }
  // or null when the object is neither.
  function readModFile(parsed) {
    var link = extractRemoteLink(parsed);
    if (link) return { kind: 'version', url: link.url, source: link.source, modName: link.modName };
    var info = extractModId(parsed);
    if (info) return { kind: 'modinfo', id: info.id, modName: info.name };
    return null;
  }

  // A GitHub "blob" URL (github.com/{owner}/{repo}/blob/{ref}/{path}) serves the
  // rendered HTML page, not the file — fetching it yields markup that no parser
  // can read. Rewrite it to the raw.githubusercontent.com host so fetch() gets the
  // actual file contents. Also handles the github.com/.../raw/... form. Leaves
  // non-GitHub or already-raw URLs untouched. Pure, so it is unit-testable.
  function toRawGithubURL(url) {
    if (!url || typeof url !== 'string') return url;
    var m = url.match(/^(https?:)\/\/github\.com\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/i);
    if (!m) return url;
    var rest = m[4].split('#')[0].replace(/\?raw=true$/i, '').replace(/\?.*$/, '');
    return m[1] + '//raw.githubusercontent.com/' + m[2] + '/' + m[3] + '/' + rest;
  }

  // Browser-only: fetch + parse + normalize a .version URL. Requires the vendored
  // Hjson global. Always resolves to { data } or { error } and never rejects, so a
  // CORS/network failure degrades gracefully and never blocks the scheme launch.
  function resolveVersion(url) {
    return fetch(toRawGithubURL(url)).then(function (res) {
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
    getDirectDownloadURL: getDirectDownloadURL,
    extractRemoteLink: extractRemoteLink,
    extractModId: extractModId,
    extractDependencies: extractDependencies,
    readModFile: readModFile,
    toRawGithubURL: toRawGithubURL,
    resolveVersion: resolveVersion
  };
});
