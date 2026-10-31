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

/** Sesi admin disimpan di memori server (token acak; hanya hash-nya yang disimpan). */
export class SessionStore {
  constructor({ ttlMs, idleMs }) {
    this.ttlMs = ttlMs;
    this.idleMs = idleMs;
    this.map = new Map();
    this.timer = setInterval(() => this.sweep(), 10 * 60_000);
    this.timer.unref();
  }

  #key(token) { return sha256(token).toString('hex'); }

  create() {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    const session = { csrf: crypto.randomBytes(24).toString('base64url'), created: now, last: now };
    this.map.set(this.#key(token), session);
    return { token, session };
  }

  get(token) {
    if (!token || typeof token !== 'string' || token.length > 100) return null;
    const key = this.#key(token);
    const session = this.map.get(key);
    if (!session) return null;
    const now = Date.now();
    if (now - session.created > this.ttlMs || now - session.last > this.idleMs) { this.map.delete(key); return null; }
    session.last = now;
    return session;
  }

  destroy(token) { if (token) this.map.delete(this.#key(token)); }
  sweep() { for (const [key, s] of this.map) if (Date.now() - s.created > this.ttlMs || Date.now() - s.last > this.idleMs) this.map.delete(key); }
  close() { clearInterval(this.timer); }
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}
