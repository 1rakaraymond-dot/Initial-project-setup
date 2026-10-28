# Stage 05 — JavaScript Modules

## Navigasi folder
- Tombol **Kembali** mundur satu tingkat dari folder yang sedang dibuka.
- Breadcrumb dapat melompat ke root atau folder induk mana pun.
- `history.state.archivePath` menyimpan jalur aktif sehingga browser Back/Forward memulihkan navigasi yang tersimpan.
- Listing memakai nomor urut permintaan dan `AbortController` agar hasil request lama tidak menimpa folder yang baru dibuka.
- Tombol muat berikutnya disediakan untuk daftar folder root dan isi subfolder.

## Modul visual
- `scripts/modules/cursor.js`: custom cursor untuk pointer desktop, dinonaktifkan pada perangkat touch dan `prefers-reduced-motion`.
- `scripts/modules/parallax.js`: perubahan tilt folder berdasarkan pointer serta ambient movement berdasarkan scroll. Menggunakan `requestAnimationFrame` dan membersihkan listener pada teardown.
- `scripts/modules/scroll-reveal.js`: IntersectionObserver untuk reveal section dan daftar folder/file yang dirender dinamis.
- `scripts/modules/folder3d.js`: hierarki folder, back, breadcrumb, file list, preview/unduh, pagination dan refresh.

## Google Drive read-only
- `scripts/drive/auth.js`: Google Identity Services; access token hanya disimpan di memori JavaScript.
- `scripts/drive/api.js`: listing dengan cache TTL, pagination, download/export dan pembatalan request listing.
- `scripts/drive/mock.js`: data contoh dengan struktur yang mendekati API Drive.
- Tidak ada endpoint create/upload/rename/delete. Scope tetap `drive.readonly`.

## Pemeriksaan
- Jalankan `npm install`, `npm run build`, kemudian `npm run dev`.
- Buka `?debug=1` untuk slider parameter folder dan tes listing.
- Uji alur mock: root → folder → subfolder → tombol Kembali → breadcrumb → Segarkan.
- Uji live hanya setelah `clientId`, `rootFolderId`, origin OAuth, serta izin Drive read-only dikonfigurasi.
