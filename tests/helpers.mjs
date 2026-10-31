import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { loadConfig } from '../server/config.js';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/auth.js';

export const PASSWORD = 'correct horse battery staple';
const hash = await hashPassword(PASSWORD, { N: 1024, r: 8, p: 1 });

export async function startApp({ storage, env = {}, distDir } = {}) {
  const config = loadConfig({
    APP_SECRET: 'x'.repeat(48), ADMIN_USERNAME: 'hunter', ADMIN_PASSWORD_HASH: hash, MAX_UPLOAD_MB: '1', ...env
  });
  const app = createApp({ config, storage, distDir: distDir || path.join(os.tmpdir(), 'no-dist-here') });
  const server = await new Promise(resolve => { const s = http.createServer(app).listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = makeClient(base);
  return { base, config, client, app, close: () => new Promise(resolve => { app.locals.sessions.close(); server.close(resolve); server.closeAllConnections?.(); }) };
}

export function makeClient(base) {
  let cookie = '';
  let csrf = '';
  const api = {
    get csrf() { return csrf; },
    async raw(method, url, { body, headers = {}, auth = true, csrfToken } = {}) {
      const h = { ...headers };
      if (cookie) h.cookie = cookie;
      if (auth && (csrfToken ?? csrf) && method !== 'GET') h['x-csrf-token'] = csrfToken ?? csrf;
      const isJson = body !== undefined && typeof body === 'object' && !(body instanceof Uint8Array) && !Buffer.isBuffer(body);
      if (isJson) h['content-type'] = 'application/json';
      const res = await fetch(base + url, { method, headers: h, body: isJson ? JSON.stringify(body) : body, redirect: 'manual' });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return res;
    },
    async json(method, url, opts) {
      const res = await api.raw(method, url, opts);
      const text = await res.text();
      let data; try { data = JSON.parse(text); } catch { data = text; }
      return { status: res.status, data, headers: res.headers };
    },
    async login(username = 'hunter', password = PASSWORD) {
      const r = await api.json('POST', '/api/admin/login', { body: { username, password } });
      if (r.status === 200) csrf = r.data.csrf;
      return r;
    },
    clearSession() { cookie = ''; csrf = ''; }
  };
  return api;
}

export function tmpDir(prefix = 'archive-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
