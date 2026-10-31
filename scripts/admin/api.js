export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

const state = { csrf: '', onUnauthorized: null, uploadMode: 'stream' };
export const session = {
  get csrf() { return state.csrf; },
  set csrf(value) { state.csrf = value || ''; },
  set uploadMode(value) { state.uploadMode = value === 'chunk' ? 'chunk' : 'stream'; },
  set onUnauthorized(fn) { state.onUnauthorized = fn; }
};

export async function api(method, url, { json, headers } = {}) {
  let response;
  try {
    response = await fetch(url, {
      method, credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(json ? { 'Content-Type': 'application/json' } : {}), ...(state.csrf && method !== 'GET' ? { 'X-CSRF-Token': state.csrf } : {}), ...headers },
      body: json ? JSON.stringify(json) : undefined
    });
  } catch {
    throw new ApiError('Server tidak dapat dihubungi.', 0);
  }
  let data = null;
  try { data = await response.json(); } catch { /* tanpa body */ }
  if (response.status === 401 && !url.endsWith('/login')) state.onUnauthorized?.();
  if (!response.ok) throw new ApiError(data?.error || `Permintaan gagal (${response.status}).`, response.status);
  return data;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function parse(xhr) {
  try { return JSON.parse(xhr.responseText); } catch { return null; }
}

/** Satu request PUT dengan progres. path = URL lengkap, body = Blob. */
function putBlob({ url, body, type, signal, onProgress }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.withCredentials = true;
    xhr.setRequestHeader('X-CSRF-Token', state.csrf);
    xhr.setRequestHeader('Content-Type', type);
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress?.(event.loaded); };
    xhr.onload = () => {
      const data = parse(xhr);
      if (xhr.status === 401) state.onUnauthorized?.();
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(data?.error || `Upload gagal (${xhr.status}).`, xhr.status));
    };
    xhr.onerror = () => reject(new ApiError('Koneksi terputus saat upload.', 0));
    xhr.onabort = () => reject(new ApiError('Dibatalkan.', -1));
    if (signal?.aborted) { reject(new ApiError('Dibatalkan.', -1)); return; }
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

/** Mode stream: satu request, body mentah (server biasa). */
function uploadWhole({ file, parent, signal, onProgress }) {
  return putBlob({
    url: `/api/admin/upload?parent=${encodeURIComponent(parent)}&name=${encodeURIComponent(file.name)}`,
    body: file, type: file.type || 'application/octet-stream', signal,
    onProgress: loaded => onProgress?.(loaded / Math.max(1, file.size))
  });
}

/**
 * Mode chunk (Vercel): dipotong per ~4 MB karena fungsi serverless menolak body > 4,5 MB.
 * Gangguan jaringan/5xx -> tanya server posisi terakhir yang tersimpan lalu lanjutkan (maks. 4 kali beruntun).
 */
async function uploadChunked({ file, parent, signal, onProgress }) {
  const init = await api('POST', '/api/admin/upload/init', { json: { parent, name: file.name, size: file.size, type: file.type || 'application/octet-stream' } });
  if (init.done) { onProgress?.(1); return { item: init.item, renamed: init.renamed }; }
  let offset = 0;
  let failures = 0;
  while (offset < file.size) {
    if (signal?.aborted) throw new ApiError('Dibatalkan.', -1);
    const end = Math.min(offset + init.chunkSize, file.size);
    const base = offset;
    try {
      const result = await putBlob({
        url: `/api/admin/upload/chunk?token=${encodeURIComponent(init.token)}&start=${base}`,
        body: file.slice(base, end), type: 'application/octet-stream', signal,
        onProgress: loaded => onProgress?.((base + loaded) / file.size)
      });
      if (result.done) { onProgress?.(1); return { item: result.item, renamed: init.renamed }; }
      failures = result.next > base ? 0 : failures + 1;
      if (failures > 4) throw new ApiError('Upload tidak maju. Coba lagi.', 502);
      offset = result.next;
    } catch (error) {
      const retryable = error.status === 0 || error.status === 502 || error.status === 503 || error.status === 504 || error.status === 429;
      failures += 1;
      if (!retryable || failures > 4) throw error;
      await sleep(800 * failures);
      const status = await api('GET', `/api/admin/upload/status?token=${encodeURIComponent(init.token)}`);
      if (status.done) { onProgress?.(1); return { item: status.item, renamed: init.renamed }; }
      offset = status.next;
    }
  }
  throw new ApiError('Upload berakhir tanpa konfirmasi dari server.', 502);
}

/** Upload satu file. Mengembalikan { item, renamed }. */
export function uploadFile(options) {
  return state.uploadMode === 'chunk' ? uploadChunked(options) : uploadWhole(options);
}
