import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const FORMAT = /^scrypt:(\d+):(\d+):(\d+):([\w-]+):([\w-]+)$/;
const MAXMEM = 256 * 1024 * 1024;

export async function hashPassword(password, { N = 65536, r = 8, p = 1 } = {}) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 32, { N, r, p, maxmem: MAXMEM });
  return `scrypt:${N}:${r}:${p}:${salt.toString('base64url')}:${key.toString('base64url')}`;
}

export async function verifyPassword(password, stored) {
  const match = FORMAT.exec(stored || '');
  if (!match || typeof password !== 'string') return false;
  const [, N, r, p, salt, hash] = match;
  const expected = Buffer.from(hash, 'base64url');
  const key = await scrypt(password, Buffer.from(salt, 'base64url'), expected.length, { N: Number(N), r: Number(r), p: Number(p), maxmem: MAXMEM });
  return crypto.timingSafeEqual(key, expected);
}

export const sha256 = value => crypto.createHash('sha256').update(String(value)).digest();

export function safeEqual(a, b) {
  return crypto.timingSafeEqual(sha256(a), sha256(b));
}

/**
 * Sesi admin STATELESS: cookie bertanda tangan HMAC (tidak ada penyimpanan di server), sehingga aman di
 * lingkungan serverless (Vercel) maupun server biasa. Token CSRF diturunkan dari id sesi.
 * Konsekuensi: logout menghapus cookie di browser, tetapi cookie yang sudah dicuri tetap valid sampai
 * kedaluwarsa. Ubah SESSION_EPOCH (atau APP_SECRET) untuk mencabut semua sesi sekaligus.
 */
export class SessionManager {
  constructor({ secret, ttlMs, idleMs, epoch = '' }) {
    this.ttlMs = ttlMs;
    this.idleMs = idleMs;
    this.key = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secret), Buffer.from('hunters-archive'), Buffer.from(`session-cookie:${epoch}`), 32));
  }

  #sign(body) { return crypto.createHmac('sha256', this.key).update(body).digest('base64url'); }
  #csrf(sid) { return crypto.createHmac('sha256', this.key).update(`csrf:${sid}`).digest('base64url'); }

  #issue(sid, iat, last) {
    const body = Buffer.from(JSON.stringify({ sid, iat, last })).toString('base64url');
    return `${body}.${this.#sign(body)}`;
  }

  create() {
    const sid = crypto.randomBytes(16).toString('base64url');
    const now = Date.now();
    return { token: this.#issue(sid, now, now), session: { csrf: this.#csrf(sid) } };
  }

  /** Mengembalikan { csrf, refreshed? } atau null. refreshed = token baru untuk menggeser batas idle. */
  get(token) {
    if (!token || typeof token !== 'string' || token.length > 400) return null;
    const dot = token.indexOf('.');
    if (dot < 1) return null;
    const body = token.slice(0, dot);
    const given = Buffer.from(token.slice(dot + 1));
    const expected = Buffer.from(this.#sign(body));
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
    let data;
    try { data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
    const now = Date.now();
    if (!data || typeof data.sid !== 'string' || !Number.isFinite(data.iat) || !Number.isFinite(data.last)) return null;
    if (now - data.iat > this.ttlMs || now - data.last > this.idleMs || data.iat > now + 60_000) return null;
    return { csrf: this.#csrf(data.sid), refreshed: now - data.last > 60_000 ? this.#issue(data.sid, data.iat, now) : undefined };
  }

  destroy() { /* stateless: cookie dihapus di browser oleh handler logout */ }
  sweep() {}
  close() {}
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}
