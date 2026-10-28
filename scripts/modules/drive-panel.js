import { CONFIG } from '../config.js';
import { driveAuth } from '../drive/auth.js';
import { driveApi } from '../drive/api.js';
import { createFolderExplorer } from './folder3d.js';
import { initCustomCursor } from './cursor.js';
import { initParallax } from './parallax.js';
import { initScrollReveal } from './scroll-reveal.js';

const $ = id => document.getElementById(id);
const elements = {
  connectDrive: $('connect-drive'), refreshDrive: $('refresh-drive'), openDriveRoot: $('open-drive-root'),
  backFolder: $('back-folder'), loadMoreFolders: $('load-more-folders'),
  folderStage: $('folder-stage'), rootCount: $('root-count'), fileView: $('file-view'), breadcrumbs: $('breadcrumbs'),
  currentFolderTitle: $('current-folder-title'), currentFolderPath: $('current-folder-path'), fileList: $('file-list'),
  fileSearch: $('file-search'), loadMore: $('load-more'), status: $('status-message'), mode: $('mode-indicator')
};

let explorer;

function setStatus(message) { elements.status.textContent = message; }

function updateMode() {
  const publicMode = CONFIG.drive.mode === 'public';
  const live = CONFIG.drive.mode === 'live';
  elements.mode.textContent = CONFIG.drive.mode === 'mock' ? 'MOCK MODE' : publicMode ? 'PUBLIC · READ-ONLY' : (driveAuth.isConnected() ? 'DRIVE READ-ONLY' : 'DRIVE LIVE');
  elements.connectDrive.hidden = publicMode || CONFIG.drive.mode === 'mock';
  elements.connectDrive.textContent = driveAuth.isConnected() ? 'Reconnect Drive' : 'Connect Google Drive';
  const rootUrl = driveApi.rootWebViewLink;
  if (elements.openDriveRoot) {
    elements.openDriveRoot.hidden = !rootUrl;
    if (rootUrl) elements.openDriveRoot.href = rootUrl;
  }
}

async function connectDrive() {
  if (CONFIG.drive.mode === 'public') {
    setStatus('Mode publik aktif: tidak perlu login. Pastikan folder Drive dibagikan ke siapa saja yang memiliki link sebagai Pelihat.');
    return;
  }
  if (CONFIG.drive.mode !== 'live') {
    setStatus('Mode mock aktif. Untuk membaca Drive asli, isi clientId dan rootFolderId di scripts/config.js, lalu ubah drive.mode ke “live”.');
    return;
  }
  if (!CONFIG.drive.clientId || !CONFIG.drive.rootFolderId) {
    setStatus('Konfigurasi belum lengkap: isi CONFIG.drive.clientId dan CONFIG.drive.rootFolderId sebelum terhubung.');
    return;
  }
  elements.connectDrive.disabled = true;
  setStatus('Menghubungkan akun Google untuk membaca folder…');
  try {
    await driveAuth.connect();
    updateMode();
    const loaded = await explorer.navigate();
    if (loaded) setStatus('Google Drive terhubung dalam mode baca saja. Kelola file langsung di Drive, lalu tekan Segarkan untuk memuat perubahan.');
  } catch (error) {
    setStatus(error.message || 'Google Drive tidak dapat dihubungkan.');
  } finally {
    elements.connectDrive.disabled = false;
    updateMode();
  }
}

function initDebugPanel() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('debug') !== '1') return;
  const panel = $('debug-panel');
  const perspective = $('debug-perspective');
  const tilt = $('debug-tilt');
  const hover = $('debug-hover');
  const open = $('debug-open');
  const live = $('debug-live');
  const output = $('debug-output');
  panel.hidden = false;
  live.checked = CONFIG.drive.mode === 'live';

  const setNumber = (input, outputId, cssVariable, unit, apply) => {
    const update = () => {
      const value = Number(input.value);
      $(outputId).textContent = `${value}${unit}`;
      document.documentElement.style.setProperty(cssVariable, `${value}${unit}`);
      apply?.(value);
    };
    input.addEventListener('input', update);
    update();
  };
  setNumber(perspective, 'debug-perspective-value', '--perspective', 'px', value => { CONFIG.folder3d.perspective = value; });
  setNumber(tilt, 'debug-tilt-value', '--folder-idle-tilt-x', 'deg', value => {
    CONFIG.folder3d.idleTiltX = value;
    document.documentElement.style.setProperty('--folder-idle-tilt-y', `${-Math.min(8, value / 2)}deg`);
  });
  setNumber(hover, 'debug-hover-value', '--folder-hover-lift', 'px', value => { CONFIG.folder3d.hoverLift = value; });
  setNumber(open, 'debug-open-value', '--folder-open-lift', 'px', value => { CONFIG.folder3d.openLift = value; });
  $('debug-close').addEventListener('click', () => { panel.hidden = true; });
  live.addEventListener('change', async () => {
    CONFIG.drive.mode = live.checked ? 'live' : 'mock';
    driveApi.invalidate();
    updateMode();
    if (CONFIG.drive.mode === 'mock') {
      driveAuth.disconnect();
      await explorer.goRoot({ replaceHistory: true });
      setStatus('Mode mock aktif. Data contoh hanya untuk pratinjau.');
    } else {
      await explorer.goRoot({ load: false, replaceHistory: true });
      if (!CONFIG.drive.rootFolderId) setStatus('Isi CONFIG.drive.rootFolderId untuk menguji folder live.');
      else setStatus('Mode live aktif. Klik Connect Google Drive untuk membaca folder.');
    }
  });
  $('debug-test-fetch').addEventListener('click', async () => {
    output.textContent = 'Meminta metadata Drive…';
    try {
      if (CONFIG.drive.mode !== 'live') {
        const data = await driveApi.listFiles(driveApi.rootId);
        output.textContent = JSON.stringify(data, null, 2);
        return;
      }
      if (!CONFIG.drive.rootFolderId) throw new Error('rootFolderId belum diisi.');
      if (!driveAuth.isConnected()) await driveAuth.connect();
      const data = await driveApi.listFiles(CONFIG.drive.rootFolderId);
      output.textContent = JSON.stringify(data, null, 2);
      setStatus(`Test fetch berhasil: ${data.files.length} item pada halaman ini.`);
    } catch (error) {
      output.textContent = JSON.stringify({ error: error.message }, null, 2);
      setStatus(error.message || 'Pembacaan Drive gagal.');
    }
    updateMode();
  });
}

export function initDrivePanel() {
  explorer = createFolderExplorer({ elements, onStatus: setStatus, onConnectRequired: updateMode });
  initCustomCursor();
  initParallax(elements.folderStage);
  initScrollReveal(document);
  elements.connectDrive.addEventListener('click', connectDrive);
  elements.refreshDrive.addEventListener('click', () => {
    if (CONFIG.drive.mode === 'live' && !driveAuth.isConnected()) {
      setStatus('Hubungkan Google Drive terlebih dahulu, lalu tekan Segarkan.');
      updateMode();
      return;
    }
    void explorer.refresh();
  });
  elements.fileSearch.addEventListener('input', () => explorer.filterFiles());
  elements.loadMore.addEventListener('click', () => explorer.loadMore());
  elements.loadMoreFolders.addEventListener('click', () => explorer.loadMore());
  updateMode();
  initDebugPanel();
  if (CONFIG.drive.mode === 'live') {
    elements.folderStage.hidden = true;
    elements.fileView.hidden = true;
    if (CONFIG.drive.rootFolderId) setStatus('Folder Drive siap dibaca. Hubungkan Google Drive untuk memuat isinya.');
    else setStatus('Isi CONFIG.drive.clientId dan CONFIG.drive.rootFolderId di scripts/config.js untuk mengaktifkan Drive live.');
  } else if (CONFIG.drive.mode === 'public') {
    if (CONFIG.drive.rootFolderId && CONFIG.drive.apiKey) void explorer.navigate();
    else setStatus('Mode tanpa login: isi CONFIG.drive.apiKey dan CONFIG.drive.rootFolderId. Folder Google Drive harus dibagikan sebagai “Siapa saja yang memiliki link — Pelihat”.');
  } else {
    void explorer.navigate();
  }
}
