import fs from 'node:fs/promises';
import { createWriteStream, createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { HttpError } from '../errors.js';
import { parseRange } from '../util.js';

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', json: 'application/json', csv: 'text/csv', html: 'text/html',
  mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', zip: 'application/zip'
};
const mimeFor = name => MIME[String(name).split('.').pop().toLowerCase()] || 'application/octet-stream';

/**
 * Penyimpanan di disk server. Dipakai untuk uji coba/pengembangan tanpa kredensial Google,
 * dan sebagai referensi antarmuka yang sama dengan adapter Google Drive.
 * ID item = path relatif (posix); root = ".".
 */
export class LocalStorage {
  constructor({ dir }) {
    this.kind = 'local';
    this.base = path.resolve(dir);
    this.rootId = '.';
  }

  async init() {
    await fs.mkdir(path.join(this.base, '.trash'), { recursive: true });
    this.real = await fs.realpath(this.base);
    return { name: path.basename(this.base) };
  }

  #abs(id) {
    if (typeof id !== 'string' || id.includes('\0')) throw new HttpError(400, 'ID tidak valid.');
    const normal = path.posix.normalize(id.replaceAll('\\', '/'));
    if (path.posix.isAbsolute(normal) || normal === '..' || normal.startsWith('../')) throw new HttpError(400, 'ID tidak valid.');
    const abs = path.resolve(this.base, normal);
    if (abs !== this.base && !abs.startsWith(this.base + path.sep)) throw new HttpError(400, 'ID tidak valid.');
    return abs;
  }

  #rel(abs) {
    const rel = path.relative(this.base, abs).split(path.sep).join('/');
    return rel || '.';
  }

  async contains(id) {
    try {
      const abs = this.#abs(id);
      const rel = this.#rel(abs);
      if (rel !== '.' && rel.split('/').some(part => part.startsWith('.'))) return false;
      const real = await fs.realpath(abs);
      return real === this.real || real.startsWith(this.real + path.sep);
    } catch {
      return false;
    }
  }

  async #item(abs, stat) {
    const name = path.basename(abs);
    return {
      id: this.#rel(abs), name, isFolder: stat.isDirectory(),
      mimeType: stat.isDirectory() ? '' : mimeFor(name),
      size: stat.isDirectory() ? 0 : stat.size,
      modifiedTime: stat.mtime.toISOString()
    };
  }

  async getItem(id) {
    try {
      const abs = this.#abs(id);
      return await this.#item(abs, await fs.stat(abs));
    } catch (error) {
      if (error instanceof HttpError) throw error;
      return null;
    }
  }

  async listChildren(parentId, { pageToken, pageSize = 100 } = {}) {
    const abs = this.#abs(parentId);
    let entries;
    try { entries = await fs.readdir(abs, { withFileTypes: true }); } catch { throw new HttpError(404, 'Folder tidak ditemukan.'); }
    const rows = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      if (!entry.isDirectory() && !entry.isFile()) continue;
      try { rows.push(await this.#item(path.join(abs, entry.name), await fs.stat(path.join(abs, entry.name)))); } catch { /* hilang di tengah jalan */ }
    }
    rows.sort((a, b) => Number(b.isFolder) - Number(a.isFolder) || a.name.localeCompare(b.name, 'id'));
    const start = pageToken && /^\d{1,9}$/.test(pageToken) ? Number(pageToken) : 0;
    const items = rows.slice(start, start + pageSize);
    return { items, nextPageToken: start + pageSize < rows.length ? String(start + pageSize) : undefined };
  }

  async nameExists(parentId, name) {
    try { await fs.lstat(path.join(this.#abs(parentId), name)); return true; } catch { return false; }
  }

  async createFolder(parentId, name) {
    const abs = path.join(this.#abs(parentId), name);
    try { await fs.mkdir(abs); } catch (error) {
      if (error.code === 'EEXIST') throw new HttpError(409, 'Nama sudah dipakai di folder ini.');
      throw error;
    }
    return this.#item(abs, await fs.stat(abs));
  }

  async ensureFolderPath(parentId, segments) {
    let current = this.#abs(parentId);
    for (const segment of segments) {
      current = path.join(current, segment);
      try { await fs.mkdir(current); } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (!(await fs.stat(current)).isDirectory()) throw new HttpError(409, `"${segment}" sudah ada sebagai file.`);
      }
    }
    return this.#item(current, await fs.stat(current));
  }

  async rename(id, name) {
    const abs = this.#abs(id);
    const target = path.join(path.dirname(abs), name);
    if (target === abs) return this.#item(abs, await fs.stat(abs));
    if (await fs.lstat(target).then(() => true, () => false)) throw new HttpError(409, 'Nama sudah dipakai di folder ini.');
    await fs.rename(abs, target);
    return this.#item(target, await fs.stat(target));
  }

  async move(id, newParentId) {
    const abs = this.#abs(id);
    const destDir = this.#abs(newParentId);
    if (!(await fs.stat(destDir)).isDirectory()) throw new HttpError(400, 'Tujuan bukan folder.');
    if (destDir === abs || destDir.startsWith(abs + path.sep)) throw new HttpError(400, 'Folder tidak dapat dipindahkan ke dalam dirinya sendiri.');
    const target = path.join(destDir, path.basename(abs));
    if (target === abs) return this.#item(abs, await fs.stat(abs));
    if (await fs.lstat(target).then(() => true, () => false)) throw new HttpError(409, 'Di folder tujuan sudah ada item dengan nama yang sama.');
    await fs.rename(abs, target);
    return this.#item(target, await fs.stat(target));
  }

  async trash(id) {
    const abs = this.#abs(id);
    const dest = path.join(this.base, '.trash', `${Date.now()}-${crypto.randomBytes(3).toString('hex')}-${path.basename(abs)}`);
    await fs.rename(abs, dest);
  }

  async upload(parentId, name, mimeType, size, stream) {
    const dir = this.#abs(parentId);
    const tmp = path.join(this.base, '.trash', `upload-${crypto.randomBytes(8).toString('hex')}.part`);
    try {
      await pipeline(stream, createWriteStream(tmp, { flags: 'wx' }));
      const written = (await fs.stat(tmp)).size;
      if (Number.isFinite(size) && written !== size) throw new HttpError(400, 'Upload tidak lengkap.');
      const target = path.join(dir, name);
      try { await fs.link(tmp, target); } catch (error) {
        if (error.code === 'EEXIST') throw new HttpError(409, 'Nama sudah dipakai di folder ini.');
        throw error;
      }
      return this.#item(target, await fs.stat(target));
    } finally {
      await fs.rm(tmp, { force: true });
    }
  }

  async openDownload(id, { range } = {}) {
    const abs = this.#abs(id);
    const stat = await fs.stat(abs);
    if (!stat.isFile()) throw new HttpError(400, 'Hanya file yang dapat diunduh.');
    const parsed = parseRange(range, stat.size);
    if (parsed === 'invalid') throw Object.assign(new HttpError(416, 'Rentang tidak valid.'), { contentRange: `bytes */${stat.size}` });
    const filename = path.basename(abs);
    const base = { mimeType: mimeFor(filename), filename, close() {} };
    if (parsed) {
      const stream = createReadStream(abs, { start: parsed.start, end: parsed.end });
      return { ...base, status: 206, contentLength: parsed.end - parsed.start + 1, contentRange: `bytes ${parsed.start}-${parsed.end}/${stat.size}`, stream, close: () => stream.destroy() };
    }
    const stream = createReadStream(abs);
    return { ...base, status: 200, contentLength: stat.size, stream, close: () => stream.destroy() };
  }
}
