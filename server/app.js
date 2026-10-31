import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { HttpError } from './errors.js';
import { Readable } from 'node:stream';
import { createIdCodec, createSealer } from './idcodec.js';
import { SessionManager, verifyPassword, safeEqual, parseCookies } from './auth.js';
import { cleanName, cleanMime, numberedName, contentDisposition, FOLDER_MIME, INLINE_SAFE } from './util.js';
import { PROJECT_ROOT } from './config.js';

const COOKIE = 'ha_sid';
// Hash dummy supaya waktu respons login tidak membedakan "username salah" dan "password salah".
const DUMMY_HASH = 'scrypt:65536:8:1:AAAAAAAAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const wrap = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function createApp({ config, storage, distDir = path.join(PROJECT_ROOT, 'dist') }) {
  const app = express();
  const codec = createIdCodec(config.secret);
  const sealer = createSealer(config.secret);
  const sessions = new SessionManager({ secret: config.secret, ...config.session });
  const CHUNK_SIZE = 4 * 1024 * 1024; // < 4,5 MB (batas body Vercel) dan kelipatan 256 KiB (syarat Google)
  const QUANTUM = 256 * 1024;
  app.locals.sessions = sessions;

  app.disable('x-powered-by');
  if (config.trustProxy !== false) app.set('trust proxy', config.trustProxy);

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"], scriptSrc: ["'self'"],
        styleSrc: ["'self'", 'https://fonts.googleapis.com'], styleSrcAttr: ["'unsafe-inline'"],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'], imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"], mediaSrc: ["'self'", 'blob:'], objectSrc: ["'none'"],
        frameAncestors: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"],
        ...(config.production ? { upgradeInsecureRequests: [] } : {})
      }
    },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    strictTransportSecurity: config.production ? { maxAge: 15552000, includeSubDomains: true } : false
  }));

  // ---- Helper ID -----------------------------------------------------------------------------
  const toId = token => {
    if (token === undefined || token === '' || token === 'root') return storage.rootId;
    const id = codec.decode(token);
    if (id === null) throw new HttpError(400, 'ID tidak valid.');
    return id;
  };
  const encode = id => (id === storage.rootId ? 'root' : codec.encode(id));
  const inside = async (id, { allowRoot = true } = {}) => {
    if (id === storage.rootId) {
      if (!allowRoot) throw new HttpError(403, 'Folder utama tidak dapat diubah.');
      return;
    }
    if (!(await storage.contains(id))) throw new HttpError(404, 'Item tidak ditemukan.');
  };
  const toPublic = item => {
    const id = encode(item.id);
    const out = {
      id, name: item.name, mimeType: item.isFolder ? FOLDER_MIME : item.mimeType,
      size: item.isFolder ? 0 : item.size, modifiedTime: item.modifiedTime
    };
    if (!item.isFolder && INLINE_SAFE.has(item.mimeType)) out.previewUrl = `/api/files/${id}/download?inline=1`;
    return out;
  };
  const uniqueName = async (parentId, name) => {
    if (!(await storage.nameExists(parentId, name))) return name;
    for (let n = 1; n < 500; n += 1) {
      const candidate = numberedName(name, n);
      if (!(await storage.nameExists(parentId, candidate))) return candidate;
    }
    throw new HttpError(409, 'Terlalu banyak item dengan nama yang sama.');
  };
  const needName = value => {
    const name = cleanName(value);
    if (!name) throw new HttpError(400, 'Nama tidak valid.');
    return name;
  };

  // ---- Auth -------------------------------------------------------------------------------------
  const cookieOptions = req => ({
    httpOnly: true, sameSite: 'strict', path: '/', secure: req.secure || config.production,
    maxAge: config.session.ttlMs
  });
  const requireAdmin = (req, res, next) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    const session = sessions.get(token);
    if (!session) return next(new HttpError(401, 'Sesi admin tidak valid. Silakan masuk.'));
    req.adminSession = session;
    if (session.refreshed) res.cookie(COOKIE, session.refreshed, cookieOptions(req));
    return next();
  };
  const originAllowed = req => {
    // Sec-Fetch-Site dikirim browser modern dan tidak dapat dipalsukan oleh halaman web; tidak terpengaruh proxy/tunnel yang mengubah Host.
    const site = req.get('sec-fetch-site');
    if (site) return site === 'same-origin' || site === 'none';
    const origin = req.get('origin');
    if (!origin) return true;
    let host;
    try { host = new URL(origin).host; } catch { return false; }
    return host === req.get('host') || config.allowedOrigins.includes(origin);
  };
  const requireCsrf = (req, res, next) => {
    if (!originAllowed(req)) return next(new HttpError(403, 'Origin tidak diizinkan.'));
    const sent = req.get('x-csrf-token');
    if (!sent || !safeEqual(sent, req.adminSession.csrf)) return next(new HttpError(403, 'Token CSRF tidak valid.'));
    return next();
  };
  const admin = [requireAdmin, requireCsrf];
  const json = express.json({ limit: '16kb', type: 'application/json' });
  const noStore = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };

  const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false, skipSuccessfulRequests: true, message: { error: 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.' } });
  const apiLimiter = rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false, message: { error: 'Terlalu banyak permintaan.' } });
  app.use('/api', apiLimiter);

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  // Dipakai tombol "Admin" di halaman publik. Login tetap dilindungi password, CSRF, dan rate limit.
  app.get('/api/site', (req, res) => res.json({ adminPath: config.adminPath }));

  app.get('/api/admin/session', noStore, (req, res) => {
    const session = sessions.get(parseCookies(req.headers.cookie)[COOKIE]);
    if (!session) return res.json({ authenticated: false, adminEnabled: Boolean(config.admin.passwordHash) });
    return res.json({ authenticated: true, csrf: session.csrf, maxUploadBytes: config.maxUploadBytes, username: config.admin.username, uploadMode: config.uploadMode, chunkSize: CHUNK_SIZE });
  });

  app.post('/api/admin/login', noStore, loginLimiter, json, wrap(async (req, res) => {
    if (!originAllowed(req)) throw new HttpError(403, 'Origin tidak diizinkan.');
    if (!config.admin.passwordHash) throw new HttpError(503, 'Login admin belum dikonfigurasi di server.');
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string' || username.length > 200 || password.length > 500) throw new HttpError(400, 'Permintaan tidak valid.');
    const userOk = safeEqual(username, config.admin.username);
    const passOk = await verifyPassword(password, userOk ? config.admin.passwordHash : DUMMY_HASH);
    if (!(userOk && passOk)) {
      await sleep(600);
      throw new HttpError(401, 'Username atau password salah.');
    }
    const { token, session } = sessions.create();
    res.cookie(COOKIE, token, cookieOptions(req));
    res.json({ authenticated: true, csrf: session.csrf, maxUploadBytes: config.maxUploadBytes, username: config.admin.username, uploadMode: config.uploadMode, chunkSize: CHUNK_SIZE });
  }));

  app.post('/api/admin/logout', noStore, requireAdmin, requireCsrf, (req, res) => {
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  // ---- API publik (baca saja) -------------------------------------------------------------------
  app.get('/api/list', wrap(async (req, res) => {
    const parent = toId(typeof req.query.parent === 'string' ? req.query.parent : undefined);
    const pageToken = typeof req.query.pageToken === 'string' && /^[\w\-=~.%+/]{1,2000}$/.test(req.query.pageToken) ? req.query.pageToken : undefined;
    await inside(parent);
    const page = await storage.listChildren(parent, { pageToken, pageSize: config.pageSize });
    res.set('Cache-Control', 'no-cache');
    res.json({ files: page.items.map(toPublic), nextPageToken: page.nextPageToken });
  }));

  app.get('/api/files/:id/download', wrap(async (req, res) => {
    const id = toId(req.params.id);
    await inside(id, { allowRoot: false });
    let download;
    try {
      download = await storage.openDownload(id, { range: req.get('range') });
    } catch (error) {
      if (error.status === 416) res.set('Content-Range', error.contentRange || '*');
      throw error;
    }
    const inline = req.query.inline === '1' && INLINE_SAFE.has(download.mimeType);
    res.status(download.status);
    res.set({
      'Content-Type': inline ? (download.mimeType === 'text/plain' ? 'text/plain; charset=utf-8' : download.mimeType) : 'application/octet-stream',
      'Content-Disposition': contentDisposition(download.filename, inline ? 'inline' : 'attachment'),
      'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache',
      // sandbox memblokir penampil PDF bawaan browser, jadi PDF memakai kebijakan tanpa sandbox (PDF bukan HTML aktif).
      'Content-Security-Policy': download.mimeType === 'application/pdf' ? "default-src 'none'" : "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'"
    });
    if (download.contentLength !== undefined) res.set('Content-Length', String(download.contentLength));
    if (download.contentRange) res.set('Content-Range', download.contentRange);
    res.on('close', () => { if (!res.writableEnded) download.close(); });
    download.stream.on('error', error => { console.error('[download]', error.message); res.destroy(error); });
    download.stream.pipe(res);
  }));

  // ---- API admin ---------------------------------------------------------------------------------
  app.post('/api/admin/folders', noStore, admin, json, wrap(async (req, res) => {
    const parent = toId(req.body?.parent);
    await inside(parent);
    const item = await storage.createFolder(parent, needName(req.body?.name));
    res.status(201).json({ item: toPublic(item) });
  }));

  app.post('/api/admin/folders/ensure', noStore, admin, json, wrap(async (req, res) => {
    const parent = toId(req.body?.parent);
    await inside(parent);
    const raw = req.body?.path;
    if (typeof raw !== 'string' || raw.length > 2000) throw new HttpError(400, 'Path tidak valid.');
    const segments = raw.split('/').filter(Boolean).map(needName);
    if (!segments.length || segments.length > 30) throw new HttpError(400, 'Path tidak valid.');
    const item = await storage.ensureFolderPath(parent, segments);
    res.json({ item: toPublic(item) });
  }));

  app.patch('/api/admin/items/:id', noStore, admin, json, wrap(async (req, res) => {
    const id = toId(req.params.id);
    await inside(id, { allowRoot: false });
    const body = req.body || {};
    if (body.name === undefined && body.parent === undefined) throw new HttpError(400, 'Tidak ada perubahan.');
    let item = await storage.getItem(id);
    if (!item) throw new HttpError(404, 'Item tidak ditemukan.');
    if (body.name !== undefined) item = await storage.rename(id, needName(body.name));
    if (body.parent !== undefined) {
      const parent = toId(body.parent);
      await inside(parent);
      item = await storage.move(item.id, parent);
    }
    res.json({ item: toPublic(item) });
  }));

  app.delete('/api/admin/items/:id', noStore, admin, wrap(async (req, res) => {
    const id = toId(req.params.id);
    await inside(id, { allowRoot: false });
    await storage.trash(id);
    res.json({ ok: true });
  }));

  // Upload per bagian: init -> PUT chunk (4 MB) berulang -> selesai. URL sesi Google tidak pernah keluar dari server.
  const needChunkMode = () => {
    if (config.uploadMode !== 'chunk' || typeof storage.createUploadSession !== 'function') throw new HttpError(400, 'Mode upload per bagian tidak aktif.');
  };
  const openUpload = token => {
    const data = sealer.open(token);
    if (!data || typeof data.u !== 'string' || !data.u.startsWith(`${storage.sessionOrigin}/`) || !Number.isInteger(data.s)) throw new HttpError(400, 'Sesi upload tidak valid atau kedaluwarsa.');
    return data;
  };

  app.post('/api/admin/upload/init', noStore, admin, json, wrap(async (req, res) => {
    needChunkMode();
    const parent = toId(req.body?.parent);
    const name = needName(req.body?.name);
    const size = req.body?.size;
    if (!Number.isInteger(size) || size < 0) throw new HttpError(400, 'Ukuran file tidak valid.');
    if (size > config.maxUploadBytes) throw new HttpError(413, `File melebihi batas ${Math.round(config.maxUploadBytes / 1048576)} MB.`);
    const mime = cleanMime(req.body?.type);
    await inside(parent);
    const finalName = await uniqueName(parent, name);
    if (size === 0) {
      const item = await storage.upload(parent, finalName, mime, 0, Readable.from([]));
      return res.status(201).json({ done: true, item: toPublic(item), name: finalName, renamed: finalName !== name });
    }
    const url = await storage.createUploadSession(parent, finalName, mime, size);
    const token = sealer.seal({ u: url, s: size }, 24 * 3600_000);
    return res.json({ done: false, token, chunkSize: CHUNK_SIZE, name: finalName, renamed: finalName !== name });
  }));

  app.put('/api/admin/upload/chunk', noStore, admin, express.raw({ type: () => true, limit: CHUNK_SIZE + 65536 }), wrap(async (req, res) => {
    needChunkMode();
    const { u, s: size } = openUpload(req.query.token);
    const start = Number(req.query.start);
    const body = req.body;
    if (!Number.isInteger(start) || start < 0 || !Buffer.isBuffer(body) || body.length === 0 || body.length > CHUNK_SIZE) throw new HttpError(400, 'Bagian upload tidak valid.');
    if (start + body.length > size) throw new HttpError(400, 'Bagian upload melebihi ukuran file.');
    if (start % QUANTUM !== 0 || (start + body.length < size && body.length % QUANTUM !== 0)) throw new HttpError(400, 'Ukuran bagian upload tidak valid.');
    const result = await storage.uploadChunk(u, start, body, size);
    res.status(result.done ? 201 : 200).json(result.done ? { done: true, item: toPublic(result.item) } : { done: false, next: result.next });
  }));

  app.get('/api/admin/upload/status', noStore, requireAdmin, wrap(async (req, res) => {
    needChunkMode();
    const { u, s: size } = openUpload(req.query.token);
    const result = await storage.uploadStatus(u, size);
    res.json(result.done ? { done: true, item: toPublic(result.item) } : { done: false, next: result.next });
  }));

  // Upload: satu file per request, body mentah (tanpa multipart) sehingga dapat di-stream langsung ke penyimpanan.
  app.put('/api/admin/upload', noStore, admin, wrap(async (req, res) => {
    const parent = toId(typeof req.query.parent === 'string' ? req.query.parent : undefined);
    const name = needName(req.query.name);
    const size = Number(req.get('content-length'));
    if (!Number.isInteger(size) || size < 0) throw new HttpError(411, 'Content-Length wajib ada.');
    if (size > config.maxUploadBytes) {
      res.set('Connection', 'close');
      throw new HttpError(413, `File melebihi batas ${Math.round(config.maxUploadBytes / 1048576)} MB.`);
    }
    await inside(parent);
    const finalName = await uniqueName(parent, name);
    const item = await storage.upload(parent, finalName, cleanMime(req.get('content-type')), size, req);
    res.status(201).json({ item: toPublic(item), renamed: finalName !== name });
  }));

  app.use('/api', (req, res, next) => next(new HttpError(404, 'Endpoint tidak ditemukan.')));

  // ---- Frontend statis (production) -------------------------------------------------------------
  if (distDir && fs.existsSync(path.join(distDir, 'index.html'))) {
    const sendHtml = file => (req, res, next) => {
      res.set({ 'Cache-Control': 'no-cache', ...(file === 'admin.html' ? { 'X-Robots-Tag': 'noindex, nofollow, noarchive' } : {}) });
      res.sendFile(path.join(distDir, file), error => error && next(error));
    };
    if (config.adminPath !== '/admin.html') app.get('/admin.html', (req, res) => res.status(404).type('text/plain').send('Not found'));
    app.get(config.adminPath, sendHtml('admin.html'));
    app.get('/', sendHtml('index.html'));
    app.use(express.static(distDir, {
      index: false, dotfiles: 'ignore',
      setHeaders(res, file) {
        if (file.includes(`${path.sep}assets${path.sep}`)) res.set('Cache-Control', 'public, max-age=31536000, immutable');
      }
    }));
  }

  app.use((req, res) => res.status(404).type('text/plain').send('Not found'));

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    if (error instanceof HttpError) {
      return res.status(error.status).json({ error: error.message });
    }
    if (error?.type === 'entity.too.large') return res.status(413).json({ error: 'Permintaan terlalu besar.' });
    if (error?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Permintaan tidak valid.' });
    console.error('[error]', req.method, req.path, error);
    return res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
  });

  return app;
}
