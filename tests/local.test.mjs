import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { LocalStorage } from '../server/storage/local.js';
import { startApp, tmpDir, makeClient } from './helpers.mjs';

let ctx; let dir; const up = (c, parent, name, data, type = 'text/plain') =>
  c.json('PUT', `/api/admin/upload?parent=${encodeURIComponent(parent)}&name=${encodeURIComponent(name)}`, { body: Buffer.from(data), headers: { 'content-type': type } });

before(async () => {
  dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'secret-note.txt'), 'hello');
  fs.mkdirSync(path.join(dir, '.hidden')); fs.writeFileSync(path.join(dir, '.hidden', 'x'), 'x');
  const storage = new LocalStorage({ dir }); await storage.init();
  ctx = await startApp({ storage });
});
after(async () => { await ctx.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('publik: list root, id opaque, dotfile tersembunyi, tidak ada field Drive', async () => {
  const r = await ctx.client.json('GET', '/api/list');
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.files.map(f => f.name), ['secret-note.txt']);
  const f = r.data.files[0];
  assert.ok(f.id.length > 30 && !f.id.includes('secret'));
  assert.equal(f.webViewLink, undefined);
  assert.ok(!JSON.stringify(r.data).includes('google'));
});

test('endpoint admin menolak tanpa sesi', async () => {
  const c = makeClient(ctx.base);
  for (const [m, u] of [['POST', '/api/admin/folders'], ['PATCH', '/api/admin/items/abc'], ['DELETE', '/api/admin/items/abc'], ['PUT', '/api/admin/upload?name=a']]) {
    const r = await c.json(m, u, { body: m === 'PUT' ? Buffer.from('x') : {} });
    assert.equal(r.status, 401, `${m} ${u}`);
  }
  assert.equal((await c.json('GET', '/api/admin/session')).data.authenticated, false);
});

test('login: salah ditolak, benar dapat cookie HttpOnly SameSite=Strict + csrf', async () => {
  const c = makeClient(ctx.base);
  assert.equal((await c.login('hunter', 'salah')).status, 401);
  assert.equal((await c.login('orang', 'correct horse battery staple')).status, 401);
  const res = await c.raw('POST', '/api/admin/login', { body: { username: 'hunter', password: 'correct horse battery staple' } });
  assert.equal(res.status, 200);
  const cookie = res.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/i); assert.match(cookie, /SameSite=Strict/i);
  ctx.client.clearSession();
  assert.equal((await ctx.client.login()).status, 200);
});

test('CSRF: mutasi tanpa/ dengan token salah ditolak; origin asing ditolak', async () => {
  const c = ctx.client;
  assert.equal((await c.json('POST', '/api/admin/folders', { body: { parent: 'root', name: 'X' }, csrfToken: 'salah' })).status, 403);
  assert.equal((await c.json('POST', '/api/admin/folders', { body: { parent: 'root', name: 'X' }, headers: { origin: 'https://evil.example' } })).status, 403);
});

test('buat folder, ensure path, upload, rename-konflik, duplikat nama otomatis (1)', async () => {
  const c = ctx.client;
  const folder = await c.json('POST', '/api/admin/folders', { body: { parent: 'root', name: 'Proyek' } });
  assert.equal(folder.status, 201);
  assert.equal((await c.json('POST', '/api/admin/folders', { body: { parent: 'root', name: 'Proyek' } })).status, 409);
  const deep = await c.json('POST', '/api/admin/folders/ensure', { body: { parent: folder.data.item.id, path: 'a/b/c' } });
  assert.equal(deep.status, 200);
  assert.ok(fs.existsSync(path.join(dir, 'Proyek', 'a', 'b', 'c')));
  const u1 = await up(c, folder.data.item.id, 'catatan.txt', 'isi pertama');
  assert.equal(u1.status, 201);
  const u2 = await up(c, folder.data.item.id, 'catatan.txt', 'isi kedua');
  assert.equal(u2.data.item.name, 'catatan (1).txt'); assert.equal(u2.data.renamed, true);
  const list = await c.json('GET', `/api/list?parent=${folder.data.item.id}`);
  assert.deepEqual(list.data.files.map(f => f.name), ['a', 'catatan (1).txt', 'catatan.txt']);
  const rn = await c.json('PATCH', `/api/admin/items/${u2.data.item.id}`, { body: { name: 'catatan.txt' } });
  assert.equal(rn.status, 409);
  const ok = await c.json('PATCH', `/api/admin/items/${u2.data.item.id}`, { body: { name: 'baru.txt' } });
  assert.equal(ok.data.item.name, 'baru.txt');
});

test('download: isi benar, attachment, Range 206, 416, inline hanya tipe aman', async () => {
  const c = ctx.client;
  const root = (await c.json('GET', '/api/list')).data.files;
  const file = root.find(f => f.name === 'secret-note.txt');
  const res = await c.raw('GET', `/api/files/${file.id}/download`);
  assert.equal(res.status, 200); assert.equal(await res.text(), 'hello');
  assert.match(res.headers.get('content-disposition'), /^attachment;/);
  const part = await c.raw('GET', `/api/files/${file.id}/download`, { headers: { range: 'bytes=1-3' } });
  assert.equal(part.status, 206); assert.equal(await part.text(), 'ell'); assert.equal(part.headers.get('content-range'), 'bytes 1-3/5');
  assert.equal((await c.raw('GET', `/api/files/${file.id}/download`, { headers: { range: 'bytes=99-100' } })).status, 416);
  const html = await up(c, 'root', 'x.html', '<script>alert(1)</script>', 'text/html');
  const dl = await c.raw('GET', `/api/files/${html.data.item.id}/download?inline=1`);
  assert.match(dl.headers.get('content-disposition'), /^attachment;/); assert.equal(html.data.item.previewUrl, undefined);
  const png = await up(c, 'root', 'p.png', 'PNG', 'image/png');
  assert.match(png.data.item.previewUrl, /inline=1/);
  const inl = await c.raw('GET', `/api/files/${png.data.item.id}/download?inline=1`);
  assert.match(inl.headers.get('content-disposition'), /^inline;/);
  assert.match(inl.headers.get('content-security-policy'), /sandbox/);
});

test('keamanan path: id palsu/traversal ditolak, nama file disanitasi', async () => {
  const c = ctx.client;
  for (const bad of ['../../etc/passwd', 'abc', Buffer.from('../x').toString('base64url').repeat(5)]) {
    const r = await c.json('GET', `/api/list?parent=${encodeURIComponent(bad)}`);
    assert.ok([400, 404].includes(r.status), `${bad} -> ${r.status}`);
  }
  assert.equal((await c.json('GET', '/api/files/root/download')).status, 403);
  const u = await up(c, 'root', '../../evil.txt', 'x');
  assert.equal(u.status, 201); assert.ok(!u.data.item.name.includes('/'));
  assert.ok(fs.existsSync(path.join(dir, u.data.item.name)));
  assert.ok(!fs.existsSync(path.join(path.dirname(dir), 'evil.txt')));
  assert.equal((await up(c, 'root', '..', 'x')).status, 400);
  assert.equal((await c.json('DELETE', '/api/admin/items/root')).status, 403);
  assert.equal((await c.json('PATCH', '/api/admin/items/root', { body: { name: 'x' } })).status, 403);
});

test('pindah: ke folder lain OK, ke dalam dirinya sendiri ditolak; hapus = ke tempat sampah', async () => {
  const c = ctx.client;
  const a = (await c.json('POST', '/api/admin/folders', { body: { parent: 'root', name: 'A' } })).data.item;
  const b = (await c.json('POST', '/api/admin/folders', { body: { parent: a.id, name: 'B' } })).data.item;
  assert.equal((await c.json('PATCH', `/api/admin/items/${a.id}`, { body: { parent: b.id } })).status, 400);
  const f = (await up(c, 'root', 'pindah.txt', 'x')).data.item;
  const mv = await c.json('PATCH', `/api/admin/items/${f.id}`, { body: { parent: b.id } });
  assert.equal(mv.status, 200); assert.ok(fs.existsSync(path.join(dir, 'A', 'B', 'pindah.txt')));
  const del = await c.json('DELETE', `/api/admin/items/${mv.data.item.id}`);
  assert.equal(del.status, 200);
  assert.ok(!fs.existsSync(path.join(dir, 'A', 'B', 'pindah.txt')));
  assert.ok(fs.readdirSync(path.join(dir, '.trash')).some(n => n.endsWith('pindah.txt')));
  assert.deepEqual((await c.json('GET', `/api/list?parent=${b.id}`)).data.files, []);
});

test('upload melebihi batas ditolak (413); body kosong diterima', async () => {
  const c = ctx.client;
  const big = await up(c, 'root', 'besar.bin', Buffer.alloc(1024 * 1024 + 1), 'application/octet-stream').catch(e => ({ status: 'neterr', e }));
  assert.ok(big.status === 413 || big.status === 'neterr');
  const empty = await up(c, 'root', 'kosong.txt', '');
  assert.equal(empty.status, 201); assert.equal(empty.data.item.size, 0);
});

test('logout mematikan sesi', async () => {
  const c = makeClient(ctx.base); await c.login();
  assert.equal((await c.json('POST', '/api/admin/logout')).status, 200);
  assert.equal((await c.json('POST', '/api/admin/folders', { body: { parent: 'root', name: 'Z' } })).status, 401);
});

test('rate limit login: percobaan gagal berulang berakhir 429', async () => {
  const s2 = new LocalStorage({ dir: tmpDir() }); await s2.init();
  const app2 = await startApp({ storage: s2 });
  let last;
  for (let i = 0; i < 11; i += 1) last = await app2.client.login('hunter', 'salah-' + i);
  assert.equal(last.status, 429);
  await app2.close();
});

test('halaman admin: path rahasia dilayani, /admin.html dan sumber lain 404', async () => {
  const dist = tmpDir('dist-'); fs.mkdirSync(path.join(dist, 'assets'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<h1>public</h1>'); fs.writeFileSync(path.join(dist, 'admin.html'), '<h1>admin</h1>');
  const s = new LocalStorage({ dir: tmpDir() }); await s.init();
  const a = await startApp({ storage: s, env: { ADMIN_PATH: '/gerbang-rahasia' }, distDir: dist });
  assert.equal(await (await fetch(a.base + '/gerbang-rahasia')).text(), '<h1>admin</h1>');
  assert.equal((await fetch(a.base + '/gerbang-rahasia')).headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
  assert.equal((await fetch(a.base + '/admin')).status, 404);
  assert.equal((await fetch(a.base + '/admin.html')).status, 404);
  assert.equal(await (await fetch(a.base + '/')).text(), '<h1>public</h1>');
  assert.equal((await fetch(a.base + '/../server/config.js')).status, 404);
  assert.match((await fetch(a.base + '/')).headers.get('content-security-policy'), /default-src 'self'/);
  await a.close();
});

test('/api/site memberi tahu alamat admin untuk tombol di halaman publik', async () => {
  const r = await makeClient(ctx.base).json('GET', '/api/site');
  assert.equal(r.status, 200); assert.equal(r.data.adminPath, '/admin');
});

test('Sec-Fetch-Site: cross-site ditolak, same-origin diterima meski Host diubah proxy', async () => {
  const c = ctx.client;
  const bad = await c.json('POST', '/api/admin/folders', { body: { parent: 'root', name: 'SFS1' }, headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(bad.status, 403);
  const same = await c.json('POST', '/api/admin/folders', { body: { parent: 'root', name: 'SFS2' }, headers: { 'sec-fetch-site': 'same-origin', origin: 'https://tunnel.contoh.net' } });
  assert.equal(same.status, 201);
});
