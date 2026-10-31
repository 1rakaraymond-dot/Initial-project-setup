import http from 'node:http';
import crypto from 'node:crypto';

const FOLDER = 'application/vnd.google-apps.folder';
const q1 = "'((?:[^'\\\\]|\\\\.)*)'";
const unesc = s => s.replace(/\\(.)/g, '$1');

/** Server Drive v3 palsu (hanya endpoint yang dipakai adapter) untuk uji tanpa jaringan. */
export async function startFakeDrive() {
  const files = new Map(); // id -> {id,name,mimeType,parents,trashed,data,modifiedTime}
  const log = [];
  const sessions = new Map();
  let tokenCalls = 0;
  const id = () => crypto.randomBytes(12).toString('base64url');
  const add = ({ name, mimeType = 'text/plain', parents = [], data = Buffer.alloc(0), trashed = false }) => {
    const f = { id: id(), name, mimeType, parents, trashed, data, modifiedTime: new Date().toISOString() };
    files.set(f.id, f); return f;
  };
  const view = (f, fields) => {
    const all = { id: f.id, name: f.name, mimeType: f.mimeType, size: f.mimeType === FOLDER || f.mimeType.startsWith('application/vnd.google-apps.') ? undefined : String(f.data.length), modifiedTime: f.modifiedTime, parents: f.parents, trashed: f.trashed };
    if (!fields) return all;
    const want = new Set(fields.replace(/files\(|\)/g, '').split(','));
    return Object.fromEntries(Object.entries(all).filter(([k]) => want.has(k)));
  };
  const body = req => new Promise(resolve => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => resolve(Buffer.concat(c))); });
  const send = (res, status, data, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data)); };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    log.push(`${req.method} ${p}${url.search}`);
    if (p === '/token') { tokenCalls += 1; const b = new URLSearchParams((await body(req)).toString()); return b.get('refresh_token') === 'good-refresh' ? send(res, 200, { access_token: `tok${tokenCalls}`, expires_in: 3600 }) : send(res, 400, { error: 'invalid_grant' }); }
    if (req.headers.authorization !== `Bearer tok${tokenCalls}`) return send(res, 401, { error: { message: 'bad token' } });

    if (req.method === 'GET' && p === '/drive/v3/files') {
      const q = url.searchParams.get('q') || '';
      const parent = new RegExp(`${q1} in parents`).exec(q)?.[1];
      const name = new RegExp(`name = ${q1}`).exec(q)?.[1];
      const mime = new RegExp(`mimeType = ${q1}`).exec(q)?.[1];
      let list = [...files.values()].filter(f => !f.trashed && f.parents.includes(unesc(parent)));
      if (name !== undefined) list = list.filter(f => f.name === unesc(name));
      if (mime) list = list.filter(f => f.mimeType === unesc(mime));
      list.sort((a, b) => (b.mimeType === FOLDER) - (a.mimeType === FOLDER) || a.name.localeCompare(b.name));
      return send(res, 200, { files: list.map(f => view(f, url.searchParams.get('fields'))) });
    }
    if (req.method === 'POST' && p === '/drive/v3/files') {
      const m = JSON.parse((await body(req)).toString());
      return send(res, 200, view(add({ name: m.name, mimeType: m.mimeType || 'application/octet-stream', parents: m.parents })));
    }
    if (req.method === 'POST' && p === '/upload/drive/v3/files') {
      const m = JSON.parse((await body(req)).toString());
      const sid = id(); sessions.set(sid, { meta: m, declared: Number(req.headers['x-upload-content-length']), mime: req.headers['x-upload-content-type'] });
      return send(res, 200, '', { Location: `http://${req.headers.host}/upload-session/${sid}` });
    }
    if (req.method === 'PUT' && p.startsWith('/upload-session/')) {
      const s = sessions.get(p.split('/').pop()); const data = await body(req);
      if (!s || data.length !== s.declared || Number(req.headers['content-length']) !== s.declared) return send(res, 400, { error: { message: 'size mismatch' } });
      return send(res, 200, view(add({ name: s.meta.name, mimeType: s.mime, parents: s.meta.parents, data })));
    }
    const m = /^\/drive\/v3\/files\/([^/]+)(\/export)?$/.exec(p);
    if (m) {
      const f = files.get(decodeURIComponent(m[1]));
      if (!f) return send(res, 404, { error: { message: 'not found' } });
      if (req.method === 'GET' && m[2]) return send(res, 200, Buffer.from(`%PDF-fake ${f.name}`), { 'Content-Type': 'application/pdf' });
      if (req.method === 'GET' && url.searchParams.get('alt') === 'media') {
        const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
        if (range) { const s = Number(range[1]); const e = range[2] ? Number(range[2]) : f.data.length - 1; const chunk = f.data.subarray(s, e + 1); return send(res, 206, chunk, { 'Content-Type': f.mimeType, 'Content-Range': `bytes ${s}-${e}/${f.data.length}`, 'Content-Length': chunk.length }); }
        return send(res, 200, f.data, { 'Content-Type': f.mimeType, 'Content-Length': f.data.length });
      }
      if (req.method === 'GET') return send(res, 200, view(f, url.searchParams.get('fields')));
      if (req.method === 'PATCH') {
        const b = JSON.parse((await body(req)).toString() || '{}');
        if (b.name !== undefined) f.name = b.name;
        if (b.trashed !== undefined) f.trashed = b.trashed;
        const add2 = url.searchParams.get('addParents'); const rem = url.searchParams.get('removeParents');
        if (add2) f.parents = f.parents.filter(x => !(rem || '').split(',').includes(x)).concat(add2);
        return send(res, 200, view(f, url.searchParams.get('fields')));
      }
    }
    return send(res, 404, { error: { message: `unhandled ${req.method} ${p}` } });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, files, add, log, get tokenCalls() { return tokenCalls; }, expireToken() { tokenCalls += 1; }, close: () => new Promise(r => { server.close(r); server.closeAllConnections?.(); }), FOLDER };
}
