# Panel Admin, Upload & Download — Panduan Setup

## Cara kerjanya

```
Browser publik  ──►  /api/list, /api/files/:id/download   (baca & unduh saja)
Browser admin   ──►  /api/admin/*  (login + cookie sesi + token CSRF)
                          │
                    Server Node (server/)  ──►  Google Drive (kredensial HANYA di server)
```

- Browser **tidak pernah** menerima API key, ID folder, link, atau ID file Google Drive. ID item yang tampil di URL/respons adalah ID terenkripsi.
- Setiap operasi diverifikasi bahwa target berada **di dalam folder arsip** (tidak bisa menjangkau file lain di Drive Anda).
- Hapus = **pindah ke Sampah Drive** (bisa dipulihkan 30 hari), bukan hapus permanen.
- Upload dikirim sebagai stream langsung ke Drive (tidak ditampung di memori server).

## 1. Coba dulu tanpa Google (5 menit)

```bash
npm install
cp .env.example .env            # Windows: copy .env.example .env
npm run admin:hash              # salin baris ADMIN_PASSWORD_HASH=... ke .env
# isi APP_SECRET di .env, lalu set STORAGE_BACKEND=local
npm run dev:all
```
Situs: http://localhost:5173 · Admin: http://localhost:5173/admin.html (file disimpan di `data/storage/`).

## 2. Hubungkan ke Google Drive

1. Google Cloud Console → buat/pilih project → **APIs & Services → Library → Google Drive API → Enable**.
2. **OAuth consent screen**: tipe *External*, tambahkan email Anda sebagai *Test user*, lalu **Publish app → In production**.
   Penting: selama status *Testing*, refresh token kedaluwarsa tiap 7 hari. (Untuk pemakaian pribadi, peringatan "unverified app" boleh diabaikan.)
3. **Credentials → Create credentials → OAuth client ID → Desktop app**. Salin Client ID & Client Secret ke `.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`).
4. `npm run drive:token` → buka URL yang tampil, login dengan akun **pemilik folder**, setujui. Salin `GOOGLE_REFRESH_TOKEN=...` ke `.env`.
5. Buka folder arsip di Drive, salin ID dari URL (`.../folders/<ID>`) ke `DRIVE_ROOT_FOLDER_ID`. Set `STORAGE_BACKEND=drive`.
6. **Ubah berbagi folder menjadi "Dibatasi" (Restricted)** — lihat bagian Keamanan. Server mengakses dengan akun Anda, jadi folder tidak perlu publik.

> Kenapa bukan service account? Sejak 2025 service account tidak punya kuota penyimpanan pada My Drive, sehingga upload ditolak. Refresh token akun pemilik tidak punya masalah ini dan file tetap milik Anda.

## 3. Deploy

```bash
npm install && npm run build
# set environment variable di hosting (jangan upload .env ke repo), lalu:
npm start
```
- Wajib: `NODE_ENV=production` (otomatis lewat `npm start` di Linux/macOS), `APP_SECRET`, `ADMIN_PASSWORD_HASH`, kredensial `GOOGLE_*`, `DRIVE_ROOT_FOLDER_ID`.
- Pakai HTTPS. Di belakang reverse proxy/PaaS isi `TRUST_PROXY=1`.
- Ganti `ADMIN_PATH` ke sesuatu yang tidak mudah ditebak (mis. `/gerbang-x7k2`). Halaman publik punya tombol "Admin" yang mengarah ke alamat ini, jadi alamatnya tidak benar-benar rahasia; pengamanan sebenarnya adalah login (password kuat + batas percobaan).
- Batas upload: `MAX_UPLOAD_MB` (default 200). Cek juga batas proxy/hosting Anda (mis. Nginx `client_max_body_size`, Cloudflare free = 100 MB).
- Sesi disimpan di memori: server restart = admin harus login lagi. Jalankan **satu instance** saja.

## Fitur admin

Login · buka folder · **upload file** (banyak sekaligus, drag & drop) · **upload folder** (struktur subfolder terjaga) · folder baru · ubah nama · pindahkan · hapus (satuan/massal) · unduh. Nama kembar saat upload otomatis menjadi `nama (1).ext`.

## Keamanan — checklist

- [ ] Folder Drive diset **Restricted** (bukan "Anyone with the link"). Jika masih publik, siapa pun yang tahu ID-nya bisa membukanya langsung, melewati situs.
- [ ] API key & OAuth Client ID lama yang ada di `scripts/config.js` versi sebelumnya: **hapus/rotasi** di Google Cloud Console (mereka ada di riwayat git dan di build lama `dist/`). Versi baru tidak memakainya.
- [ ] `.env` tidak masuk git (sudah di `.gitignore`). Jika `GOOGLE_*` pernah bocor, cabut di https://myaccount.google.com/permissions lalu buat ulang.
- [ ] Password admin ≥ 12 karakter (skrip `admin:hash` menegakkannya). Login dibatasi 10 percobaan gagal / 15 menit / IP.
- [ ] `APP_SECRET` tetap (jangan diganti-ganti): mengubahnya membuat ID di bookmark lama tidak valid dan logout semua sesi.

## Tes

`npm test` — 20 tes otomatis (auth, CSRF, path traversal, isolasi folder root, upload/download/Range, adapter Drive terhadap server Drive tiruan).
