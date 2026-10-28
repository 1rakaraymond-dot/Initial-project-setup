import { CONFIG } from '../config.js';
import { driveAuth } from './auth.js';
import { mockDrive, FOLDER_MIME } from './mock.js';

const API = 'https://www.googleapis.com/drive/v3/files';
const cache = new Map();

function clearCache(parentId) {
  if (!parentId) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) if (key.slice(0, key.lastIndexOf(':')) === String(parentId)) cache.delete(key);
}

async function request(url, { asBlob = false, signal } = {}) {
  const publicMode = CONFIG.drive.mode === 'public';
  if (publicMode) {
    if (!CONFIG.drive.apiKey) throw new Error('Isi CONFIG.drive.apiKey untuk akses publik tanpa login.');
    const parsed = new URL(url);
    parsed.searchParams.set('key', CONFIG.drive.apiKey);
    url = parsed.toString();
  }
  const token = publicMode ? '' : await driveAuth.getAccessToken();
  const response = await fetch(url, {
    headers: publicMode ? {} : { Authorization: `Bearer ${token}` },
    signal
  });
  if (response.status === 401 && !publicMode) {
    driveAuth.disconnect();
    throw new Error('Sesi Google Drive berakhir. Klik Hubungkan ulang untuk melanjutkan.');
  }
  if (response.status === 403) {
    throw new Error(publicMode ? 'Google Drive tidak mengizinkan akses publik. Pastikan folder dibagikan ke “Siapa saja yang memiliki link” sebagai Pelihat dan API key valid.' : 'Google menolak akses baca. Pastikan akun yang benar memiliki akses ke folder dan izin Drive read-only telah disetujui.');
  }
  if (response.status === 404) {
    throw new Error('Folder atau file tidak ditemukan. Periksa folder ID dan izin akses akun Google.');
  }
  if (!response.ok) {
    let detail = '';
    try { detail = (await response.json())?.error?.message || ''; } catch { /* Response may not be JSON. */ }
    throw new Error(detail || `Permintaan baca Google Drive gagal (${response.status}).`);
  }
  if (asBlob) return response.blob();
  const type = response.headers.get('content-type') || '';
  return type.includes('application/json') ? response.json() : response.blob();
}

async function liveList(parentId, pageToken = null, { signal } = {}) {
  const key = `${parentId}:${pageToken || 'first'}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.time < CONFIG.drive.cacheTTL) return structuredClone(cached.data);

  const query = `'${String(parentId).replaceAll("'", "\\'")}' in parents and trashed = false`;
  const params = new URLSearchParams({
    q: query,
    pageSize: String(Math.max(25, Math.min(100, CONFIG.drive.pageSize))),
    orderBy: 'folder,name',
    includeItemsFromAllDrives: 'true',
    supportsAllDrives: 'true',
    fields: 'files(id,name,mimeType,thumbnailLink,modifiedTime,size,webViewLink,iconLink,parents),nextPageToken'
  });
  if (pageToken) params.set('pageToken', pageToken);

  const data = await request(`${API}?${params.toString()}`, { signal });
  cache.set(key, { time: Date.now(), data });
  return data;
}

export const driveApi = {
  folderMime: FOLDER_MIME,
  get rootId() {
    return CONFIG.drive.mode === 'mock' ? mockDrive.rootId : CONFIG.drive.rootFolderId;
  },
  get rootWebViewLink() {
    return ['live', 'public'].includes(CONFIG.drive.mode) && CONFIG.drive.rootFolderId
      ? `https://drive.google.com/drive/folders/${encodeURIComponent(CONFIG.drive.rootFolderId)}`
      : '';
  },
  async listFiles(parentId, pageToken = null, options = {}) {
    if (CONFIG.drive.mode === 'mock') return mockDrive.listFiles(parentId, pageToken, CONFIG.drive.pageSize);
    return liveList(parentId, pageToken, options);
  },
  async download(item) {
    if (CONFIG.drive.mode === 'mock') {
      const url = mockDrive.getPreviewUrl(item);
      if (!url) throw new Error('File contoh ini belum memiliki konten unduhan.');
      const link = document.createElement('a');
      link.href = url;
      link.download = item.name;
      link.rel = 'noopener';
      link.click();
      return;
    }

    const isWorkspace = item.mimeType?.startsWith('application/vnd.google-apps.') && item.mimeType !== FOLDER_MIME;
    const url = isWorkspace
      ? `${API}/${encodeURIComponent(item.id)}/export?mimeType=application/pdf`
      : `${API}/${encodeURIComponent(item.id)}?alt=media`;
    const blob = await request(url, { asBlob: true });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = isWorkspace ? `${item.name}.pdf` : item.name;
    link.rel = 'noopener';
    link.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
  },
  invalidate(parentId) { clearCache(parentId); }
};
