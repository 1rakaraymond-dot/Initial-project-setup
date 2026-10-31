import { CONFIG } from '../config.js';
import { mockDrive, FOLDER_MIME } from './mock.js';

const cache = new Map();

function clearCache(parentId) {
  if (!parentId) { cache.clear(); return; }
  for (const key of cache.keys()) if (key.slice(0, key.lastIndexOf(':')) === String(parentId)) cache.delete(key);
}

async function serverList(parentId, pageToken, { signal } = {}) {
  const key = `${parentId}:${pageToken || 'first'}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.time < CONFIG.drive.cacheTTL) return structuredClone(cached.data);

  const params = new URLSearchParams({ parent: String(parentId) });
  if (pageToken) params.set('pageToken', pageToken);
  let response;
  try {
    response = await fetch(`${CONFIG.drive.apiBase}/list?${params}`, { signal, headers: { Accept: 'application/json' } });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new Error('Server arsip tidak dapat dihubungi. Pastikan server berjalan (npm run server).');
  }
  if (!response.ok) {
    let detail = '';
    try { detail = (await response.json())?.error || ''; } catch { /* bukan JSON */ }
    throw new Error(detail || `Daftar folder gagal dimuat (${response.status}).`);
  }
  const data = await response.json();
  cache.set(key, { time: Date.now(), data });
  return data;
}

function triggerDownload(url, name) {
  const link = document.createElement('a');
  link.href = url;
  link.download = name || '';
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
}

export const driveApi = {
  folderMime: FOLDER_MIME,
  get rootId() { return CONFIG.drive.mode === 'mock' ? mockDrive.rootId : 'root'; },
  rootWebViewLink: '',
  async listFiles(parentId, pageToken = null, options = {}) {
    if (CONFIG.drive.mode === 'mock') return mockDrive.listFiles(parentId, pageToken, CONFIG.drive.pageSize);
    return serverList(parentId, pageToken, options);
  },
  async download(item) {
    if (CONFIG.drive.mode === 'mock') {
      const url = mockDrive.getPreviewUrl(item);
      if (!url) throw new Error('File contoh ini belum memiliki konten unduhan.');
      triggerDownload(url, item.name);
      return;
    }
    // Browser mengunduh langsung dari server (streaming), tanpa memuat file ke memori halaman.
    triggerDownload(`${CONFIG.drive.apiBase}/files/${encodeURIComponent(item.id)}/download`, item.name);
  },
  invalidate(parentId) { clearCache(parentId); }
};
