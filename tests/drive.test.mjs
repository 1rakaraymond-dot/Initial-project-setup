import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DriveStorage } from '../server/storage/drive.js';
import { startApp, makeClient } from './helpers.mjs';
import { startFakeDrive } from './fake-drive.mjs';

let fake; let ctx; let root; let outside; let outsideFile;
const up = (c, parent, name, data, type = 'application/pdf') =>
  c.json('PUT', `/api/admin/upload?parent=${encodeURIComponent(parent)}&name=${encodeURIComponent(name)}`, { body: Buffer.from(data), headers: { 'content-type': type } });

before(async () => {
  fake = await startFakeDrive();
  root = fake.add({ name: 'ARSIP', mimeType: fake.FOLDER });
  outside = fake.add({ name: 'PRIBADI', mimeType: fake.FOLDER });
  outsideFile = fake.add({ name: 'rahasia-pribadi.txt', parents: [outside.id], data: Buffer.from('JANGAN BOCOR') });
  fake.add({ name: 'readme.txt', parents: [root.id], data: Buffer.from('0123456789') });
  fake.add({ name: 'Laporan', mimeType: 'application/vnd.google-apps.document', parents: [root.id] });
  fake.add({ name: 'pintasan', mimeType: 'application/vnd.google-apps.shortcut', parents: [root.id] });
  fake.add({ name: 'terhapus.txt', parents: [root.id], trashed: true });
  const storage = new DriveStorage({ clientId: 'c', clientSecret: 's', refreshToken: 'good-refresh', rootFolderId: root.id, tokenUrl: `${fake.base}/token`, apiBase: `${fake.base}/drive/v3`, uploadBase: `${fake.base}/upload/drive/v3` });
  assert.equal((await storage.init()).name, 'ARSIP');
  ctx = await startApp({ storage });
  assert.equal((await ctx.client.login()).status, 200);
});
after(async () => { await ctx.close(); await fake.close(); });

test('list: hanya isi root; shortcut & sampah disembunyikan; Google Doc tampil sebagai PDF; tidak ada ID Drive di respons', async () => {
  const r = await ctx.client.json('GET', '/api/list');
  assert.deepEqual(r.data.files.map(f => f.name), ['Laporan.pdf', 'readme.txt']);
  assert.equal(r.data.files[0].mimeType, 'application/pdf');
  const text = JSON.stringify(r.data);
  for (const f of fake.files.values()) assert.ok(!text.includes(f.id), 'ID Drive bocor');
  assert.ok(!text.includes('google'));
});

test('file di luar root tidak dapat dijangkau (ID palsu, ID asli Drive, dan id terenkripsi dari luar)', async () => {
  const c = ctx.client;
  assert.equal((await c.json('GET', `/api/list?parent=${outside.id}`)).status, 400);
  assert.equal((await c.json('GET', `/api/files/${outsideFile.id}/download`)).status, 400);
  // token valid yang dibuat server tapi menunjuk file di luar root (mis. setelah dipindah di Drive)
  const { createIdCodec } = await import('../server/idcodec.js');
  const token = createIdCodec(ctx.config.secret).encode(outsideFile.id);
  assert.equal((await c.json('GET', `/api/files/${token}/download`)).status, 404);
  assert.equal((await c.json('DELETE', `/api/admin/items/${token}`)).status, 404);
  assert.equal((await c.json('PATCH', `/api/admin/items/${token}`, { body: { name: 'x' } })).status, 404);
  const folderToken = createIdCodec(ctx.config.secret).encode(outside.id);
  assert.equal((await c.json('GET', `/api/list?parent=${folderToken}`)).status, 404);
  assert.equal((await up(c, folderToken, 'x.txt', 'x')).status, 404);
  assert.equal(outsideFile.trashed, false);
});

test('download: stream, Range diteruskan, Google Doc diekspor PDF', async () => {
  const c = ctx.client;
  const list = (await c.json('GET', '/api/list')).data.files;
  const readme = list.find(f => f.name === 'readme.txt');
  const full = await c.raw('GET', `/api/files/${readme.id}/download`);
  assert.equal(await full.text(), '0123456789'); assert.equal(full.headers.get('content-length'), '10');
  const part = await c.raw('GET', `/api/files/${readme.id}/download`, { headers: { range: 'bytes=2-4' } });
  assert.equal(part.status, 206); assert.equal(await part.text(), '234'); assert.equal(part.headers.get('content-range'), 'bytes 2-4/10');
  const doc = list.find(f => f.name === 'Laporan.pdf');
  const pdf = await c.raw('GET', `/api/files/${doc.id}/download`);
  assert.match(await pdf.text(), /^%PDF-fake Laporan/); assert.match(pdf.headers.get('content-disposition'), /Laporan\.pdf/);
});

test('upload di-stream (resumable) dengan ukuran tepat; nama kembar diberi nomor', async () => {
  const c = ctx.client;
  const payload = Buffer.alloc(300_000, 'a');
  const r = await up(c, 'root', 'besar.bin', payload, 'application/octet-stream');
  assert.equal(r.status, 201); assert.equal(r.data.item.size, 300_000);
  const stored = [...fake.files.values()].find(f => f.name === 'besar.bin');
  assert.deepEqual(stored.parents, [root.id]); assert.equal(stored.data.length, 300_000);
  const again = await up(c, 'root', 'besar.bin', 'kecil', 'text/plain');
  assert.equal(again.data.item.name, 'besar (1).bin');
  const empty = await up(c, 'root', 'kosong.txt', '', 'text/plain');
  assert.equal(empty.status, 201); assert.equal(empty.data.item.size, 0);
});

test('folder: buat, ensure path (tidak menduplikasi), rename, pindah, anti-siklus, hapus = sampah', async () => {
  const c = ctx.client;
  const a = (await c.json('POST', '/api/admin/folders', { body: { parent: 'root', name: 'Galeri' } })).data.item;
  assert.equal((await c.json('POST', '/api/admin/folders', { body: { parent: 'root', name: 'Galeri' } })).status, 409);
  const p1 = (await c.json('POST', '/api/admin/folders/ensure', { body: { parent: a.id, path: 'x/y' } })).data.item;
  const p2 = (await c.json('POST', '/api/admin/folders/ensure', { body: { parent: a.id, path: 'x/y' } })).data.item;
  assert.equal(p1.id, p2.id);
  assert.equal([...fake.files.values()].filter(f => f.name === 'x').length, 1);
  assert.equal((await c.json('PATCH', `/api/admin/items/${a.id}`, { body: { parent: p1.id } })).status, 400);
  const f = (await up(c, 'root', 'foto.jpg', 'jpg', 'image/jpeg')).data.item;
  const moved = await c.json('PATCH', `/api/admin/items/${f.id}`, { body: { parent: p1.id, name: 'foto-baru.jpg' } });
  assert.equal(moved.status, 200); assert.equal(moved.data.item.name, 'foto-baru.jpg');
  const real = [...fake.files.values()].find(x => x.name === 'foto-baru.jpg');
  assert.equal(real.parents.length, 1); assert.equal(real.parents[0], [...fake.files.values()].find(x => x.name === 'y').id);
  assert.equal((await c.json('DELETE', `/api/admin/items/${moved.data.item.id}`)).status, 200);
  assert.equal(real.trashed, true); assert.ok(fake.files.has(real.id), 'tidak boleh hapus permanen');
  assert.ok(!fake.log.some(l => l.startsWith('DELETE')));
});

test('token kedaluwarsa (401) diperbarui otomatis sekali', async () => {
  const before = fake.tokenCalls;
  fake.expireToken();
  const r = await ctx.client.json('GET', '/api/list');
  assert.equal(r.status, 200);
  assert.equal(fake.tokenCalls, before + 2);
});

test('kredensial server salah -> pesan generik 502, tanpa detail Google', async () => {
  const bad = new DriveStorage({ clientId: 'c', clientSecret: 's', refreshToken: 'salah', rootFolderId: root.id, tokenUrl: `${fake.base}/token`, apiBase: `${fake.base}/drive/v3`, uploadBase: `${fake.base}/upload/drive/v3` });
  const app = await startApp({ storage: bad });
  const r = await app.client.json('GET', '/api/list');
  assert.equal(r.status, 502); assert.ok(!JSON.stringify(r.data).match(/invalid_grant|google/i));
  await app.close();
});


// ---- Upload per bagian (mode Vercel) ---------------------------------------------------------------
const CHUNK = 4 * 1024 * 1024;
async function chunkUpload(c, parent, name, data, { type = 'application/octet-stream' } = {}) {
  const init = await c.json('POST', '/api/admin/upload/init', { body: { parent, name, size: data.length, type } });
  if (init.status !== 200 && init.status !== 201) return { init };
  if (init.data.done) return { init, final: { status: 201, data: init.data } };
  let offset = 0; let last;
  while (offset < data.length) {
    const part = data.subarray(offset, offset + init.data.chunkSize);
    last = await c.json('PUT', `/api/admin/upload/chunk?token=${init.data.token}&start=${offset}`, { body: part, headers: { 'content-type': 'application/octet-stream' } });
    if (last.status >= 300) return { init, final: last };
    if (last.data.done) break;
    offset = last.data.next;
  }
  return { init, final: last };
}

let chunkCtx;
test('(chunk) siapkan aplikasi mode chunk', async () => {
  const storage = new DriveStorage({ clientId: 'c', clientSecret: 's', refreshToken: 'good-refresh', rootFolderId: root.id, tokenUrl: `${fake.base}/token`, apiBase: `${fake.base}/drive/v3`, uploadBase: `${fake.base}/upload/drive/v3` });
  chunkCtx = await startApp({ storage, env: { UPLOAD_MODE: 'chunk', MAX_UPLOAD_MB: '30' } });
  assert.equal((await chunkCtx.client.login()).status, 200);
  const info = await chunkCtx.client.json('GET', '/api/admin/session');
  assert.equal(info.data.uploadMode, 'chunk'); assert.equal(info.data.chunkSize, CHUNK);
});

test('(chunk) file 9 MB dikirim 3 bagian (4+4+1 MB), isi persis sama, di folder yang benar', async () => {
  const data = Buffer.alloc(9 * 1024 * 1024); for (let i = 0; i < data.length; i += 4099) data[i] = i % 251;
  fake.stats.chunks = 0;
  const { init, final } = await chunkUpload(chunkCtx.client, 'root', 'video-besar.bin', data);
  assert.equal(init.status, 200); assert.equal(final.status, 201); assert.equal(final.data.done, true);
  assert.equal(fake.stats.chunks, 3);
  const stored = [...fake.files.values()].find(f => f.name === 'video-besar.bin');
  assert.ok(stored.data.equals(data)); assert.deepEqual(stored.parents, [root.id]);
  assert.ok(!JSON.stringify(init.data).includes('googleapis') && !JSON.stringify(init.data).includes(fake.base), 'URL sesi bocor ke browser');
  assert.equal((await chunkUpload(chunkCtx.client, 'root', 'video-besar.bin', Buffer.alloc(300_000, 1))).final.data.item.name, 'video-besar (1).bin');
});

test('(chunk) file kosong, ukuran melebihi batas, dan nama tidak valid', async () => {
  const c = chunkCtx.client;
  assert.equal((await chunkUpload(c, 'root', 'kosong-chunk.txt', Buffer.alloc(0))).final.data.item.size, 0);
  const tooBig = await c.json('POST', '/api/admin/upload/init', { body: { parent: 'root', name: 'x.bin', size: 31 * 1024 * 1024, type: 'a/b' } });
  assert.equal(tooBig.status, 413);
  assert.equal((await c.json('POST', '/api/admin/upload/init', { body: { parent: 'root', name: '..', size: 5 } })).status, 400);
  assert.equal((await c.json('POST', '/api/admin/upload/init', { body: { parent: 'root', name: 'a', size: -1 } })).status, 400);
});

test('(chunk) gangguan di tengah: bagian tersimpan tapi respons 503 -> status memberi posisi lanjut, tanpa duplikasi', async () => {
  const c = chunkCtx.client;
  const data = Buffer.alloc(6 * 1024 * 1024, 7);
  const init = (await c.json('POST', '/api/admin/upload/init', { body: { parent: 'root', name: 'putus.bin', size: data.length, type: 'application/octet-stream' } })).data;
  fake.stats.failAfterPersist = 1;
  const first = await c.json('PUT', `/api/admin/upload/chunk?token=${init.token}&start=0`, { body: data.subarray(0, CHUNK), headers: { 'content-type': 'application/octet-stream' } });
  assert.equal(first.status, 502);
  const status = await c.json('GET', `/api/admin/upload/status?token=${init.token}`);
  assert.deepEqual(status.data, { done: false, next: CHUNK });
  const last = await c.json('PUT', `/api/admin/upload/chunk?token=${init.token}&start=${CHUNK}`, { body: data.subarray(CHUNK), headers: { 'content-type': 'application/octet-stream' } });
  assert.equal(last.status, 201);
  assert.ok([...fake.files.values()].find(f => f.name === 'putus.bin').data.equals(data));
  assert.equal([...fake.files.values()].filter(f => f.name === 'putus.bin').length, 1);
});

test('(chunk) keamanan: token palsu/diubah, bagian tak selaras, bagian terlalu besar, tanpa login/CSRF', async () => {
  const c = chunkCtx.client;
  const init = (await c.json('POST', '/api/admin/upload/init', { body: { parent: 'root', name: 'aman.bin', size: 1_000_000, type: 'a/b' } })).data;
  const put = (token, start, len, opts = {}) => c.json('PUT', `/api/admin/upload/chunk?token=${token}&start=${start}`, { body: Buffer.alloc(len, 1), headers: { 'content-type': 'application/octet-stream' }, ...opts });
  assert.equal((await put('x'.repeat(80), 0, 262144)).status, 400);
  const tampered = init.token.slice(0, -3) + (init.token.endsWith('AAA') ? 'BBB' : 'AAA');
  assert.equal((await put(tampered, 0, 262144)).status, 400);
  assert.equal((await put(init.token, 100, 262144)).status, 400);            // offset bukan kelipatan 256 KiB
  assert.equal((await put(init.token, 0, 262144 + 5)).status, 400);          // bukan bagian terakhir tapi tidak kelipatan 256 KiB
  assert.equal((await put(init.token, 0, CHUNK + 1)).status, 400);           // lebih dari batas chunk
  assert.equal((await put(init.token, 0, 262144, { csrfToken: 'salah' })).status, 403);
  const anon = makeClient(chunkCtx.base);
  assert.equal((await anon.json('PUT', `/api/admin/upload/chunk?token=${init.token}&start=0`, { body: Buffer.alloc(262144) })).status, 401);
  assert.equal((await anon.json('POST', '/api/admin/upload/init', { body: { parent: 'root', name: 'a', size: 5 } })).status, 401);
  const { createSealer } = await import('../server/idcodec.js');
  const evil = createSealer(chunkCtx.config.secret).seal({ u: 'https://evil.example/upload?id=1', s: 300000 }, 60000);
  assert.equal((await put(evil, 0, 262144)).status, 400);                    // host sesi bukan Google
  const other = await startApp({ storage: chunkCtx.app ? new DriveStorage({ clientId: 'c', clientSecret: 's', refreshToken: 'good-refresh', rootFolderId: root.id, tokenUrl: `${fake.base}/token`, apiBase: `${fake.base}/drive/v3`, uploadBase: `${fake.base}/upload/drive/v3` }) : null, env: { UPLOAD_MODE: 'chunk', APP_SECRET: 'z'.repeat(48) } });
  await other.client.login();
  assert.equal((await other.client.json('PUT', `/api/admin/upload/chunk?token=${init.token}&start=0`, { body: Buffer.alloc(262144), headers: { 'content-type': 'application/octet-stream' } })).status, 400); // token dari instalasi lain
  await other.close();
});

test('(chunk) sesi stateless: cookie dipalsukan/dimodifikasi ditolak, dan lintas "instance" dengan secret sama valid', async () => {
  const forged = makeClient(chunkCtx.base);
  const r = await forged.json('GET', '/api/admin/session', { headers: { cookie: 'ha_sid=eyJzaWQiOiJ4IiwiaWF0IjoxLCJsYXN0IjoxfQ.abc' } });
  assert.equal(r.data.authenticated, false);
  const storage2 = new DriveStorage({ clientId: 'c', clientSecret: 's', refreshToken: 'good-refresh', rootFolderId: root.id, tokenUrl: `${fake.base}/token`, apiBase: `${fake.base}/drive/v3`, uploadBase: `${fake.base}/upload/drive/v3` });
  const second = await startApp({ storage: storage2, env: { UPLOAD_MODE: 'chunk' } }); // aplikasi lain, secret sama
  const cookie = (await chunkCtx.client.raw('GET', '/api/admin/session')).status; assert.equal(cookie, 200);
  const login = await fetch(chunkCtx.base + '/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'hunter', password: (await import('./helpers.mjs')).PASSWORD }) });
  const setCookie = login.headers.get('set-cookie').split(';')[0];
  const crossInstance = await fetch(second.base + '/api/admin/session', { headers: { cookie: setCookie } });
  assert.equal((await crossInstance.json()).authenticated, true);
  await second.close();
});

test('(chunk) selesai: tutup aplikasi', async () => { await chunkCtx.close(); });
