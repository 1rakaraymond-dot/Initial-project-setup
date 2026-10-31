import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';
import { HttpError } from '../errors.js';

const RANGE_END = /bytes=0-(\d+)/;

const FOLDER = 'application/vnd.google-apps.folder';
const EXPORTABLE = new Set([
  'application/vnd.google-apps.document', 'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.presentation', 'application/vnd.google-apps.drawing'
]);
const FIELDS = 'id,name,mimeType,size,modifiedTime';
const quote = value => `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function putStream(urlString, headers, source) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const request = (url.protocol === 'https:' ? https : http).request(url, { method: 'PUT', headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      response.on('error', reject);
    });
    request.on('error', reject);
    source.on('error', error => request.destroy(error));
    source.on('aborted', () => request.destroy(new Error('Klien membatalkan upload.')));
    source.pipe(request);
  });
}

/**
 * Adapter Google Drive (REST) yang berjalan di SERVER dengan refresh token milik pemilik.
 * Browser tidak pernah menerima ID/link/API key Drive. Setiap operasi diverifikasi bahwa target
 * berada di dalam folder root arsip.
 */
export class DriveStorage {
  constructor(options) {
    this.kind = 'drive';
    this.o = options;
    this.rootId = options.rootFolderId;
    this.token = null;
    this.tokenPromise = null;
    this.metaCache = new Map();
    this.sessionOrigin = new URL(options.uploadBase).origin;
  }

  // ---- OAuth ----------------------------------------------------------------------------
  async #accessToken(force = false) {
    if (!force && this.token && Date.now() < this.token.expiresAt) return this.token.value;
    if (this.tokenPromise) return this.tokenPromise;
    this.tokenPromise = (async () => {
      const response = await fetch(this.o.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token', refresh_token: this.o.refreshToken,
          client_id: this.o.clientId, client_secret: this.o.clientSecret
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.access_token) {
        console.error('[storage] Gagal menukar refresh token:', response.status, data.error || '', data.error_description || '');
        throw new HttpError(502, 'Penyimpanan tidak dapat diakses. Periksa kredensial server.');
      }
      this.token = { value: data.access_token, expiresAt: Date.now() + Math.max(60, Number(data.expires_in || 3600) - 120) * 1000 };
      return this.token.value;
    })().finally(() => { this.tokenPromise = null; });
    return this.tokenPromise;
  }

  async #request(url, { method = 'GET', headers = {}, body, retry = true, signal } = {}) {
    const token = await this.#accessToken();
    const response = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, ...headers }, body, signal });
    if (response.status === 401 && retry) {
      await this.#accessToken(true);
      return this.#request(url, { method, headers, body, retry: false, signal });
    }
    return response;
  }

  async #json(url, options) {
    const response = await this.#request(url, options);
    if (!response.ok) throw await this.#fail(response);
    return response.status === 204 ? null : response.json();
  }

  async #fail(response) {
    let detail = '';
    try { detail = (await response.json())?.error?.message || ''; } catch { /* bukan JSON */ }
    console.error('[storage] Drive API', response.status, detail);
    if (response.status === 404) return new HttpError(404, 'Item tidak ditemukan.');
    if (response.status === 429 || response.status === 403 && /rate|quota/i.test(detail)) return new HttpError(503, 'Penyimpanan sedang sibuk atau kuota habis. Coba lagi nanti.');
    if (response.status === 403 || response.status === 401) return new HttpError(502, 'Penyimpanan menolak akses. Periksa izin akun server.');
    return new HttpError(502, 'Penyimpanan mengembalikan kesalahan.');
  }

  #files(path = '', params = {}) {
    const url = new URL(`${this.o.apiBase}/files${path}`);
    url.searchParams.set('supportsAllDrives', 'true');
    for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key, value);
    return url.toString();
  }

  // ---- Metadata & pengecekan root ---------------------------------------------------------
  async #meta(id) {
    const cached = this.metaCache.get(id);
    if (cached && Date.now() - cached.time < 30_000) return cached.data;
    const response = await this.#request(this.#files(`/${encodeURIComponent(id)}`, { fields: `${FIELDS},parents,trashed` }));
    if (response.status === 404) { this.metaCache.set(id, { time: Date.now(), data: null }); return null; }
    if (!response.ok) throw await this.#fail(response);
    const data = await response.json();
    this.metaCache.set(id, { time: Date.now(), data });
    return data;
  }

  #invalidate() { this.metaCache.clear(); }

  async init() {
    const meta = await this.#meta(this.rootId);
    if (!meta || meta.mimeType !== FOLDER) throw new Error('DRIVE_ROOT_FOLDER_ID bukan folder yang dapat diakses oleh akun server.');
    return { name: meta.name };
  }

  async contains(id) {
    if (id === this.rootId) return true;
    if (typeof id !== 'string' || !/^[\w-]{10,100}$/.test(id)) return false;
    let current = id;
    for (let depth = 0; depth < 64; depth += 1) {
      const meta = await this.#meta(current);
      if (!meta || meta.trashed) return false;
      const parents = meta.parents || [];
      if (parents.includes(this.rootId)) return true;
      if (!parents.length) return false;
      current = parents[0];
    }
    return false;
  }

  #toItem(file) {
    const isFolder = file.mimeType === FOLDER;
    const native = file.mimeType?.startsWith('application/vnd.google-apps.') && !isFolder;
    if (native && !EXPORTABLE.has(file.mimeType)) return null;
    return {
      id: file.id,
      name: native ? `${file.name}.pdf` : file.name,
      isFolder,
      mimeType: isFolder ? '' : (native ? 'application/pdf' : (file.mimeType || 'application/octet-stream')),
      size: native || isFolder ? 0 : Number(file.size || 0),
      modifiedTime: file.modifiedTime,
      native
    };
  }

  async getItem(id) {
    const meta = await this.#meta(id);
    return meta && !meta.trashed ? this.#toItem(meta) : null;
  }

  async listChildren(parentId, { pageToken, pageSize = 100 } = {}) {
    const data = await this.#json(this.#files('', {
      q: `${quote(parentId)} in parents and trashed = false`,
      pageSize: String(pageSize), orderBy: 'folder,name', includeItemsFromAllDrives: 'true',
      fields: `files(${FIELDS}),nextPageToken`, pageToken: pageToken || undefined
    }));
    return { items: (data.files || []).map(file => this.#toItem(file)).filter(Boolean), nextPageToken: data.nextPageToken };
  }

  async nameExists(parentId, name) {
    const data = await this.#json(this.#files('', {
      q: `${quote(parentId)} in parents and name = ${quote(name)} and trashed = false`, pageSize: '1', fields: 'files(id)', includeItemsFromAllDrives: 'true'
    }));
    return (data.files || []).length > 0;
  }

  // ---- Mutasi ------------------------------------------------------------------------------
  async createFolder(parentId, name) {
    if (await this.nameExists(parentId, name)) throw new HttpError(409, 'Nama sudah dipakai di folder ini.');
    const file = await this.#json(this.#files('', { fields: FIELDS }), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER, parents: [parentId] })
    });
    this.#invalidate();
    return this.#toItem(file);
  }

  async ensureFolderPath(parentId, segments) {
    let current = parentId;
    let item = null;
    for (const segment of segments) {
      const data = await this.#json(this.#files('', {
        q: `${quote(current)} in parents and name = ${quote(segment)} and mimeType = ${quote(FOLDER)} and trashed = false`,
        pageSize: '1', fields: `files(${FIELDS})`, includeItemsFromAllDrives: 'true'
      }));
      item = data.files?.[0] ? this.#toItem(data.files[0]) : await this.createFolder(current, segment);
      current = item.id;
    }
    return item;
  }

  async rename(id, name) {
    const meta = await this.#meta(id);
    if (!meta) throw new HttpError(404, 'Item tidak ditemukan.');
    const parent = meta.parents?.[0];
    const clean = this.#stripNativeSuffix(meta, name);
    if (clean === meta.name) return this.#toItem(meta);
    if (parent && await this.nameExists(parent, clean)) throw new HttpError(409, 'Nama sudah dipakai di folder ini.');
    const file = await this.#json(this.#files(`/${encodeURIComponent(id)}`, { fields: FIELDS }), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: clean })
    });
    this.#invalidate();
    return this.#toItem(file);
  }

  #stripNativeSuffix(meta, name) {
    return EXPORTABLE.has(meta.mimeType) && name.toLowerCase().endsWith('.pdf') ? name.slice(0, -4) || name : name;
  }

  async move(id, newParentId) {
    const meta = await this.#meta(id);
    if (!meta) throw new HttpError(404, 'Item tidak ditemukan.');
    const target = await this.#meta(newParentId);
    if (newParentId !== this.rootId && (!target || target.mimeType !== FOLDER)) throw new HttpError(400, 'Tujuan bukan folder.');
    if (meta.mimeType === FOLDER) {
      let walker = newParentId;
      for (let i = 0; i < 64 && walker && walker !== this.rootId; i += 1) {
        if (walker === id) throw new HttpError(400, 'Folder tidak dapat dipindahkan ke dalam dirinya sendiri.');
        walker = (await this.#meta(walker))?.parents?.[0];
      }
      if (newParentId === id) throw new HttpError(400, 'Folder tidak dapat dipindahkan ke dalam dirinya sendiri.');
    }
    const oldParents = meta.parents || [];
    if (oldParents.length === 1 && oldParents[0] === newParentId) return this.#toItem(meta);
    if (await this.nameExists(newParentId, meta.name)) throw new HttpError(409, 'Di folder tujuan sudah ada item dengan nama yang sama.');
    const file = await this.#json(this.#files(`/${encodeURIComponent(id)}`, { addParents: newParentId, removeParents: oldParents.join(','), fields: FIELDS }), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}'
    });
    this.#invalidate();
    return this.#toItem(file);
  }

  /** Pindah ke sampah Drive (dapat dipulihkan dari Drive selama 30 hari), bukan hapus permanen. */
  async trash(id) {
    await this.#json(this.#files(`/${encodeURIComponent(id)}`, { fields: 'id' }), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true })
    });
    this.#invalidate();
  }

  async upload(parentId, name, mimeType, size, stream) {
    const metadata = JSON.stringify({ name, parents: [parentId], ...(size === 0 ? { mimeType } : {}) });
    if (size === 0) {
      stream.resume();
      const file = await this.#json(this.#files('', { fields: FIELDS }), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: metadata });
      this.#invalidate();
      return this.#toItem(file);
    }
    const initUrl = new URL(`${this.o.uploadBase}/files`);
    initUrl.searchParams.set('uploadType', 'resumable');
    initUrl.searchParams.set('supportsAllDrives', 'true');
    initUrl.searchParams.set('fields', FIELDS);
    const init = await this.#request(initUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mimeType, 'X-Upload-Content-Length': String(size) },
      body: JSON.stringify({ name, parents: [parentId] })
    });
    if (!init.ok) throw await this.#fail(init);
    const session = init.headers.get('location');
    if (!session) throw new HttpError(502, 'Penyimpanan tidak mengembalikan sesi upload.');
    const token = await this.#accessToken();
    const result = await putStream(session, { 'Content-Length': String(size), 'Content-Type': mimeType, Authorization: `Bearer ${token}` }, stream);
    if (result.status < 200 || result.status > 299) {
      console.error('[storage] Upload gagal', result.status, result.body.slice(0, 300));
      throw new HttpError(502, 'Upload ke penyimpanan gagal.');
    }
    this.#invalidate();
    return this.#toItem(JSON.parse(result.body));
  }

  // ---- Upload per bagian (untuk hosting dengan batas body kecil seperti Vercel) ---------------------
  /** Membuat sesi upload resumable. URL sesi bersifat rahasia dan HANYA dipegang server (dibungkus token terenkripsi). */
  async createUploadSession(parentId, name, mimeType, size) {
    const initUrl = new URL(`${this.o.uploadBase}/files`);
    initUrl.searchParams.set('uploadType', 'resumable');
    initUrl.searchParams.set('supportsAllDrives', 'true');
    initUrl.searchParams.set('fields', FIELDS);
    const init = await this.#request(initUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mimeType, 'X-Upload-Content-Length': String(size) },
      body: JSON.stringify({ name, parents: [parentId] })
    });
    if (!init.ok) throw await this.#fail(init);
    const session = init.headers.get('location');
    if (!session) throw new HttpError(502, 'Penyimpanan tidak mengembalikan sesi upload.');
    return session;
  }

  async #sessionPut(sessionUrl, headers, body) {
    const token = await this.#accessToken();
    const response = await fetch(sessionUrl, { method: 'PUT', redirect: 'manual', headers: { Authorization: `Bearer ${token}`, ...headers }, body });
    if (response.status === 308) {
      const match = RANGE_END.exec(response.headers.get('range') || '');
      return { done: false, next: match ? Number(match[1]) + 1 : 0 };
    }
    if (response.status === 200 || response.status === 201) {
      this.#invalidate();
      return { done: true, item: this.#toItem(await response.json()) };
    }
    if (response.status === 404 || response.status === 410) throw new HttpError(410, 'Sesi upload sudah kedaluwarsa. Ulangi upload.');
    throw await this.#fail(response);
  }

  /** Kirim satu bagian. start = offset byte pertama bagian ini, size = ukuran total file. */
  uploadChunk(sessionUrl, start, buffer, size) {
    return this.#sessionPut(sessionUrl, { 'Content-Length': String(buffer.length), 'Content-Range': `bytes ${start}-${start + buffer.length - 1}/${size}` }, buffer);
  }

  /** Tanyakan berapa byte yang sudah diterima (untuk melanjutkan setelah gangguan). */
  uploadStatus(sessionUrl, size) {
    return this.#sessionPut(sessionUrl, { 'Content-Length': '0', 'Content-Range': `bytes */${size}` });
  }

  async openDownload(id, { range } = {}) {
    const meta = await this.#meta(id);
    if (!meta || meta.trashed) throw new HttpError(404, 'Item tidak ditemukan.');
    if (meta.mimeType === FOLDER) throw new HttpError(400, 'Hanya file yang dapat diunduh.');
    const item = this.#toItem(meta);
    if (!item) throw new HttpError(400, 'Jenis file ini tidak dapat diunduh.');
    const controller = new AbortController();
    const url = item.native
      ? this.#files(`/${encodeURIComponent(id)}/export`, { mimeType: 'application/pdf' })
      : this.#files(`/${encodeURIComponent(id)}`, { alt: 'media' });
    const response = await this.#request(url, { headers: !item.native && range ? { Range: range } : {}, signal: controller.signal });
    if (response.status === 416) throw Object.assign(new HttpError(416, 'Rentang tidak valid.'), { contentRange: response.headers.get('content-range') || undefined });
    if (!response.ok) throw await this.#fail(response);
    const length = response.headers.get('content-length');
    return {
      status: response.status === 206 ? 206 : 200,
      mimeType: item.mimeType, filename: item.name,
      contentLength: length ? Number(length) : undefined,
      contentRange: response.headers.get('content-range') || undefined,
      stream: Readable.fromWeb(response.body),
      close: () => controller.abort()
    };
  }
}
