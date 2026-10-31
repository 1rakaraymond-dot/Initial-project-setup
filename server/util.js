/** Bersihkan nama file/folder dari klien. Mengembalikan null bila tidak valid. */
export function cleanName(value, maxLength = 200) {
  if (typeof value !== 'string') return null;
  let name = value.normalize('NFC')
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/[\\/]+/g, '_')
    .trim()
    .replace(/[. ]+$/, '');
  if (name.length > maxLength) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 && name.length - dot <= 12 ? name.slice(dot) : '';
    name = name.slice(0, maxLength - ext.length) + ext;
  }
  if (!name || name === '.' || name === '..') return null;
  return name;
}

/** "laporan.pdf" + 2 -> "laporan (2).pdf" */
export function numberedName(name, n) {
  const dot = name.lastIndexOf('.');
  if (dot > 0 && name.length - dot <= 12) return `${name.slice(0, dot)} (${n})${name.slice(dot)}`;
  return `${name} (${n})`;
}

export function contentDisposition(filename, type = 'attachment') {
  const ascii = String(filename).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** Parse header Range: bytes=a-b. Return { start, end } | 'invalid' | null (tidak ada range). */
export function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!match || (match[1] === '' && match[2] === '') || !Number.isFinite(size) || size <= 0) return 'invalid';
  let start;
  let end;
  if (match[1] === '') {
    const suffix = Number(match[2]);
    if (!suffix) return 'invalid';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  if (start > end || start >= size) return 'invalid';
  return { start, end };
}

const MIME_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i;
export function cleanMime(value) {
  const base = String(value || '').split(';')[0].trim().toLowerCase();
  return MIME_RE.test(base) ? base : 'application/octet-stream';
}

export const FOLDER_MIME = 'application/x-archive-folder';

/** Hanya tipe ini yang boleh ditampilkan inline (bukan HTML/SVG, supaya tidak jadi vektor XSS). */
export const INLINE_SAFE = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'application/pdf', 'text/plain',
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'video/mp4', 'video/webm'
]);
