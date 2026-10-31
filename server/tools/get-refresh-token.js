// Mengambil GOOGLE_REFRESH_TOKEN untuk akun Google pemilik folder (sekali saja).
//   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... npm run drive:token
// Gunakan OAuth Client bertipe "Desktop app". Redirect loopback http://127.0.0.1:53682 diizinkan otomatis.
import http from 'node:http';
import crypto from 'node:crypto';
import { loadEnvFile } from '../config.js';

loadEnvFile();
const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error('Isi GOOGLE_CLIENT_ID dan GOOGLE_CLIENT_SECRET (di .env atau environment) terlebih dahulu.');
  process.exit(1);
}

const port = 53682;
const redirect = `http://127.0.0.1:${port}/oauth2callback`;
const state = crypto.randomBytes(16).toString('base64url');
const verifier = crypto.randomBytes(48).toString('base64url');
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.search = new URLSearchParams({
  client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: 'https://www.googleapis.com/auth/drive',
  access_type: 'offline', prompt: 'consent', state, code_challenge: challenge, code_challenge_method: 'S256'
}).toString();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, redirect);
  if (url.pathname !== '/oauth2callback') { res.writeHead(404).end(); return; }
  const finish = (status, message) => { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }).end(message); setTimeout(() => server.close(), 200); };
  if (url.searchParams.get('state') !== state) return finish(400, 'State tidak cocok. Ulangi proses.');
  if (url.searchParams.get('error')) return finish(400, `Google menolak: ${url.searchParams.get('error')}`);
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: url.searchParams.get('code'), client_id: clientId, client_secret: clientSecret, redirect_uri: redirect, grant_type: 'authorization_code', code_verifier: verifier })
    });
    const data = await response.json();
    if (!data.refresh_token) throw new Error(data.error_description || data.error || 'Tidak ada refresh_token (cabut akses aplikasi di akun Google lalu ulangi).');
    finish(200, 'Berhasil. Kembali ke terminal dan salin GOOGLE_REFRESH_TOKEN. Tab ini boleh ditutup.');
    console.log('\nTambahkan ke .env (jangan dibagikan / jangan di-commit):\n');
    console.log(`GOOGLE_REFRESH_TOKEN=${data.refresh_token}\n`);
  } catch (error) {
    finish(500, `Gagal: ${error.message}`);
    console.error('Gagal:', error.message);
  }
});
server.listen(port, '127.0.0.1', () => {
  console.log('Buka URL ini di browser, login dengan akun Google PEMILIK folder, lalu setujui akses:\n');
  console.log(authUrl.toString(), '\n');
});
