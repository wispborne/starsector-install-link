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

  var query = new URLSearchParams(window.location.search);
  var mod = Deeplink.parseEntry(query.get('mod'));
  var deps = query.getAll('dep').map(Deeplink.parseEntry).filter(Boolean);
  var target = Deeplink.buildSchemeTarget(mod, deps);

  // Malformed link (no mod): show a clear message and stop.
  if (!target) {
    els.title.textContent = 'Malformed install link';
    els.icon.textContent = 'error_outline';
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
    els.icon.textContent = 'check_circle';
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
          }
        }
        // On error (incl. CORS) we simply keep the generic UI — launch is unaffected.
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
    els.downloadText.textContent = name ? 'Download ' + name : 'Download the mod directly';
  }

  // For each dependency, add a fallback download link so a manual installer
  // isn't left missing required mods. Each row is enriched best-effort.
  function setupDependencyFallback() {
    if (!deps.length) return;
    els.depFallback.hidden = false;

    deps.forEach(function (dep) {
      var depUrl = dep.url;
      var a = document.createElement('a');
      a.className = 'fallback-link dep-link';
      a.target = '_blank';
      a.rel = 'noopener';
      a.innerHTML = '<span class="material-icons">extension</span> <span class="dep-link-text"></span>';
      var textEl = a.querySelector('.dep-link-text');

      if (Deeplink.isVersionFile(depUrl)) {
        a.href = depUrl;
        textEl.textContent = 'Resolving dependency…';
        Deeplink.resolveVersion(depUrl).then(function (result) {
          if (result && result.data) {
            var d = result.data;
            var v = Deeplink.formatVersion(d.modVersion);
            var label = d.modName + (v ? ' v' + v : '');
            if (d.directDownloadURL) {
              a.href = d.directDownloadURL;
              textEl.textContent = 'Download ' + label;
            } else {
              textEl.textContent = label + ' (open .version)';
            }
          } else {
            // CORS/parse failure: fall back to the raw URL.
            textEl.textContent = 'Download ' + Deeplink.filenameFromURL(depUrl);
          }
        });
      } else {
        a.href = depUrl;
        textEl.textContent = 'Download ' + Deeplink.filenameFromURL(depUrl);
      }

      els.depLinks.appendChild(a);
    });
  }

  enrich();
  setupDependencyFallback();

  // Auto-attempt the launch on load (best effort). The button remains the
  // reliable path if the browser suppresses this gesture-less attempt.
  fireScheme();
})();
