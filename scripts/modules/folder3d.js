import { CONFIG } from '../config.js';
import { driveApi } from '../drive/api.js';
import { animateFolderOpen, initFolderShelfDrag } from './folder-motion.js';

const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const isFolder = item => item?.mimeType === driveApi.folderMime;

function parsedUrl(value) {
  if (!value) return null;
  try { return new URL(value, window.location.href); } catch { return null; }
}

function safePreviewUrl(value) {
  const url = parsedUrl(value);
  if (!url) return '';
  if (url.origin === window.location.origin && (url.pathname.startsWith('/assets/previews/') || /^\/api\/files\/[\w-]+\/download$/.test(url.pathname))) return url.href;
  if (url.protocol === 'https:' && (['drive.google.com', 'docs.google.com'].includes(url.hostname) || url.hostname.endsWith('.googleusercontent.com'))) return url.href;
  return '';
}

function safeDriveUrl(value) {
  const url = parsedUrl(value);
  return url?.protocol === 'https:' && ['drive.google.com', 'docs.google.com'].includes(url.hostname) ? url.href : '';
}

const fileType = item => {
  if (isFolder(item)) return 'FOLDER';
  const nameExt = item.name?.includes('.') ? item.name.split('.').pop().toUpperCase() : '';
  if (nameExt) return nameExt.slice(0, 9);
  if (item.mimeType?.startsWith('application/vnd.google-apps.')) return 'GOOGLE FILE';
  return item.mimeType?.split('/').pop()?.toUpperCase().slice(0, 10) || 'FILE';
};

const fileSize = item => {
  const size = Number(item.size || 0);
  if (!size) return '—';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
};

function driveLink(item, label = 'Drive ↗') {
  const url = safeDriveUrl(item.webViewLink);
  return url ? `<a class="file-action" href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">${label}</a>` : '';
}

function serialisePath(path) {
  return path.map(folder => ({ id: String(folder.id), name: String(folder.name), mimeType: String(folder.mimeType || driveApi.folderMime) }));
}

export function createFolderExplorer({ elements, onStatus }) {
  const rootStyle = document.documentElement.style;
  rootStyle.setProperty('--perspective', `${CONFIG.folder3d.perspective}px`);
  rootStyle.setProperty('--folder-idle-tilt-x', `${CONFIG.folder3d.idleTiltX}deg`);
  rootStyle.setProperty('--folder-idle-tilt-y', `${CONFIG.folder3d.idleTiltY}deg`);
  rootStyle.setProperty('--folder-hover-lift', `${CONFIG.folder3d.hoverLift}px`);
  rootStyle.setProperty('--folder-open-lift', `${CONFIG.folder3d.openLift}px`);
  rootStyle.setProperty('--folder-open-duration', `${CONFIG.folder3d.openDuration}ms`);
  rootStyle.setProperty('--folder-drag-scale', String(CONFIG.folder3d.dragScale));
  rootStyle.setProperty('--folder-float-duration', `${CONFIG.folder3d.floatDuration}ms`);
  rootStyle.setProperty('--folder-stagger', `${CONFIG.folder3d.staggerMs}ms`);

  const state = {
    path: [], rootId: driveApi.rootId, pageToken: null, currentItems: [], busy: false,
    navigationSequence: 0
  };
  let activeNavigationController = null;
  let rootVisualOrder = [];

  const currentParent = () => state.path.length ? state.path[state.path.length - 1].id : state.rootId;
  const currentFolder = () => state.path[state.path.length - 1] || null;
  const status = message => { elements.status.textContent = message; onStatus?.(message); };

  function setBusy(value) {
    state.busy = value;
    if (elements.refreshDrive) elements.refreshDrive.disabled = value;
    if (elements.loadMore) elements.loadMore.disabled = value;
    if (elements.loadMoreFolders) elements.loadMoreFolders.disabled = value;
  }

  function updateBackButton() {
    if (!elements.backFolder) return;
    elements.backFolder.hidden = state.path.length === 0;
    elements.backFolder.setAttribute('aria-label', state.path.length > 1
      ? `Kembali ke folder ${state.path[state.path.length - 2].name}`
      : 'Kembali ke semua folder');
  }

  function historyURL() {
    const suffix = state.path.map(folder => encodeURIComponent(folder.id)).join('/');
    return `${window.location.pathname}${window.location.search}#archive${suffix ? `/${suffix}` : ''}`;
  }

  function syncBrowserHistory(mode = 'push') {
    const historyState = {
      ...(window.history.state && typeof window.history.state === 'object' ? window.history.state : {}),
      archiveExplorer: true,
      archivePath: serialisePath(state.path)
    };
    const method = mode === 'replace' ? 'replaceState' : 'pushState';
    window.history[method](historyState, '', historyURL());
  }

  function renderBreadcrumbs() {
    const bits = [{ id: state.rootId, name: 'Archive', index: -1 }, ...state.path.map((folder, index) => ({ ...folder, index }))];
    elements.breadcrumbs.innerHTML = bits.map((part, index) => `${index ? '<span class="breadcrumbs__slash" aria-hidden="true">/</span>' : ''}<button type="button" data-crumb-index="${part.index}" ${index === bits.length - 1 ? 'aria-current="page"' : ''}>${escapeHTML(part.name)}</button>`).join('');
    elements.breadcrumbs.querySelectorAll('[data-crumb-index]').forEach(button => button.addEventListener('click', () => {
      const index = Number(button.dataset.crumbIndex);
      state.path = index < 0 ? [] : state.path.slice(0, index + 1);
      syncBrowserHistory('push');
      void navigate();
    }));
    updateBackButton();
  }

  function enterFolder(folder) {
    state.path.push({ id: folder.id, name: folder.name, mimeType: folder.mimeType || driveApi.folderMime });
    syncBrowserHistory('push');
    void navigate();
  }

  function goBack() {
    if (!state.path.length) return;
    // This control always means “parent folder”, even after a breadcrumb jump.
    state.path.pop();
    syncBrowserHistory('push');
    void navigate();
  }

  function goRoot({ load = true, replaceHistory = false } = {}) {
    state.path = [];
    syncBrowserHistory(replaceHistory ? 'replace' : 'push');
    if (load) return navigate();
    renderBreadcrumbs();
    elements.folderStage.hidden = true;
    elements.fileView.hidden = true;
    if (elements.loadMoreFolders) elements.loadMoreFolders.hidden = true;
    return Promise.resolve(true);
  }

  function folderMarkup(folder, index) {
    return `<article class="folder-tile" data-folder-tile="${escapeHTML(folder.id)}" data-reveal="folder" style="--tile-index:${index};--tile-delay:${Math.min(index, 6) * CONFIG.folder3d.staggerMs}ms">
      <button class="folder-tile__open" type="button" data-open-folder="${escapeHTML(folder.id)}" aria-label="Buka folder ${escapeHTML(folder.name)}" title="Buka ${escapeHTML(folder.name)}">
        <span class="folder-tile__object-wrap" aria-hidden="true">
          <span class="folder-tile__shadow"></span>
          <span class="folder-tile__object">
            <span class="folder-tile__paper"></span>
            <span class="folder-tile__contents">
              <span class="folder-tile__sheet folder-tile__sheet--one"></span>
              <span class="folder-tile__sheet folder-tile__sheet--two"></span>
              <span class="folder-tile__sheet folder-tile__sheet--three"></span>
            </span>
            <span class="folder-tile__tab"></span><span class="folder-tile__body"></span><span class="folder-tile__body-edge"></span>
          </span>
        </span>
        <span class="folder-tile__caption"><span class="folder-tile__serial">${String(index + 1).padStart(2, '0')} / FOLDER</span><span class="folder-tile__name" title="${escapeHTML(folder.name)}">${escapeHTML(folder.name)}</span><span class="folder-tile__count">Buka folder ↗</span></span>
      </button>
    </article>`;
  }

  function renderFolderStage(files) {
    let folders = files.filter(isFolder);
    if (rootVisualOrder.length) {
      const order = new Map(rootVisualOrder.map((id, index) => [id, index]));
      folders = [...folders].sort((a, b) => {
        const aRank = order.has(a.id) ? order.get(a.id) : Number.MAX_SAFE_INTEGER;
        const bRank = order.has(b.id) ? order.get(b.id) : Number.MAX_SAFE_INTEGER;
        return aRank - bRank;
      });
    }
    elements.folderStage.hidden = state.path.length > 0;
    elements.fileView.hidden = state.path.length === 0;
    if (elements.loadMoreFolders) elements.loadMoreFolders.hidden = state.path.length > 0 || !state.pageToken;
    if (state.path.length) return;

    elements.folderStage.innerHTML = folders.length
      ? folders.map((folder, index) => folderMarkup(folder, index)).join('')
      : '<p class="empty-state">Belum ada folder di arsip ini.</p>';

    elements.folderStage.querySelectorAll('[data-open-folder]').forEach(button => button.addEventListener('click', async () => {
      const folder = folders.find(item => item.id === button.dataset.openFolder);
      const tile = button.closest('.folder-tile');
      if (!folder || !tile || button.dataset.opening === 'true') return;
      button.dataset.opening = 'true';
      button.setAttribute('aria-busy', 'true');
      await animateFolderOpen(tile);
      if (tile.isConnected) enterFolder(folder);
    }));
    elements.rootCount.textContent = `${String(folders.length).padStart(2, '0')} FOLDER${folders.length === 1 ? '' : 'S'}`;
  }

  function renderFiles(files) {
    const filter = elements.fileSearch.value.trim().toLocaleLowerCase();
    const visible = files.filter(item => String(item.name || '').toLocaleLowerCase().includes(filter));

    elements.fileList.innerHTML = visible.length ? visible.map(item => {
      const folder = isFolder(item);
      const glyph = fileType(item);
      const metadata = folder ? 'FOLDER' : `${fileType(item)} · ${fileSize(item)}`;
      const previewUrl = safePreviewUrl(item.previewUrl) || safePreviewUrl(item.webViewLink) || safePreviewUrl(item.thumbnailLink);
      let actions = '';
      if (folder) {
        actions = `<button class="file-action" type="button" data-open-item="${escapeHTML(item.id)}">Buka</button>`;
      } else {
        const livePreviewLink = safeDriveUrl(item.webViewLink);
        const previewAction = livePreviewLink
          ? driveLink(item, 'Preview ↗')
          : (previewUrl ? `<button class="file-action" type="button" data-preview-item="${escapeHTML(item.id)}">Preview</button>` : '');
        actions = `${previewAction}<button class="file-action" type="button" data-download-item="${escapeHTML(item.id)}">Unduh</button>`;
      }
      return `<article class="file-row" data-file-row="${escapeHTML(item.id)}" data-reveal="file">
        <div class="file-row__name"><span class="file-row__glyph" aria-hidden="true">${escapeHTML(glyph)}</span><div class="file-row__title"><button type="button" data-title-item="${escapeHTML(item.id)}" ${folder ? `aria-label="Buka folder ${escapeHTML(item.name)}"` : ''}>${escapeHTML(item.name)}</button></div></div>
        <span class="file-row__meta">${escapeHTML(metadata)}</span>
        <div class="file-row__actions">${actions}</div>
      </article>`;
    }).join('') : `<p class="empty-state">${files.length ? 'Tidak ada item dengan nama tersebut.' : 'Folder ini kosong.'}</p>`;

    elements.loadMore.hidden = !state.pageToken;
    elements.fileList.querySelectorAll('[data-open-item], [data-title-item]').forEach(button => button.addEventListener('click', () => {
      const item = state.currentItems.find(row => row.id === (button.dataset.openItem || button.dataset.titleItem));
      if (item && isFolder(item)) enterFolder(item);
      else if (item) previewFile(item);
    }));
    elements.fileList.querySelectorAll('[data-preview-item]').forEach(button => button.addEventListener('click', () => {
      const item = state.currentItems.find(row => row.id === button.dataset.previewItem);
      if (item) previewFile(item);
    }));
    elements.fileList.querySelectorAll('[data-download-item]').forEach(button => button.addEventListener('click', () => {
      const item = state.currentItems.find(row => row.id === button.dataset.downloadItem);
      if (item) void runReadAction(() => driveApi.download(item), `Mengunduh ${item.name}…`);
    }));
  }

  function previewFile(item) {
    if (isFolder(item)) return enterFolder(item);
    const url = safePreviewUrl(item.previewUrl) || safePreviewUrl(item.webViewLink) || safePreviewUrl(item.thumbnailLink);
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    status('Preview tidak tersedia untuk jenis file ini. Gunakan Unduh.');
  }

  async function runReadAction(action, pendingMessage) {
    setBusy(true);
    status(pendingMessage);
    try {
      await action();
      status('Unduhan dimulai.');
    } catch (error) {
      status(error.message || 'Aksi baca gagal.');
    } finally {
      setBusy(false);
    }
  }

  async function navigate(options = {}) {
    const requestId = ++state.navigationSequence;
    activeNavigationController?.abort();
    const controller = new AbortController();
    activeNavigationController = controller;
    setBusy(true);
    state.rootId = driveApi.rootId;
    state.pageToken = null;
    renderBreadcrumbs();
    elements.folderStage.hidden = state.path.length > 0;
    elements.fileView.hidden = state.path.length === 0;
    if (elements.loadMoreFolders) elements.loadMoreFolders.hidden = true;
    elements.loadMore.hidden = true;
    if (state.path.length) {
      elements.currentFolderTitle.textContent = currentFolder().name;
      elements.currentFolderPath.textContent = `FOLDER / ${state.path.map(item => item.name).join(' / ')}`;
      if (!options.quiet) status(`Membuka ${currentFolder().name}…`);
    } else if (!options.quiet) {
      status('Memuat daftar folder…');
    }

    try {
      if (!state.rootId) throw new Error('Arsip tidak tersedia.');
      const page = await driveApi.listFiles(currentParent(), null, { signal: controller.signal });
      if (requestId !== state.navigationSequence) return false;
      state.currentItems = page.files || [];
      state.pageToken = page.nextPageToken || null;

      if (!state.path.length) {
        elements.fileSearch.value = '';
        renderFolderStage(state.currentItems);
      } else {
        elements.folderStage.hidden = true;
        elements.loadMoreFolders && (elements.loadMoreFolders.hidden = true);
        elements.fileView.hidden = false;
        elements.currentFolderTitle.textContent = currentFolder().name;
        elements.currentFolderPath.textContent = `FOLDER / ${state.path.map(item => item.name).join(' / ')}`;
        renderFiles(state.currentItems);
      }
      if (!options.quiet) {
        const count = state.path.length ? state.currentItems.length : state.currentItems.filter(isFolder).length;
        status(state.path.length ? `Menampilkan ${count} item di ${currentFolder().name}.` : `Menampilkan ${count} folder pada halaman ini.`);
      }
      return true;
    } catch (error) {
      if (requestId !== state.navigationSequence || error?.name === 'AbortError') return false;
      state.currentItems = [];
      state.pageToken = null;
      elements.folderStage.innerHTML = '';
      elements.fileList.innerHTML = '';
      elements.folderStage.hidden = state.path.length > 0;
      elements.fileView.hidden = state.path.length === 0;
      if (elements.loadMoreFolders) elements.loadMoreFolders.hidden = true;
      elements.loadMore.hidden = true;
      status(error.message || 'Folder tidak dapat dimuat.');
      return false;
    } finally {
      if (requestId === state.navigationSequence) setBusy(false);
    }
  }

  async function refresh() {
    driveApi.invalidate();
    const loaded = await navigate({ quiet: true });
    if (!loaded) return;
    status(CONFIG.drive.mode === 'mock' ? 'Daftar contoh disegarkan.' : 'Daftar arsip dimuat ulang.');
  }

  async function loadMore() {
    if (!state.pageToken || state.busy) return;
    const requestId = state.navigationSequence;
    setBusy(true);
    const targetParent = currentParent();
    const targetPageToken = state.pageToken;
    try {
      const page = await driveApi.listFiles(targetParent, targetPageToken);
      if (requestId !== state.navigationSequence || targetParent !== currentParent()) return;
      state.currentItems.push(...(page.files || []));
      state.pageToken = page.nextPageToken || null;
      if (state.path.length) renderFiles(state.currentItems);
      else renderFolderStage(state.currentItems);
    } catch (error) {
      if (requestId === state.navigationSequence) status(error.message || 'Halaman berikutnya gagal dimuat.');
    } finally {
      if (requestId === state.navigationSequence) setBusy(false);
    }
  }

  function restoreHistory(event) {
    const path = event.state?.archiveExplorer && Array.isArray(event.state.archivePath)
      ? event.state.archivePath
      : [];
    state.path = serialisePath(path.filter(folder => folder && folder.id && folder.name));
    void navigate();
  }

  initFolderShelfDrag({
    stage: elements.folderStage,
    onOrderChange(order) { rootVisualOrder = order; }
  });
  elements.backFolder?.addEventListener('click', goBack);
  window.addEventListener('popstate', restoreHistory);
  syncBrowserHistory('replace');

  return {
    state,
    navigate,
    refresh,
    goBack,
    goRoot,
    async loadMore() { return loadMore(); },
    filterFiles() { renderFiles(state.currentItems); },
    status
  };
}
