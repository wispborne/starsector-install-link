/*
 * Launcher page logic. Reads its own query string, reconstructs the
 * starsector-mod:// scheme, and fires it — with a click-to-launch button and a
 * graceful fallback. All client-side; no backend.
 */
(function () {
  'use strict';

  var els = {
    icon: document.getElementById('launcher-icon'),
    title: document.getElementById('launcher-title'),
    subtitle: document.getElementById('launcher-subtitle'),
    launchBtn: document.getElementById('launch-btn'),
    malformed: document.getElementById('malformed'),
    fallback: document.getElementById('fallback'),
    downloadLink: document.getElementById('download-link'),
    downloadText: document.getElementById('download-text'),
    depFallback: document.getElementById('dep-fallback'),
    depLinks: document.getElementById('dep-links')
  };

  function hostnameOf(url) {
    try { return new URL(url).hostname; } catch (e) { return null; }
  }

  // A .version file isn't a download — it's the small metadata file mod managers
  // read. When we couldn't resolve it to a real archive URL, a manual link still
  // points at the .version itself. Drop a short note right under that link so a
  // visitor without TriOS knows what it is, plus an info icon whose tooltip
  // explains *why* TriLink couldn't get the direct link: corsBlocked true means
  // the host's cross-origin policy blocked the read; false means the file simply
  // lists no directDownloadURL. No-op if a note is already there.
  function noteVersionFile(linkEl, sourceUrl, corsBlocked) {
    var next = linkEl.nextElementSibling;
    if (next && next.classList.contains('fallback-note')) return;

    var note = document.createElement('p');
    note.className = 'fallback-note';
    note.innerHTML = '<code>.version</code> file — open or save it to find the download link inside.';

    var host = hostnameOf(sourceUrl);
    var why = corsBlocked
      ? ('TriLink can’t read the download link from ' + (host || 'this host') +
         ' directly. Its cross-origin (CORS) policy blocks reading the file in a browser. The link is still inside the file.')
      : 'This .version file doesn’t list a directDownloadURL, so TriLink has no direct download to link to.';

    var tip = document.createElement('span');
    tip.className = 'info-tip';
    tip.tabIndex = 0;
    tip.setAttribute('role', 'button');
    tip.setAttribute('aria-label', why);
    tip.innerHTML = '<span class="material-icons">info</span>' +
      '<span class="info-tip-bubble"><span class="tip-line">' +
      '<span class="material-icons">info</span><span class="tip-text"></span>' +
      '</span></span>';
    // Set the message as text (not HTML) so the hostname can't inject markup.
    tip.querySelector('.tip-text').textContent = why;

    note.appendChild(document.createTextNode(' '));
    note.appendChild(tip);
    linkEl.insertAdjacentElement('afterend', note);
  }

  var query = new URLSearchParams(window.location.search);
  // Normalize GitHub blob URLs to raw here too: older buttons were generated
  // before install.js did this, so their query params still carry the blob URL
  // that neither TriOS nor the .version fetch can read.
  var mod = normalizeEntry(Deeplink.parseEntry(query.get('mod')));
  var deps = query.getAll('dep').map(Deeplink.parseEntry).filter(Boolean).map(normalizeEntry);
  var target = Deeplink.buildSchemeTarget(mod, deps);

  function normalizeEntry(entry) {
    if (entry) entry.url = Deeplink.toRawGithubURL(entry.url);
    return entry;
  }

  // Malformed link (no mod): show a clear message and stop.
  if (!target) {
    els.title.textContent = 'Malformed install link';
    els.icon.innerHTML = '<span class="material-icons">error_outline</span>';
    els.malformed.hidden = false;
    return;
  }

  // Wire the button — the reliable path. A click here is a genuine user gesture,
  // which browsers honor even though this page opened in a new tab.
  els.launchBtn.href = target;
  els.launchBtn.hidden = false;
  els.launchBtn.addEventListener('click', function (e) {
    e.preventDefault();
    fireScheme();
  });

  // Subtitle reflects how many things will be installed.
  if (deps.length === 1) {
    els.subtitle.textContent = 'Installing 1 mod and 1 dependency.';
  } else if (deps.length > 1) {
    els.subtitle.textContent = 'Installing 1 mod and ' + deps.length + ' dependencies.';
  }

  // Best-effort launch detection: if the page loses focus/visibility shortly
  // after we fire the scheme, the OS handler almost certainly took over.
  var launched = false;
  function markLaunched() { launched = true; }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) markLaunched();
  });
  window.addEventListener('blur', markLaunched);
  window.addEventListener('pagehide', markLaunched);

  // Fire via a hidden iframe so a missing handler doesn't navigate this page away.
  function fireScheme() {
    var frame = document.createElement('iframe');
    frame.style.display = 'none';
    document.body.appendChild(frame);
    try {
      frame.contentWindow.location.href = target;
    } catch (err) {
      // Some browsers throw on an unknown scheme in an iframe; fall back to top.
      window.location.href = target;
    }
    window.setTimeout(function () {
      if (launched) {
        showLaunchedState();
      } else {
        els.fallback.hidden = false;
      }
    }, 1500);
  }

  function showLaunchedState() {
    // Keep the TriOS logo showing; only the copy changes.
    els.title.textContent = 'Sent to TriOS';
    els.subtitle.textContent = 'You can close this tab.';
    // Still reveal the fallback quietly in case nothing actually opened.
    els.fallback.hidden = false;
  }

  // Cosmetic enrichment (best effort, never blocks the launch above).
  function enrich() {
    if (Deeplink.isVersionFile(mod.url)) {
      els.subtitle.textContent = els.subtitle.textContent || 'Resolving version file…';
      Deeplink.resolveVersion(mod.url).then(function (result) {
        if (result && result.data) {
          var d = result.data;
          var version = Deeplink.formatVersion(d.modVersion);
          els.title.textContent = 'Install ' + d.modName + (version ? ' v' + version : '');
          if (d.directDownloadURL) {
            setDownload(d.directDownloadURL);
            return;
          }
        }
        // Couldn't resolve a direct download (host blocked the read, or the file
        // has no directDownloadURL). Offer the .version link itself, explained —
        // launch is unaffected either way.
        setDownload(mod.url);
        noteVersionFile(els.downloadLink, mod.url, !(result && result.data));
      });
    } else {
      // Direct archive: the mod URL itself is the download fallback.
      setDownload(mod.url);
    }
  }

  function setDownload(url) {
    els.downloadLink.href = url;
    els.downloadLink.hidden = false;
    var name = Deeplink.filenameFromURL(url);
    els.downloadText.textContent = name ? name : 'Download the mod directly';
  }

  // For each dependency, add a fallback download link so a manual installer
  // isn't left missing required mods. Each row is enriched best-effort.
  function setupDependencyFallback() {
    if (!deps.length) return;
    els.depFallback.hidden = false;

    deps.forEach(function (dep) {
      var depUrl = dep.url;
      // Wrap link + its note so the note pairs tightly with this dep (the
      // .dep-links flex gap separates items, not a link from its own note).
      var item = document.createElement('div');
      item.className = 'dep-item';
      var a = document.createElement('a');
      a.className = 'fallback-link dep-link';
      a.target = '_blank';
      a.rel = 'noopener';
      a.innerHTML = '<span class="material-icons">archive</span> <span class="dep-link-text"></span>';
      var textEl = a.querySelector('.dep-link-text');
      item.appendChild(a);

      if (Deeplink.isVersionFile(depUrl)) {
        a.href = depUrl;
        textEl.textContent = 'Resolving dependency…';
        Deeplink.resolveVersion(depUrl).then(function (result) {
          if (result && result.data) {
            var d = result.data;
            var v = Deeplink.formatVersion(d.modVersion);
            textEl.textContent = d.modName + (v ? ' v' + v : '');
            // Link straight to the mod download, not the .version file.
            if (d.directDownloadURL) { a.href = d.directDownloadURL; return; }
          } else {
            // CORS/parse failure: fall back to the raw URL.
            textEl.textContent = Deeplink.filenameFromURL(depUrl);
          }
          // Still pointing at the .version file — explain it under this link.
          noteVersionFile(a, depUrl, !(result && result.data));
        });
      } else {
        a.href = depUrl;
        textEl.textContent = Deeplink.filenameFromURL(depUrl);
      }

      els.depLinks.appendChild(item);
    });
  }

  enrich();
  setupDependencyFallback();

  // Auto-attempt the launch on load (best effort). The button remains the
  // reliable path if the browser suppresses this gesture-less attempt.
  fireScheme();
})();
