import { CONFIG } from '../config.js';
import { driveApi } from '../drive/api.js';
import { createFolderExplorer } from './folder3d.js';
import { initCustomCursor } from './cursor.js';
import { initParallax } from './parallax.js';
import { initScrollReveal } from './scroll-reveal.js';

const $ = id => document.getElementById(id);
const elements = {
  refreshDrive: $('refresh-drive'),
  backFolder: $('back-folder'), loadMoreFolders: $('load-more-folders'),
  folderStage: $('folder-stage'), rootCount: $('root-count'), fileView: $('file-view'), breadcrumbs: $('breadcrumbs'),
  currentFolderTitle: $('current-folder-title'), currentFolderPath: $('current-folder-path'), fileList: $('file-list'),
  fileSearch: $('file-search'), loadMore: $('load-more'), status: $('status-message'), mode: $('mode-indicator')
};

let explorer;

function setStatus(message) { elements.status.textContent = message; }

function updateMode() {
  elements.mode.textContent = CONFIG.drive.mode === 'mock' ? 'MOCK MODE' : 'ARCHIVE · READ-ONLY';
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
  live.checked = CONFIG.drive.mode === 'server';

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
    CONFIG.drive.mode = live.checked ? 'server' : 'mock';
    driveApi.invalidate();
    updateMode();
    await explorer.goRoot({ replaceHistory: true });
  });
  $('debug-test-fetch').addEventListener('click', async () => {
    output.textContent = 'Meminta daftar folder…';
    try {
      output.textContent = JSON.stringify(await driveApi.listFiles(driveApi.rootId), null, 2);
    } catch (error) {
      output.textContent = JSON.stringify({ error: error.message }, null, 2);
    }
  });
}

async function initAdminLink() {
  // Dev (Vite) menyajikan admin di /admin.html; produksi memakai ADMIN_PATH dari server.
  if (import.meta.env.DEV || CONFIG.drive.mode === 'mock') return;
  try {
    const response = await fetch(`${CONFIG.drive.apiBase}/site`, { headers: { Accept: 'application/json' } });
    const { adminPath } = await response.json();
    if (typeof adminPath === 'string' && adminPath.startsWith('/')) elements.adminLink.href = adminPath;
  } catch { /* tetap pakai tautan bawaan */ }
}

export function initDrivePanel() {
  explorer = createFolderExplorer({ elements, onStatus: setStatus });
  initCustomCursor();
  initParallax(elements.folderStage);
  initScrollReveal(document);
  elements.refreshDrive.addEventListener('click', () => { void explorer.refresh(); });
  elements.fileSearch.addEventListener('input', () => explorer.filterFiles());
  elements.loadMore.addEventListener('click', () => explorer.loadMore());
  elements.loadMoreFolders.addEventListener('click', () => explorer.loadMore());
  updateMode();
  void initAdminLink();
  initDebugPanel();
  void explorer.navigate();
}
