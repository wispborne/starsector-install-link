/*
 * Shared deep-link install helpers.
 *
 * Pure functions usable both in the browser (loaded via <script>, exposed as
 * window.Deeplink) and in Node for unit tests (module.exports). The fetch-based
 * resolveVersion() is browser-only and depends on the vendored Hjson global.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./version'));
  else root.Deeplink = factory(root.Version);
})(typeof self !== 'undefined' ? self : this, function (Version) {
  'use strict';

  var SCHEME = 'starsector-mod://install';

  // Optional CORS relay (see cors-relay/). Some hosts (Bitbucket, Dropbox, …)
  // don't send cross-origin headers, so the browser can't read their .version
  // files directly. When set, this is a small self-hosted Cloudflare Worker that
  // re-fetches the file and adds the missing header. Leave it blank to stay fully
  // no-backend — links still work either way; only the in-browser preview and the
  // no-TriOS download fallback lose the ability to resolve those hosts. Set it
  // here, or define self.TRILINK_CORS_PROXY before this script loads.
  var CORS_PROXY = (typeof self !== 'undefined' && self.TRILINK_CORS_PROXY) || '';

  // Build the relay URL for a target .version URL. The Worker reads ?url=.
  function corsProxied(url) {
    return CORS_PROXY.replace(/\/+$/, '') + '/?url=' + encodeURIComponent(url);
  }

  // Each mod/dep is an entry { url, id?, version? }. The param VALUE is a JSON
  // object, URL-encoded by URLSearchParams — e.g.
  // mod={"url":"https://…","id":"nexerelin","version":"0.11.2"}. `id` and
  // `version` together let a manager skip a mod that's already installed; either
  // is omitted entirely when absent.
  function entryToParam(entry) {
    var obj = { url: String(entry.url).trim() };
    if (entry.id != null && String(entry.id).trim()) obj.id = String(entry.id).trim();
    if (entry.version != null && String(entry.version).trim()) obj.version = String(entry.version).trim();
    return JSON.stringify(obj);
  }

  // Parse a decoded param value back into an entry { url, id, version }. Returns
  // null if it has no usable url. Tolerates a bare URL string (treated as
  // { url, id: null, version: null }).
  function parseEntry(value) {
    if (!value || !String(value).trim()) return null;
    try {
      var obj = JSON.parse(value);
      if (obj && obj.url && String(obj.url).trim()) {
        return {
          url: String(obj.url).trim(),
          id: obj.id != null ? String(obj.id) : null,
          version: obj.version != null ? String(obj.version) : null
        };
      }
      return null;
    } catch (e) {
      return { url: String(value).trim(), id: null, version: null }; // forgiving: bare URL
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

  // Extract a URL-decoded filename from a URL.
  function filenameFromURL(url) {
    try {
      var clean = String(url).split('#')[0].split('?')[0];
      var segs = clean.split('/');
      return decodeURIComponent(segs[segs.length - 1]) || clean;
    } catch (e) {
      return url;
    }
  }

  // Format a modVersion object ({ major, minor, patch }) into a string, routed
  // through the canonical Version parser so the result matches how TriOS renders
  // it. No "v" prefix; no "v" suffix-stripping — e.g. { 1, 2, 0 } -> "1.2.0".
  function formatVersion(v) {
    if (!v) return '';
    return new Version({ major: v.major, minor: v.minor, patch: v.patch }).toStringFromParts();
  }

  // Render a version as a display/storage string, via the canonical Version
  // parser. Accepts either a { major, minor, patch } object (as in a .version
  // file's modVersion or a mod_info.json's version) or a plain string
  // (mod_info.json sometimes stores version as "1.2.3"). Returns null when
  // there's nothing usable. Pure.
  function versionString(v) {
    if (v == null) return null;
    if (typeof v === 'string') {
      var s = v.trim();
      if (!s) return null;
      // Parse to validate/structure, but keep the author's original spelling.
      return Version.parse(s).toString();
    }
    if (typeof v === 'object') { return formatVersion(v) || null; }
    return null;
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
      modName: parsed.modName != null ? String(parsed.modName) : null,
      version: versionString(parsed.modVersion)
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
    return {
      id: id,
      name: parsed.name != null ? String(parsed.name) : null,
      version: versionString(parsed.version)
    };
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
      return {
        id: id,
        name: d.name != null ? String(d.name) : null,
        version: versionString(d.version)
      };
    }).filter(Boolean);
  }

  // Classify a parsed mod file (.version or mod_info.json) and pull out whatever
  // is useful to fill into the form. The two formats are field-disjoint — a
  // .version carries masterVersionFile/directDownloadURL but no top-level id, and
  // a mod_info.json carries an id but neither link — so no filename hint is
  // needed. Returns:
  //   { kind: 'version', url, source, modName, version }
  //   | { kind: 'modinfo', id, modName, version }
  // or null when the object is neither.
  function readModFile(parsed) {
    var link = extractRemoteLink(parsed);
    if (link) return { kind: 'version', url: link.url, source: link.source, modName: link.modName, version: link.version };
    var info = extractModId(parsed);
    if (info) return { kind: 'modinfo', id: info.id, modName: info.name, version: info.version };
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

  // Browser-only: read the raw text of a .version URL. Tries a direct read first
  // — that works for hosts that send permissive cross-origin headers (GitHub raw)
  // — and only when that fails falls back to the configured CORS relay, so hosts
  // that block cross-origin reads (Bitbucket, Dropbox, …) still resolve. Resolves
  // to the body string, or null when every attempt fails. Never rejects.
  function fetchVersionBody(url) {
    var raw = toRawGithubURL(url);
    return fetch(raw).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    }).catch(function () {
      if (!CORS_PROXY) return null;
      return fetch(corsProxied(raw)).then(function (res) {
        return res.ok ? res.text() : null;
      }).catch(function () { return null; });
    });
  }

  // Browser-only: fetch + parse + normalize a .version URL. Requires the vendored
  // Hjson global. Always resolves to { data } or { error } and never rejects, so a
  // CORS/network failure degrades gracefully and never blocks the scheme launch.
  function resolveVersion(url) {
    return fetchVersionBody(url).then(function (body) {
      if (body == null) return { error: 'FETCH_FAILED', message: 'could not fetch (network or CORS)' };
      var parsed;
      try {
        parsed = Hjson.parse(body);
      } catch (e) {
        return { error: 'PARSE_FAILED' };
      }
      return normalizeVersionData(parsed);
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
    versionString: versionString,
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
