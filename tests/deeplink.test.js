const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  entryToParam,
  parseEntry,
  buildSchemeTarget,
  isVersionFile,
  filenameFromURL,
  normalizeVersionData,
  getDirectDownloadURL,
  extractRemoteLink,
  extractModId,
  extractDependencies,
  readModFile,
  formatVersion,
  toRawGithubURL
} = require('../deeplink');

describe('entryToParam', () => {
  it('encodes a url-only entry as a JSON object with no id key', () => {
    assert.equal(entryToParam({ url: 'https://x/Mod.version' }), '{"url":"https://x/Mod.version"}');
  });
  it('includes id when present, url first', () => {
    assert.equal(
      entryToParam({ url: 'https://x/Mod.version', id: 'nexerelin' }),
      '{"url":"https://x/Mod.version","id":"nexerelin"}'
    );
  });
  it('omits a blank id', () => {
    assert.equal(entryToParam({ url: 'https://x/m.zip', id: '   ' }), '{"url":"https://x/m.zip"}');
  });
});

describe('buildSchemeTarget', () => {
  it('builds a scheme URL for a direct archive mod, no deps', () => {
    const t = buildSchemeTarget({ url: 'https://example.com/mod.zip' }, []);
    assert.equal(t, 'starsector-mod://install?mod=' + encodeURIComponent('{"url":"https://example.com/mod.zip"}'));
  });

  it('matches the documented Nexerelin encoding', () => {
    const url = 'https://raw.githubusercontent.com/Histidine91/Nexerelin/master/Nexerelin.version';
    const t = buildSchemeTarget({ url, id: 'nexerelin' }, []);
    assert.equal(
      t,
      'starsector-mod://install?mod=%7B%22url%22%3A%22https%3A%2F%2Fraw.githubusercontent.com%2F'
      + 'Histidine91%2FNexerelin%2Fmaster%2FNexerelin.version%22%2C%22id%22%3A%22nexerelin%22%7D'
    );
  });

  it('appends multiple dependencies, preserving order; id optional per entry', () => {
    const t = buildSchemeTarget(
      { url: 'https://x/mod.version', id: 'main' },
      [{ url: 'https://y/A.version', id: 'lw_lazylib' }, { url: 'https://z/B.zip' }]
    );
    const qs = new URLSearchParams(t.split('?')[1]);
    assert.deepEqual(JSON.parse(qs.get('mod')), { url: 'https://x/mod.version', id: 'main' });
    const deps = qs.getAll('dep').map(d => JSON.parse(d));
    assert.deepEqual(deps, [
      { url: 'https://y/A.version', id: 'lw_lazylib' },
      { url: 'https://z/B.zip' }
    ]);
  });

  it('round-trips encoding (parsing the params yields the originals)', () => {
    const mod = { url: 'https://host/path with space/Mod.version?ref=heads/main', id: 'a&b' };
    const dep = { url: 'https://host/Dep+Name.zip' };
    const t = buildSchemeTarget(mod, [dep]);
    const qs = new URLSearchParams(t.split('?')[1]);
    assert.deepEqual(JSON.parse(qs.get('mod')), mod);
    assert.deepEqual(JSON.parse(qs.get('dep')), dep);
  });

  it('ignores dep entries with no url', () => {
    const t = buildSchemeTarget({ url: 'https://x/mod.zip' }, [{ url: '' }, { id: 'x' }, { url: 'https://y/D.zip' }]);
    const qs = new URLSearchParams(t.split('?')[1]);
    assert.equal(qs.getAll('dep').length, 1);
    assert.deepEqual(JSON.parse(qs.getAll('dep')[0]), { url: 'https://y/D.zip' });
  });

  it('returns null for a missing mod url (defined malformed result, not a throw)', () => {
    assert.equal(buildSchemeTarget(null, []), null);
    assert.equal(buildSchemeTarget({ id: 'x' }, []), null);
    assert.equal(buildSchemeTarget({ url: '   ' }, [{ url: 'https://y/D.zip' }]), null);
    assert.equal(buildSchemeTarget(undefined), null);
  });
});

describe('parseEntry', () => {
  it('parses a JSON entry with id', () => {
    assert.deepEqual(
      parseEntry('{"url":"https://x/Mod.version","id":"nexerelin"}'),
      { url: 'https://x/Mod.version', id: 'nexerelin' }
    );
  });
  it('parses a JSON entry without id (id => null)', () => {
    assert.deepEqual(parseEntry('{"url":"https://x/m.zip"}'), { url: 'https://x/m.zip', id: null });
  });
  it('tolerates a bare URL string', () => {
    assert.deepEqual(parseEntry('https://x/m.zip'), { url: 'https://x/m.zip', id: null });
  });
  it('returns null for empty / url-less input', () => {
    assert.equal(parseEntry(''), null);
    assert.equal(parseEntry(null), null);
    assert.equal(parseEntry('{"id":"x"}'), null);
  });
  it('round-trips with entryToParam', () => {
    const entry = { url: 'https://x/My Mod.version?ref=main', id: 'a"b' };
    assert.deepEqual(parseEntry(entryToParam(entry)), entry);
  });
});

describe('isVersionFile', () => {
  it('detects a .version suffix', () => {
    assert.equal(isVersionFile('https://x/Mod.version'), true);
  });
  it('detects .version regardless of case', () => {
    assert.equal(isVersionFile('https://x/Mod.VERSION'), true);
  });
  it('ignores query strings and fragments', () => {
    assert.equal(isVersionFile('https://x/Mod.version?ref=heads/main'), true);
    assert.equal(isVersionFile('https://x/Mod.version#frag'), true);
  });
  it('returns false for archives and other URLs', () => {
    assert.equal(isVersionFile('https://x/Mod.zip'), false);
    assert.equal(isVersionFile('https://x/versions/list'), false);
    assert.equal(isVersionFile('https://x/version'), false);
  });
  it('returns false for empty/invalid input', () => {
    assert.equal(isVersionFile(''), false);
    assert.equal(isVersionFile(null), false);
    assert.equal(isVersionFile(undefined), false);
  });
});

describe('filenameFromURL', () => {
  it('extracts and decodes the filename', () => {
    assert.equal(filenameFromURL('https://x/path/My%20Mod.zip'), 'My Mod.zip');
  });
  it('strips query strings', () => {
    assert.equal(filenameFromURL('https://x/Mod.zip?dl=1'), 'Mod.zip');
  });
});

describe('normalizeVersionData', () => {
  it('normalizes a parsed .version object', () => {
    const result = normalizeVersionData({
      modName: 'Test Mod',
      modVersion: { major: 1, minor: 2, patch: 0 },
      directDownloadURL: 'https://x/mod.zip',
      modThreadId: 12345
    });
    assert.deepEqual(result, {
      data: {
        modName: 'Test Mod',
        modVersion: { major: '1', minor: '2', patch: '0' },
        directDownloadURL: 'https://x/mod.zip',
        modThreadId: '12345'
      }
    });
  });

  it('defaults missing version parts to 0 and null fields to null', () => {
    const result = normalizeVersionData({ modName: 'M', modVersion: { major: 2 } });
    assert.equal(result.data.modVersion.minor, '0');
    assert.equal(result.data.modVersion.patch, '0');
    assert.equal(result.data.directDownloadURL, null);
    assert.equal(result.data.modThreadId, null);
  });

  it('flags missing required fields', () => {
    assert.equal(normalizeVersionData({ modName: 'M' }).error, 'INVALID_DATA');
    assert.equal(normalizeVersionData({ modVersion: {} }).error, 'INVALID_DATA');
  });

  it('flags non-object input', () => {
    assert.equal(normalizeVersionData(null).error, 'PARSE_FAILED');
    assert.equal(normalizeVersionData('nope').error, 'PARSE_FAILED');
  });

  it('reads directDownloadURL case-insensitively', () => {
    const result = normalizeVersionData({ modName: 'M', modVersion: {}, directdownloadurl: 'https://x/mod.zip' });
    assert.equal(result.data.directDownloadURL, 'https://x/mod.zip');
  });
});

describe('getDirectDownloadURL', () => {
  it('matches the key regardless of case', () => {
    assert.equal(getDirectDownloadURL({ directDownloadURL: 'https://x/a.zip' }), 'https://x/a.zip');
    assert.equal(getDirectDownloadURL({ directdownloadurl: 'https://x/b.zip' }), 'https://x/b.zip');
    assert.equal(getDirectDownloadURL({ DirectDownloadUrl: 'https://x/c.zip' }), 'https://x/c.zip');
  });

  it('trims and returns the URL', () => {
    assert.equal(getDirectDownloadURL({ directDownloadURL: '  https://x/d.zip  ' }), 'https://x/d.zip');
  });

  it('returns null when absent, blank, or not an object', () => {
    assert.equal(getDirectDownloadURL({ modName: 'M' }), null);
    assert.equal(getDirectDownloadURL({ directDownloadURL: '   ' }), null);
    assert.equal(getDirectDownloadURL({ directDownloadURL: null }), null);
    assert.equal(getDirectDownloadURL(null), null);
    assert.equal(getDirectDownloadURL('nope'), null);
  });
});

describe('extractRemoteLink', () => {
  it('prefers masterVersionFile (the example .version file)', () => {
    const parsed = {
      masterVersionFile: 'https://raw.githubusercontent.com/wispborne/stories/master/wisp_perseanchronicles.version',
      modName: 'Persean Chronicles',
      directDownloadURL: 'https://github.com/wispborne/stories/releases/download/3.0.8/Persean-Chronicles-3.0.8.zip',
      modVersion: { major: 3, minor: 0, patch: 8 }
    };
    assert.deepEqual(extractRemoteLink(parsed), {
      url: 'https://raw.githubusercontent.com/wispborne/stories/master/wisp_perseanchronicles.version',
      source: 'masterVersionFile',
      modName: 'Persean Chronicles'
    });
  });

  it('falls back to directDownloadURL when masterVersionFile is absent', () => {
    const result = extractRemoteLink({ modName: 'M', directDownloadURL: 'https://x/mod.zip' });
    assert.equal(result.url, 'https://x/mod.zip');
    assert.equal(result.source, 'directDownloadURL');
  });

  it('ignores a blank masterVersionFile and uses the direct URL', () => {
    const result = extractRemoteLink({ masterVersionFile: '   ', directDownloadURL: 'https://x/mod.zip' });
    assert.equal(result.url, 'https://x/mod.zip');
    assert.equal(result.source, 'directDownloadURL');
  });

  it('returns null when neither link is present', () => {
    assert.equal(extractRemoteLink({ modName: 'M', modVersion: {} }), null);
    assert.equal(extractRemoteLink(null), null);
    assert.equal(extractRemoteLink('nope'), null);
  });

  it('exposes a null modName when absent', () => {
    assert.equal(extractRemoteLink({ masterVersionFile: 'https://x/M.version' }).modName, null);
  });
});

describe('extractModId', () => {
  it('pulls id and name from a mod_info.json object', () => {
    assert.deepEqual(
      extractModId({ id: 'MagicLib', name: 'MagicLib', version: { major: 1, minor: 5, patch: 8 } }),
      { id: 'MagicLib', name: 'MagicLib' }
    );
  });
  it('exposes a null name when absent', () => {
    assert.deepEqual(extractModId({ id: 'JYD' }), { id: 'JYD', name: null });
  });
  it('returns null when there is no usable id', () => {
    assert.equal(extractModId({ name: 'No Id' }), null);
    assert.equal(extractModId({ id: '   ' }), null);
    assert.equal(extractModId(null), null);
    assert.equal(extractModId('nope'), null);
  });
});

describe('extractDependencies', () => {
  it('pulls id (and name) from each dependency in a mod_info.json', () => {
    const parsed = {
      id: 'wisp_perseanchronicles',
      dependencies: [
        { id: 'lw_lazylib', name: 'LazyLib' },
        { id: 'MagicLib', name: 'MagicLib' }
      ]
    };
    assert.deepEqual(extractDependencies(parsed), [
      { id: 'lw_lazylib', name: 'LazyLib' },
      { id: 'MagicLib', name: 'MagicLib' }
    ]);
  });

  it('exposes a null name when a dependency omits one', () => {
    assert.deepEqual(extractDependencies({ dependencies: [{ id: 'shaderLib' }] }), [
      { id: 'shaderLib', name: null }
    ]);
  });

  it('skips dependency entries with no usable id', () => {
    const parsed = { dependencies: [{ name: 'No Id' }, { id: '  ' }, { id: 'ok', name: 'OK' }] };
    assert.deepEqual(extractDependencies(parsed), [{ id: 'ok', name: 'OK' }]);
  });

  it('returns [] when there is no dependencies array', () => {
    assert.deepEqual(extractDependencies({ id: 'solo' }), []);
    assert.deepEqual(extractDependencies({ dependencies: 'nope' }), []);
    assert.deepEqual(extractDependencies(null), []);
  });
});

describe('readModFile', () => {
  it('classifies a .version object and returns its remote link', () => {
    const result = readModFile({
      masterVersionFile: 'https://x/timid_xiv.version',
      modName: 'Iron Shell',
      modVersion: { major: 1, minor: 18, patch: '5b' }
    });
    assert.deepEqual(result, {
      kind: 'version',
      url: 'https://x/timid_xiv.version',
      source: 'masterVersionFile',
      modName: 'Iron Shell'
    });
  });

  it('classifies a mod_info.json object and returns its mod id', () => {
    const result = readModFile({ id: 'starlords', name: 'Star Lords', version: { major: 0, minor: 3, patch: 72 } });
    assert.deepEqual(result, { kind: 'modinfo', id: 'starlords', modName: 'Star Lords' });
  });

  it('returns null for an object that is neither', () => {
    assert.equal(readModFile({ description: 'nothing useful' }), null);
    assert.equal(readModFile(null), null);
  });
});

describe('formatVersion (client mirror)', () => {
  it('strips trailing zero patch', () => {
    assert.equal(formatVersion({ major: '2', minor: '1', patch: '0' }), '2.1');
  });
  it('strips trailing zero minor and patch', () => {
    assert.equal(formatVersion({ major: '4', minor: '0', patch: '0' }), '4');
  });
  it('keeps a non-zero patch', () => {
    assert.equal(formatVersion({ major: '1', minor: '5', patch: '6' }), '1.5.6');
  });
  it('appends a non-numeric patch without a dot', () => {
    assert.equal(formatVersion({ major: '2', minor: '0', patch: 'b' }), '2.0b');
  });
});

describe('toRawGithubURL', () => {
  it('rewrites a github.com blob URL to raw.githubusercontent.com', () => {
    assert.equal(
      toRawGithubURL('https://github.com/SirHartley/Corrupt.Officials/blob/master/corruptofficials.version'),
      'https://raw.githubusercontent.com/SirHartley/Corrupt.Officials/master/corruptofficials.version'
    );
  });
  it('rewrites a github.com raw URL to raw.githubusercontent.com', () => {
    assert.equal(
      toRawGithubURL('https://github.com/owner/repo/raw/main/path/Mod.version'),
      'https://raw.githubusercontent.com/owner/repo/main/path/Mod.version'
    );
  });
  it('strips a ?raw=true query and fragments from a blob URL', () => {
    assert.equal(
      toRawGithubURL('https://github.com/owner/repo/blob/main/Mod.version?raw=true#L1'),
      'https://raw.githubusercontent.com/owner/repo/main/Mod.version'
    );
  });
  it('leaves an already-raw URL unchanged', () => {
    const url = 'https://raw.githubusercontent.com/owner/repo/master/Mod.version';
    assert.equal(toRawGithubURL(url), url);
  });
  it('leaves a non-github URL unchanged', () => {
    const url = 'https://example.com/mods/Mod.zip';
    assert.equal(toRawGithubURL(url), url);
  });
  it('returns non-string input unchanged', () => {
    assert.equal(toRawGithubURL(null), null);
  });
});
