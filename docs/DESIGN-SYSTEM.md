# Design System — Archive Folder Explorer

## Theme presets

Tema dipusatkan di `styles/tokens.css`; ubah token dan nilai UI akan mengikuti. Tiga preset warna untuk iterasi visual:

| Preset | Background | Foreground | Accent | Penggunaan |
|---|---|---|---|---|
| Blood Moon (current) | `#100d0f` | `#eadfcf` | `#78202c` / `#b49a68` | Gothic Victorian: arang, darah gelap, vellum, kuningan kusam |
| Darkroom | `#0f0f0f` | `#e4e3de` | `#555550` | Kontras minimum, tanpa cahaya merah |
| Warm Archive | `#f0ede5` | `#262520` | `#716d62` | Mode terang alternatif |

Gunakan `--color-paper`, `--color-ink`, `--color-metal`, `--color-blood`, `--color-brass`, `--color-line`, dan `--color-paper-bright` sebagai kelompok inti. Atmosfer merah tua dan tekstur grain dibuat via CSS di `styles/components/ambient.css`; hindari menyebarkan warna brand di component CSS.

## Configuration panel

| Knob | Lokasi | Fungsi | Rentang aman |
|---|---|---|---|
| `drive.mode` | `scripts/config.js` | `mock` atau `live` | Salah satu dari dua string |
| `drive.clientId` | `scripts/config.js` | Google OAuth Web client ID | Client ID dari Google Cloud |
| `drive.rootFolderId` | `scripts/config.js` | Root folder Drive yang ditampilkan | ID folder yang dapat dibaca akun |
| `drive.scopes` | `scripts/config.js` | OAuth scope baca/unduh | Pertahankan `drive.readonly` untuk perilaku read-only |
| `drive.pageSize` | `scripts/config.js` | Ukuran halaman listing | 25–100 |
| `drive.cacheTTL` | `scripts/config.js` | TTL cache metadata | 0–300000 ms |
| `folder3d.perspective` | `scripts/config.js` | Perspektif objek folder | 800–1200 px |
| `folder3d.idleTiltX` | `scripts/config.js` | Tilt idle horizontal | 0–12° |
| `folder3d.idleTiltY` | `scripts/config.js` | Tilt idle samping | -8–8° |
| `folder3d.hoverLift` | `scripts/config.js` | Lift ketika hover/focus | 0–30 px |
| `folder3d.openLift` | `scripts/config.js` | Lift saat aksi buka | 20–80 px |
| `folder3d.floatDuration` | `scripts/config.js` | Durasi float | 4000–9000 ms |
| `cursor.enabled` | `scripts/config.js` | Aktif/nonaktif custom cursor | `true` / `false` |
| `cursor.smoothing` | `scripts/config.js` | Respons custom cursor | 0.1–0.8 |
| `parallax.enabled` | `scripts/config.js` | Aktif/nonaktif parallax | `true` / `false` |
| `parallax.tiltDegrees` | `scripts/config.js` | Rotasi berbasis pointer | 0–5° |
| `parallax.shiftPixels` | `scripts/config.js` | Jarak geser folder saat pointer bergerak | 0–8 px |
| `parallax.scrollShiftPixels` | `scripts/config.js` | Pergeseran ambient saat scroll | 0–30 px |
| `scrollReveal.enabled` | `scripts/config.js` | Aktif/nonaktif reveal section | `true` / `false` |
| `scrollReveal.duration` | `scripts/config.js` | Durasi reveal | 200–900 ms |
| `scrollReveal.distance` | `scripts/config.js` | Jarak reveal | 0–24 px |
| `scrollReveal.threshold` | `scripts/config.js` | Ambang IntersectionObserver | 0.01–0.25 |

Buka `/?debug=1` untuk slider perspective/tilt/lift, toggle mock/live, dan tombol `Test Drive fetch`. Panel ini hanya untuk pengembangan dan tidak menggantikan pengaturan kredensial.

## Component anatomy

- **Folder tile:** tab, paper, body, edge, shadow, serial, nama folder, dan tautan Drive bila tersedia.
- **File row:** glyph tipe, nama, tipe/ukuran, preview/download, dan tautan Drive jika tersedia.
- **Toolbar:** tombol Kembali ke parent, breadcrumb dinamis, buka root di Drive, refresh daftar, dan pagination terpisah untuk root/subfolder.
- **Status region:** koneksi, hasil refresh, izin, empty state, dan error.

Tidak tersedia form buat folder, upload, rename, trash, atau delete. Pengguna melakukan perubahan lewat Google Drive.

## Ubah kecepatan animasi

Untuk mengubah gerak folder, ubah `folder3d.hoverLift` atau `folder3d.floatDuration` di `scripts/config.js`; saat development buka `/?debug=1` untuk menguji perspektif dan lift. `prefers-reduced-motion` tetap dihormati.
