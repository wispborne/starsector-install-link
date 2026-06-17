/*
 * Install-with-TriOS link generator (fully client-side).
 * Builds a forum-safe link to open.html that relays a starsector-mod:// install
 * intent to TriOS. Depends on deeplink.js (Deeplink global) and the vendored
 * Hjson parser.
 */

const installImportInput = document.getElementById('install-import');
const installImportBtn = document.getElementById('install-import-btn');
const installImportMsg = document.getElementById('install-import-msg');
const installModInput = document.getElementById('install-mod');
const installModIdInput = document.getElementById('install-mod-id');
const installModPreview = document.getElementById('install-mod-preview');
const installDepsEl = document.getElementById('install-deps');
const addDepBtn = document.getElementById('add-dep-btn');
const installSwatches = document.getElementById('install-swatches');
const installBadgePreview = document.getElementById('install-badge-preview');
const installText = document.getElementById('install-text');
const copyInstallBtn = document.getElementById('copy-install');

let installBadgeFile = 'install-badge.svg';
let installDebounce = null;

function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const origHTML = btn.innerHTML;
    btn.innerHTML = '<span class="material-icons">check</span> Copied!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.innerHTML = origHTML;
      btn.classList.remove('copied');
    }, 2000);
  });
}

// Base directory of the deployed static site (works on localhost and on a
// GitHub Pages subpath). Trailing slash included.
function staticBase() {
  return new URL('.', window.location.href).href;
}

// Collect dependency rows as entries { url, id }, skipping rows with no URL.
function depEntries() {
  return Array.from(installDepsEl.querySelectorAll('.install-dep-row')).map(row => {
    const url = row.querySelector('.dep-url').value.trim();
    const id = row.querySelector('.dep-id').value.trim();
    return url ? { url, id: id || null } : null;
  }).filter(Boolean);
}

function buildOpenUrl(modEntry, deps) {
  return staticBase() + 'open.html?' + Deeplink.buildParams(modEntry, deps).toString();
}

function formatOutput(openUrl, badgeImg) {
  const fmt = document.querySelector('input[name="install-format"]:checked')?.value || 'bbcode';
  switch (fmt) {
    case 'bbcode-text': return `[url=${openUrl}]Install with TriOS[/url]`;
    case 'raw': return openUrl;
    case 'html': return `<a href="${openUrl}"><img src="${badgeImg}" alt="Install with TriOS"></a>`;
    case 'bbcode':
    default: return `[url=${openUrl}][img]${badgeImg}[/img][/url]`;
  }
}

function updateInstallOutput() {
  const modUrl = installModInput.value.trim();
  const badgeImg = staticBase() + installBadgeFile;

  // Always refresh the badge preview image.
  installBadgePreview.innerHTML = '';
  const img = document.createElement('img');
  img.src = badgeImg;
  img.alt = 'install badge preview';
  installBadgePreview.appendChild(img);

  if (!modUrl) {
    installText.value = '';
    copyInstallBtn.disabled = true;
    return;
  }

  const modEntry = { url: modUrl, id: installModIdInput.value.trim() || null };
  const openUrl = buildOpenUrl(modEntry, depEntries());
  installText.value = formatOutput(openUrl, badgeImg);
  copyInstallBtn.disabled = false;

  // Make the preview badge a live link to the generated launcher.
  installBadgePreview.innerHTML = '';
  const link = document.createElement('a');
  link.href = openUrl;
  link.target = '_blank';
  link.rel = 'noopener';
  link.appendChild(img);
  installBadgePreview.appendChild(link);
}

// Best-effort client-side resolution preview for a .version URL.
function previewVersion(url, targetEl) {
  if (!url) { targetEl.textContent = ''; targetEl.className = 'install-preview'; return; }
  if (!Deeplink.isVersionFile(url)) {
    targetEl.textContent = 'Direct download: ' + Deeplink.filenameFromURL(url);
    targetEl.className = 'install-preview neutral';
    return;
  }
  targetEl.textContent = 'Resolving…';
  targetEl.className = 'install-preview neutral';
  Deeplink.resolveVersion(url).then(result => {
    // Ignore stale responses if the field changed meanwhile.
    if (targetEl.dataset.url !== url) return;
    if (result && result.data) {
      const v = Deeplink.formatVersion(result.data.modVersion);
      targetEl.textContent = '✓ ' + result.data.modName + (v ? ' v' + v : '');
      targetEl.className = 'install-preview ok';
    } else {
      targetEl.textContent = "Couldn't preview (host may block cross-origin reads) — the link still works.";
      targetEl.className = 'install-preview warn';
    }
  });
}

function scheduleInstallUpdate() {
  updateInstallOutput();
  clearTimeout(installDebounce);
  installDebounce = setTimeout(() => {
    installModPreview.dataset.url = installModInput.value.trim();
    previewVersion(installModInput.value.trim(), installModPreview);
    installDepsEl.querySelectorAll('.install-dep-row').forEach(row => {
      const input = row.querySelector('.dep-url');
      const prev = row.querySelector('.install-preview');
      prev.dataset.url = input.value.trim();
      previewVersion(input.value.trim(), prev);
    });
  }, 400);
}

// Wrap an input in a Material floating-label field. The label names the field;
// the placeholder example shows on focus.
let mdSeq = 0;
function mdField(input, labelText) {
  const wrap = document.createElement('div');
  wrap.className = 'md-field';
  if (!input.id) input.id = 'md-' + (++mdSeq);
  const label = document.createElement('label');
  label.setAttribute('for', input.id);
  label.textContent = labelText;
  wrap.append(input, label);
  return wrap;
}

function addDepRow(url, id, focusInput) {
  const row = document.createElement('div');
  row.className = 'install-card install-dep-row';

  const input = document.createElement('input');
  input.type = 'url';
  input.className = 'dep-url';
  input.placeholder = 'https://.../dependency.version';
  input.autocomplete = 'off';
  if (url) input.value = url;
  input.addEventListener('input', scheduleInstallUpdate);

  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn-remove-dep';
  removeBtn.innerHTML = '<span class="material-icons">close</span>';
  removeBtn.title = 'Remove dependency';
  removeBtn.addEventListener('click', () => {
    row.remove();
    scheduleInstallUpdate();
  });

  const idInput = document.createElement('input');
  idInput.type = 'text';
  idInput.className = 'dep-id';
  idInput.placeholder = 'e.g. lw_lazylib';
  idInput.autocomplete = 'off';
  if (id) idInput.value = id;
  idInput.addEventListener('input', updateInstallOutput);

  const preview = document.createElement('p');
  preview.className = 'install-preview';

  const top = document.createElement('div');
  top.className = 'install-dep-top';
  top.append(mdField(input, 'Link to .version file (or .zip)'), removeBtn);
  // Resolved mod name sits at the top, labeling this dependency's field group.
  row.append(preview, top, mdField(idInput, 'Mod ID (optional)'));
  installDepsEl.appendChild(row);
  if (focusInput !== false) input.focus();
}

// Reverse builder: pull mod/dep params out of a pasted link or BBCode and
// populate the form. Accepts open.html?… URLs, raw starsector-mod://… URLs,
// [url=…] BBCode, or a bare query string.
function extractParams(text) {
  let s = (text || '').trim();
  const bb = s.match(/\[url=([^\]]+)\]/i); // unwrap BBCode [url=…]
  if (bb) s = bb[1];
  const q = s.indexOf('?');
  if (q >= 0) s = s.slice(q + 1);
  s = s.split('[')[0].trim(); // drop any trailing markup like [/url]
  return new URLSearchParams(s);
}

function loadFromLink() {
  const params = extractParams(installImportInput.value);
  const modEntry = Deeplink.parseEntry(params.get('mod'));
  if (!modEntry) {
    installImportMsg.textContent = "Couldn't find a mod in that link.";
    installImportMsg.className = 'status-msg error';
    return;
  }
  const deps = params.getAll('dep').map(Deeplink.parseEntry).filter(Boolean);

  installModInput.value = modEntry.url;
  installModIdInput.value = modEntry.id || '';
  installDepsEl.innerHTML = '';
  deps.forEach(d => addDepRow(d.url, d.id || '', false));

  scheduleInstallUpdate();
  installImportMsg.textContent = `Loaded mod${deps.length ? ` + ${deps.length} ${deps.length === 1 ? 'dependency' : 'dependencies'}` : ''}.`;
  installImportMsg.className = 'status-msg success';
}

installImportBtn.addEventListener('click', loadFromLink);
installImportInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); loadFromLink(); }
});
installModInput.addEventListener('input', scheduleInstallUpdate);
installModIdInput.addEventListener('input', updateInstallOutput);
addDepBtn.addEventListener('click', () => addDepRow(''));

// Badge color picker is currently disabled (see install.html); guard so the
// rest of the generator still works. installBadgeFile stays at its default.
if (installSwatches) {
  installSwatches.querySelectorAll('.swatch').forEach(btn => {
    btn.addEventListener('click', () => {
      installSwatches.querySelector('.swatch.selected')?.classList.remove('selected');
      btn.classList.add('selected');
      installBadgeFile = btn.dataset.file;
      updateInstallOutput();
    });
  });
}

document.querySelectorAll('input[name="install-format"]').forEach(radio => {
  radio.addEventListener('change', updateInstallOutput);
});

copyInstallBtn.addEventListener('click', () => copyToClipboard(installText.value, copyInstallBtn));

updateInstallOutput();
