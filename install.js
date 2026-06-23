/*
 * TriLink — install-link generator (fully client-side).
 * Builds a forum-safe link to open.html that relays a starsector-mod:// install
 * intent to TriOS. Depends on deeplink.js (Deeplink global) and the vendored
 * Hjson parser.
 */

const installImportInput = document.getElementById('install-import');
const installImportBtn = document.getElementById('install-import-btn');
const installImportMsg = document.getElementById('install-import-msg');
const installModInput = document.getElementById('install-mod');
const installModIdInput = document.getElementById('install-mod-id');
const installModVersionInput = document.getElementById('install-mod-version');
const installModPreview = document.getElementById('install-mod-preview');
const installDepsEl = document.getElementById('install-deps');
const addDepBtn = document.getElementById('add-dep-btn');
const depAddDropzone = document.getElementById('dep-add-dropzone');
const depAddFileInput = document.getElementById('dep-add-file-input');
const installSwatches = document.getElementById('install-swatches');
const installLabelColors = document.getElementById('install-label-colors');
const installStyles = document.getElementById('install-styles');
const installBadgePreview = document.getElementById('install-badge-preview');
const installText = document.getElementById('install-text');
const copyInstallBtn = document.getElementById('copy-install');
const versionDropzone = document.getElementById('version-dropzone');
const versionFileInput = document.getElementById('version-file-input');
const versionDropMsg = document.getElementById('version-drop-msg');

let installBadgeFile = 'badges/install-badge.svg';
let installDebounce = null;

// Version-field provenance. A version we wrote ourselves (resolved from a
// .version link, read from a dropped file, or loaded from a pasted install
// link) is marked auto-filled so a newer resolution may replace it; the moment
// the user types in the field they own it, and we never clobber it. Setting
// `.value` programmatically doesn't fire 'input', so the user-owned flag only
// clears on real edits.
function setAutoVersion(input, value) {
  if (!input) return;
  input.value = value;
  input.dataset.versionAuto = '1';
}

// True when the field is safe to overwrite: empty, or only ever auto-filled.
function versionReplaceable(input) {
  return !!input && (!input.value.trim() || input.dataset.versionAuto === '1');
}

// Clear the auto-filled flag whenever the user edits the field by hand.
function trackVersionEdits(input) {
  input.addEventListener('input', () => { delete input.dataset.versionAuto; });
}

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

// Collect dependency rows as entries { url, id, version }, skipping rows with no
// URL. A dependency's version is only carried when the author ticks "Require this
// version or newer" — it's the dependency's MINIMUM required version, not an
// install target, so it's opt-in. Unchecked (the default) sends no version, and
// TriOS installs the dependency only when it's missing entirely.
function depEntries() {
  return Array.from(installDepsEl.querySelectorAll('.install-dep-row')).map(row => {
    const url = Deeplink.toRawGithubURL(row.querySelector('.dep-url').value.trim());
    const id = row.querySelector('.dep-id').value.trim();
    const version = row.querySelector('.dep-version').value.trim();
    const requireMin = row.querySelector('.dep-version-min').checked;
    return url ? { url, id: id || null, version: requireMin && version ? version : null } : null;
  }).filter(Boolean);
}

function buildOpenUrl(modEntry, deps) {
  return staticBase() + 'open.html?' + Deeplink.buildParams(modEntry, deps).toString();
}

// The URL and the mod ID are required on each dependency; the version is
// optional (it rides along only when the author opts into a minimum). A row that
// has some but not all required fields is incomplete, so flag it and report the
// form invalid; a fully blank row is fine (it's skipped). Returns true when every
// row is complete.
function validateDeps() {
  let valid = true;
  installDepsEl.querySelectorAll('.install-dep-row').forEach(row => {
    const url = row.querySelector('.dep-url').value.trim();
    const id = row.querySelector('.dep-id').value.trim();
    const version = row.querySelector('.dep-version').value.trim();
    const err = row.querySelector('.dep-error');
    if (!url && !id && !version) {
      setStatus(err, ''); // fully blank row: skipped, not an error
    } else if (!url) {
      valid = false;
      setStatus(err, 'Add this dependency’s .version or .zip link.', 'error');
    } else if (!id) {
      valid = false;
      setStatus(err, 'Add this dependency’s mod ID.', 'error');
    } else {
      setStatus(err, '');
    }
  });
  return valid;
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
  const modId = installModIdInput.value.trim();
  const modVersion = installModVersionInput.value.trim();
  const badgeImg = staticBase() + installBadgeFile;

  // Always refresh the badge preview image.
  installBadgePreview.innerHTML = '';
  const img = document.createElement('img');
  img.src = badgeImg;
  img.alt = 'install badge preview';
  installBadgePreview.appendChild(img);

  // The mod URL and mod ID are required, and every dependency must be complete;
  // otherwise block output so we never emit a link that silently drops a
  // dependency. The mod version is optional — when present it's carried so TriOS
  // can skip the mod if the installed copy is already that version or newer.
  const depsValid = validateDeps();
  if (!modUrl || !modId || !depsValid) {
    installText.value = '';
    copyInstallBtn.disabled = true;
    return;
  }

  const modEntry = { url: Deeplink.toRawGithubURL(modUrl), id: modId, version: modVersion || null };
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

// Best-effort client-side resolution preview for a .version URL. When the file
// resolves and `versionInput` is still empty, its version is filled in — a .zip
// link can't be resolved this way, so that field stays for the user to type.
function previewVersion(url, targetEl, versionInput) {
  if (!url) { targetEl.textContent = ''; targetEl.className = 'install-preview'; return; }
  if (!Deeplink.isVersionFile(url)) {
    targetEl.textContent = Deeplink.filenameFromURL(url);
    targetEl.className = 'install-preview ok';
    return;
  }
  targetEl.textContent = 'Resolving…';
  targetEl.className = 'install-preview neutral';
  Deeplink.resolveVersion(url).then(result => {
    // Ignore stale responses if the field changed meanwhile.
    if (targetEl.dataset.url !== url) return;
    if (result && result.data) {
      const v = Deeplink.formatVersion(result.data.modVersion);
      if (v && versionReplaceable(versionInput)) {
        setAutoVersion(versionInput, v);
        updateInstallOutput();
      }
      const label = result.data.modName + (v ? ' v' + v : '');
      if (!result.data.directDownloadURL) {
        // Resolved fine but has no directDownloadURL — the one-click install has
        // nothing to download, so warn instead of showing a green check.
        targetEl.textContent = '⚠ ' + label + ' has no directDownloadURL — one-click install won’t work.';
        targetEl.className = 'install-preview warn';
      } else {
        targetEl.textContent = label;
        targetEl.className = 'install-preview ok';
      }
    } else {
      // Couldn't fetch the .version (cross-origin block) — the link still works,
      // so present it as a success; we just can't show the resolved mod name.
      targetEl.className = 'install-preview ok';
      targetEl.textContent = '';
      const title = document.createElement('span');
      title.className = 'preview-title';
      title.textContent = '✓ ' + (targetEl === installModPreview ? 'Mod added' : 'Dependency added');
      const sub = document.createElement('span');
      sub.className = 'preview-sub';
      sub.textContent = '(unable to show name due to XSS)';
      targetEl.append(title, sub);
    }
  });
}

function scheduleInstallUpdate() {
  updateInstallOutput();
  clearTimeout(installDebounce);
  installDebounce = setTimeout(() => {
    installModPreview.dataset.url = installModInput.value.trim();
    previewVersion(installModInput.value.trim(), installModPreview, installModVersionInput);
    installDepsEl.querySelectorAll('.install-dep-row').forEach(row => {
      const input = row.querySelector('.dep-url');
      const prev = row.querySelector('.install-preview');
      prev.dataset.url = input.value.trim();
      previewVersion(input.value.trim(), prev, row.querySelector('.dep-version'));
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

function addDepRow(url, id, version, focusInput, requireMin) {
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

  const versionInput = document.createElement('input');
  versionInput.type = 'text';
  versionInput.className = 'dep-version';
  versionInput.placeholder = 'e.g. 1.2.3';
  versionInput.autocomplete = 'off';
  if (version) setAutoVersion(versionInput, version);
  versionInput.addEventListener('input', updateInstallOutput);
  trackVersionEdits(versionInput);

  // The version is autofilled for convenience but only sent when this is ticked —
  // it's the dependency's MINIMUM required version, so it's opt-in (off by
  // default). Unchecked, the dependency installs only when it's missing entirely.
  const minCheck = document.createElement('input');
  minCheck.type = 'checkbox';
  minCheck.className = 'dep-version-min';
  minCheck.id = 'dep-min-' + (++mdSeq);
  minCheck.checked = !!requireMin;
  // The field is editable only while the minimum is required; autofill still
  // writes to it when disabled (setting .value works regardless), so a dropped
  // file fills it in ready for when the box is ticked.
  versionInput.disabled = !minCheck.checked;
  minCheck.addEventListener('change', () => {
    versionInput.disabled = !minCheck.checked;
    updateInstallOutput();
  });
  const minLabel = document.createElement('label');
  minLabel.setAttribute('for', minCheck.id);
  minLabel.textContent = 'Require this version or newer';
  const minRow = document.createElement('div');
  minRow.className = 'dep-version-min-row';
  minRow.append(minCheck, minLabel);

  const preview = document.createElement('p');
  preview.className = 'install-preview';

  const depError = document.createElement('p');
  depError.className = 'status-msg dep-error';

  const top = document.createElement('div');
  top.className = 'install-dep-top';
  top.append(mdField(input, 'Link to .version file or .zip'), removeBtn);

  // Compact drop zone: a .version fills this dep's URL, a mod_info.json its ID.
  const dropInput = document.createElement('input');
  dropInput.type = 'file';
  dropInput.accept = '.version,.json,application/json,text/plain';
  dropInput.hidden = true;

  const dropZone = document.createElement('div');
  dropZone.className = 'version-dropzone compact';
  dropZone.tabIndex = 0;
  dropZone.setAttribute('role', 'button');
  dropZone.setAttribute('aria-label', 'Drop a .version or mod_info.json file here for this dependency');
  dropZone.innerHTML = '<span class="material-icons">upload_file</span>'
    + '<span class="version-dropzone-text"><span class="version-dropzone-sub">'
    + 'Drop a <code>.version</code> or <code>mod_info.json</code> file</span></span>';
  dropZone.appendChild(dropInput);

  const dropMsg = document.createElement('p');
  dropMsg.className = 'status-msg drop-status';

  const depTargets = () => ({ urlInput: input, idInput: idInput, versionInput: versionInput, msg: dropMsg });
  wireBrowse(dropZone, dropInput, depTargets);
  // The whole dependency card is the drop target; the inner zone is just browse.
  wireDropTarget(row, depTargets);

  // Mod ID and version sit side by side beneath the link field.
  const idVersionRow = document.createElement('div');
  idVersionRow.className = 'input-row';
  idVersionRow.append(mdField(idInput, 'Mod ID'), mdField(versionInput, 'Version'));

  // Resolved mod name sits at the top, labeling this dependency's field group.
  row.append(preview, top, depError, idVersionRow, minRow, dropZone, dropMsg);
  installDepsEl.appendChild(row);
  if (focusInput !== false) input.focus();
  return row;
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
  setAutoVersion(installModVersionInput, modEntry.version || '');
  installDepsEl.innerHTML = '';
  // A dep version in the link means the author opted into a minimum, so re-tick
  // the checkbox to round-trip faithfully.
  deps.forEach(d => addDepRow(d.url, d.id || '', d.version || '', false, !!d.version));

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
installModVersionInput.addEventListener('input', updateInstallOutput);
trackVersionEdits(installModVersionInput);
addDepBtn.addEventListener('click', () => addDepRow('', '', ''));

// --- mod file drop / browse --------------------------------------------------
// A dropped (or browsed) mod file is parsed with Hjson — neither .version nor
// mod_info.json is strict JSON (they carry comments, trailing commas, single
// quotes) — then routed by type: a .version fills the URL field with its remote
// link (masterVersionFile preferred over directDownloadURL); a mod_info.json
// fills the Mod ID field with its id. The main mod and every dependency row each
// get a drop zone wired the same way.

// Set a status line. `el` is a .status-msg element. Only the error/success state
// is toggled — marker classes like drop-status / dep-error (which drive the
// collapse-when-empty rule and row lookups) are preserved.
function setStatus(el, text, cls) {
  if (!el) return;
  el.textContent = text || '';
  el.classList.remove('error', 'success');
  if (cls) el.classList.add(cls);
}

// Parse one dropped/browsed file and fill the given { urlInput, idInput } targets.
function processModFile(file, targets) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let parsed = null;
    try { parsed = Hjson.parse(String(reader.result)); } catch (e) { parsed = null; }
    const result = parsed && Deeplink.readModFile(parsed);
    if (!result) {
      setStatus(targets.msg, `Couldn't read a link or mod ID from ${file.name}.`, 'error');
      return;
    }
    if (result.kind === 'version' && targets.urlInput) {
      // A one-click install needs a directDownloadURL *somewhere*. We store the
      // remote link (masterVersionFile, preferred), so the download link can live
      // either in this dropped file or in the remote .version it points at. Fill
      // the fields and version (optional — a dependency only sends it when the
      // minimum box is ticked); the key is matched case-insensitively.
      const accept = () => {
        targets.urlInput.value = result.url;
        if (result.version) setAutoVersion(targets.versionInput, result.version);
        setStatus(targets.msg, ''); // clear any prior message; success is silent
        scheduleInstallUpdate();
      };

      if (Deeplink.getDirectDownloadURL(parsed)) {
        accept(); // dropped file has one — no need to hit the network
        return;
      }

      // No directDownloadURL in the dropped file. result.url is its
      // masterVersionFile pointer, so resolve that remote .version and check
      // there before deciding — a file may legitimately defer its download link
      // to its master.
      setStatus(targets.msg, 'Checking the remote .version…');
      Deeplink.resolveVersion(result.url).then(res => {
        if (res && res.data && res.data.directDownloadURL) {
          accept(); // the remote supplies the download link
        } else if (res && res.data) {
          // Reached the remote, but it has no directDownloadURL either. The fix
          // differs by role: a mod author can add one to their own .version, but
          // a dependency is usually someone else's mod, so point them at using a
          // direct download link for it instead.
          const isDep = targets.urlInput !== installModInput;
          const fix = isDep
            ? 'Use a direct download link instead of a .version file.'
            : 'Add one to your .version file.';
          setStatus(targets.msg, `.version file has no directDownloadURL, so TriOS won't be able to download the mod. ${fix}`, 'error');
        } else {
          // Couldn't reach the remote (network/CORS). Can't verify, so don't
          // block — the link may still resolve in TriOS — but say so.
          accept();
          setStatus(targets.msg, `Added, but couldn't verify a download link — the remote .version wasn't reachable from your browser. It'll work if the remote has one.`);
        }
      });
      return;
    } else if (result.kind === 'modinfo' && targets.idInput) {
      targets.idInput.value = result.id;
      // mod_info.json carries the version too — fill it so the user needn't retype.
      if (result.version) setAutoVersion(targets.versionInput, result.version);
      setStatus(targets.msg, ''); // clear any prior error; success is silent
      // If this mod_info declares dependencies and the user hasn't started a
      // dependency list yet, seed a row per dependency with its mod id (and
      // version, when the file lists one) prefilled.
      const deps = Deeplink.extractDependencies(parsed);
      if (deps.length && installDepsEl.querySelectorAll('.install-dep-row').length === 0) {
        deps.forEach(dep => addDepRow('', dep.id, dep.version || '', false));
      }
    } else {
      setStatus(targets.msg, `That file didn't have what this field needs.`, 'error');
      return;
    }
    scheduleInstallUpdate();
  };
  reader.onerror = () => setStatus(targets.msg, `Couldn't read ${file.name}.`, 'error');
  reader.readAsText(file);
}

// Make an element a file drop target: highlight while a file is dragged over it
// and route the dropped file through processModFile. A dragenter/dragleave depth
// counter keeps the highlight steady as the pointer crosses child elements — a
// large target like a whole section would otherwise flicker. stopPropagation lets
// targets nest: a drop (and its drag highlight) on a dependency card inside the
// Dependencies section is handled by the card alone and never reaches the
// section. Because each target stops its own drag events, every ancestor's
// counter stays balanced and only the innermost target under the pointer lights.
function wireDropTarget(el, getTargets) {
  if (!el) return;
  let depth = 0;
  el.addEventListener('dragenter', (e) => {
    e.preventDefault();
    e.stopPropagation();
    depth++;
    el.classList.add('dragover');
  });
  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  });
  el.addEventListener('dragleave', (e) => {
    e.stopPropagation();
    depth = Math.max(0, depth - 1);
    if (depth === 0) el.classList.remove('dragover');
  });
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    depth = 0;
    el.classList.remove('dragover');
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) processModFile(file, getTargets());
  });
}

// Wire a zone's browse affordance: click or keyboard opens its file input, and
// picking a file feeds processModFile. Dropping is handled separately by the
// surrounding drop target (wireDropTarget). `getTargets` is called lazily so dep
// rows resolve their current inputs at use time.
function wireBrowse(zoneEl, fileInputEl, getTargets) {
  if (!zoneEl) return;
  const open = () => fileInputEl && fileInputEl.click();
  zoneEl.addEventListener('click', open);
  zoneEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });
  if (fileInputEl) {
    fileInputEl.addEventListener('change', () => {
      if (fileInputEl.files && fileInputEl.files[0]) processModFile(fileInputEl.files[0], getTargets());
      fileInputEl.value = ''; // allow re-picking the same file
    });
  }
}

if (versionDropzone) {
  const modTargets = () => ({
    urlInput: installModInput,
    idInput: installModIdInput,
    versionInput: installModVersionInput,
    msg: versionDropMsg
  });
  wireBrowse(versionDropzone, versionFileInput, modTargets);
  // The entire "Your mod" section is the drop target; the zone is just browse.
  wireDropTarget(installModInput.closest('.install-controls'), modTargets);

  // Swallow stray drops elsewhere on the page so the browser doesn't navigate
  // away to the dropped file.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
}

// Dropping anywhere on the Dependencies section background (or its dedicated
// zone) spawns a fresh dependency row and fills it; dropping onto an existing
// dependency card updates just that card, since the card's own handler stops the
// event before it reaches the section. getTargets runs once per drop, so each
// drop here creates exactly one new row.
const newDepTargets = () => {
  const row = addDepRow('', '', '', false);
  return {
    urlInput: row.querySelector('.dep-url'),
    idInput: row.querySelector('.dep-id'),
    versionInput: row.querySelector('.dep-version'),
    msg: row.querySelector('.drop-status')
  };
};
if (depAddDropzone) {
  wireBrowse(depAddDropzone, depAddFileInput, newDepTargets);
  wireDropTarget(depAddDropzone, newDepTargets);
}
if (installDepsEl) wireDropTarget(installDepsEl.closest('.install-controls'), newDepTargets);

// Badge appearance: the style picker, the left-color swatches, and the
// right-color swatches each contribute a filename suffix, combined into
// installBadgeFile (badges/install-badge[-style][-left][-right].svg). Tracking
// them separately lets the pickers coexist instead of clobbering each other.
let installBadgeStyle = '';
let installBadgeColor = '';
let installBadgeLabel = '';
function applyBadgeFile() {
  installBadgeFile = `badges/install-badge${installBadgeStyle}${installBadgeLabel}${installBadgeColor}.svg`;
  updateInstallOutput();
}

// Repaint the style-option thumbnails so each shows the currently selected
// color and label color, keeping the style picker's previews in sync.
function updateStylePreviews() {
  installStyles?.querySelectorAll('.style-option').forEach(btn => {
    const img = btn.querySelector('img');
    if (img) img.src = `badges/install-badge${btn.dataset.style}${installBadgeLabel}${installBadgeColor}.svg`;
  });
}

// Badge color picker (cyan/blue/purple/green/amber/red).
if (installSwatches) {
  installSwatches.querySelectorAll('.swatch').forEach(btn => {
    btn.addEventListener('click', () => {
      installSwatches.querySelector('.swatch.selected')?.classList.remove('selected');
      btn.classList.add('selected');
      installBadgeColor = btn.dataset.color;
      updateStylePreviews();
      applyBadgeFile();
    });
  });
}

// Left-side (label) color picker — same swatch UI and palette as the right.
if (installLabelColors) {
  installLabelColors.querySelectorAll('.swatch').forEach(btn => {
    btn.addEventListener('click', () => {
      installLabelColors.querySelector('.swatch.selected')?.classList.remove('selected');
      btn.classList.add('selected');
      installBadgeLabel = btn.dataset.color;
      updateStylePreviews();
      applyBadgeFile();
    });
  });
}

// Badge style picker (flat vs. for-the-badge).
if (installStyles) {
  installStyles.querySelectorAll('.style-option').forEach(btn => {
    btn.addEventListener('click', () => {
      installStyles.querySelector('.style-option.selected')?.classList.remove('selected');
      btn.classList.add('selected');
      installBadgeStyle = btn.dataset.style;
      applyBadgeFile();
    });
  });
}

document.querySelectorAll('input[name="install-format"]').forEach(radio => {
  radio.addEventListener('change', updateInstallOutput);
});

copyInstallBtn.addEventListener('click', () => copyToClipboard(installText.value, copyInstallBtn));

// Footer licenses dialog (native <dialog>): open button shows it modally, the
// close button and a click on the backdrop dismiss it (Esc works natively).
const licenseDialog = document.getElementById('license-dialog');
const openLicensesBtn = document.getElementById('open-licenses');
const closeLicensesBtn = document.getElementById('close-licenses');
if (licenseDialog && openLicensesBtn) {
  openLicensesBtn.addEventListener('click', () => licenseDialog.showModal());
  closeLicensesBtn?.addEventListener('click', () => licenseDialog.close());
  // The dialog element fills only the backdrop area around the padding-less box,
  // so a click whose target is the dialog itself is a backdrop click.
  licenseDialog.addEventListener('click', (e) => {
    if (e.target === licenseDialog) licenseDialog.close();
  });
}

updateInstallOutput();
