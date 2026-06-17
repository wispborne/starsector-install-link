const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  entryToParam,
  parseEntry,
  buildSchemeTarget,
  isVersionFile,
  filenameFromURL,
  normalizeVersionData,
  formatVersion
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
