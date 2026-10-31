import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Parser .env minimal (tanpa dependensi). Tidak menimpa variabel yang sudah ada di environment. */
export function parseEnvFile(text) {
  const out = {};
  for (const raw of String(text).replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '');
    out[match[1]] = value;
  }
  return out;
}

export function loadEnvFile(file = path.join(PROJECT_ROOT, '.env')) {
  try {
    const parsed = parseEnvFile(fs.readFileSync(file, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) if (process.env[key] === undefined) process.env[key] = value;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function normaliseAdminPath(value) {
  const fallback = '/admin';
  if (!value) return fallback;
  let p = String(value).trim();
  if (!p.startsWith('/')) p = `/${p}`;
  p = p.replace(/\/+$/, '');
  if (!/^\/[A-Za-z0-9._~\-/]+$/.test(p)) return fallback;
  if (/^\/(api|assets)(\/|$)/.test(p)) return fallback;
  return p;
}

export function loadConfig(env = process.env) {
  const number = (key, fallback, { min = -Infinity, max = Infinity } = {}) => {
    const raw = env[key];
    if (raw === undefined || raw === '') return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  const onVercel = Boolean(env.VERCEL);
  const production = env.NODE_ENV === 'production' || onVercel;
  const secretFromEnv = env.APP_SECRET || '';
  const trust = env.TRUST_PROXY;

  const hasDriveCreds = Boolean(env.GOOGLE_REFRESH_TOKEN);
  const backend = (env.STORAGE_BACKEND || (hasDriveCreds ? 'drive' : 'local')).toLowerCase();

  return {
    production,
    port: number('PORT', 8787, { min: 1, max: 65535 }),
    host: env.HOST || (production ? '0.0.0.0' : '127.0.0.1'),
    onVercel,
    trustProxy: (trust === undefined || trust === '') && onVercel ? 1 : trust === undefined || trust === '' || trust === 'false' ? false : (trust === 'true' ? true : (Number.isFinite(Number(trust)) ? Number(trust) : trust)),
    allowedOrigins: String(env.ALLOWED_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean),
    adminPath: onVercel ? '/admin' : normaliseAdminPath(env.ADMIN_PATH),
    admin: {
      username: env.ADMIN_USERNAME || 'admin',
      passwordHash: env.ADMIN_PASSWORD_HASH || ''
    },
    session: {
      ttlMs: number('SESSION_HOURS', 8, { min: 0.25, max: 168 }) * 3600_000,
      idleMs: number('SESSION_IDLE_MINUTES', 120, { min: 5, max: 1440 }) * 60_000,
      epoch: env.SESSION_EPOCH || ''
    },
    // stream = file dialirkan dalam satu request (server biasa) · chunk = dipotong 4 MB per request (Vercel, batas body 4,5 MB)
    uploadMode: (env.UPLOAD_MODE || (onVercel ? 'chunk' : 'stream')).toLowerCase(),
    secret: secretFromEnv || crypto.randomBytes(48).toString('base64url'),
    secretIsGenerated: !secretFromEnv,
    maxUploadBytes: Math.floor(number('MAX_UPLOAD_MB', 200, { min: 1, max: 20480 }) * 1024 * 1024),
    pageSize: number('PAGE_SIZE', 100, { min: 10, max: 200 }),
    storage: {
      backend,
      local: { dir: path.resolve(PROJECT_ROOT, env.LOCAL_STORAGE_DIR || './data/storage') },
      drive: {
        clientId: env.GOOGLE_CLIENT_ID || '',
        clientSecret: env.GOOGLE_CLIENT_SECRET || '',
        refreshToken: env.GOOGLE_REFRESH_TOKEN || '',
        rootFolderId: env.DRIVE_ROOT_FOLDER_ID || '',
        tokenUrl: env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token',
        apiBase: env.DRIVE_API_BASE || 'https://www.googleapis.com/drive/v3',
        uploadBase: env.DRIVE_UPLOAD_BASE || 'https://www.googleapis.com/upload/drive/v3'
      }
    }
  };
}

/** Kembalikan { errors, warnings }. errors = server tidak boleh start. */
export function validateConfig(config) {
  const errors = [];
  const warnings = [];
  if (config.production && config.secretIsGenerated) errors.push('APP_SECRET wajib diisi di production (minimal 32 karakter acak).');
  if (!config.secretIsGenerated && config.secret.length < 32) errors.push('APP_SECRET terlalu pendek (minimal 32 karakter).');
  if (!['drive', 'local'].includes(config.storage.backend)) errors.push('STORAGE_BACKEND harus "drive" atau "local".');
  if (config.storage.backend === 'drive') {
    const d = config.storage.drive;
    for (const [key, env] of [['clientId', 'GOOGLE_CLIENT_ID'], ['clientSecret', 'GOOGLE_CLIENT_SECRET'], ['refreshToken', 'GOOGLE_REFRESH_TOKEN'], ['rootFolderId', 'DRIVE_ROOT_FOLDER_ID']]) {
      if (!d[key]) errors.push(`${env} belum diisi (diperlukan untuk STORAGE_BACKEND=drive).`);
    }
  }
  if (!['stream', 'chunk'].includes(config.uploadMode)) errors.push('UPLOAD_MODE harus "stream" atau "chunk".');
  if (config.uploadMode === 'chunk' && config.storage.backend !== 'drive') errors.push('UPLOAD_MODE=chunk hanya didukung untuk STORAGE_BACKEND=drive.');
  if (config.onVercel && config.storage.backend === 'local') errors.push('Vercel tidak mendukung penyimpanan lokal. Gunakan STORAGE_BACKEND=drive.');
  if (config.storage.backend === 'local') warnings.push('STORAGE_BACKEND=local: file disimpan di disk server (untuk uji coba). Untuk Google Drive isi kredensial GOOGLE_* dan set STORAGE_BACKEND=drive.');
  if (!/^scrypt:\d+:\d+:\d+:[\w-]+:[\w-]+$/.test(config.admin.passwordHash)) warnings.push('ADMIN_PASSWORD_HASH belum valid/kosong: login admin DINONAKTIFKAN. Jalankan "npm run admin:hash".');
  if (config.secretIsGenerated) warnings.push('APP_SECRET tidak diisi: dibuat acak sementara. Sesi login dan ID item akan berubah setiap server restart.');
  return { errors, warnings };
}
