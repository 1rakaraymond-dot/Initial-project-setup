export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

const state = { csrf: '', onUnauthorized: null };
export const session = {
  get csrf() { return state.csrf; },
  set csrf(value) { state.csrf = value || ''; },
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

/** Upload satu file sebagai body mentah, dengan progres. Mengembalikan { item, renamed }. */
export function uploadFile({ file, parent, signal, onProgress }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `/api/admin/upload?parent=${encodeURIComponent(parent)}&name=${encodeURIComponent(file.name)}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('X-CSRF-Token', state.csrf);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress?.(event.loaded / event.total); };
    xhr.onload = () => {
      let data = null; try { data = JSON.parse(xhr.responseText); } catch { /* bukan JSON */ }
      if (xhr.status === 401) state.onUnauthorized?.();
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(data?.error || `Upload gagal (${xhr.status}).`, xhr.status));
    };
    xhr.onerror = () => reject(new ApiError('Koneksi terputus saat upload.', 0));
    xhr.onabort = () => reject(new ApiError('Dibatalkan.', -1));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}
