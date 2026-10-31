import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DriveStorage } from '../server/storage/drive.js';
import { startApp } from './helpers.mjs';
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
