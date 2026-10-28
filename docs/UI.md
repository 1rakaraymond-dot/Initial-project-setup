# UI Specification — Read-only Folder Explorer

**Versi:** 0.3  
**Arah visual:** Bloodborne-inspired Gothic Victorian / Blood Moon; folder dan nama file tetap menjadi elemen dominan.

## 1. Design tokens

| Token | Nilai | Fungsi |
|---|---|---|
| `--color-ink` | `#eadfcf` | Teks ivory dan foreground utama |
| `--color-paper` | `#100d0f` | Latar arang |
| `--color-paper-bright` | `#d9c9aa` | Lapisan vellum/kertas tua |
| `--color-paper-dim` | `#21181b` | Surface gelap saat hover |
| `--color-metal` | `#a3917d` | Metadata sekunder |
| `--color-blood` | `#78202c` | Burgundy folder |
| `--color-blood-bright` | `#a23842` | Crimson highlight |
| `--color-brass` | `#b49a68` | Trim, hover, dan focus |
| `--color-line` | `#443135` | Pemisah burgundy-abu |
| `--color-line-strong` | `#80644e` | Border kontrol bernuansa kuningan |
| `--font-display` | `Cinzel`, fallback serif | Judul arsip dan nama folder |
| `--font-body` | `Cormorant Garamond`, fallback serif | Teks editorial |
| `--font-mono` | System monospace | Nomor folder, tipe file, status |
| `--perspective` | `1200px` | Kedalaman objek CSS 3D |
| `--folder-idle-tilt-x` | `8deg` | Kemiringan idle |
| `--folder-idle-tilt-y` | `-4deg` | Rotasi samping idle |
| `--folder-hover-lift` | `20px` | Elevasi hover/focus |
| `--page-gutter` | `clamp(24px, 5vw, 88px)` | Gutter utama |
| `--space-1..10` | `4px..144px` | Skala spacing |

## 2. Layout

- **Header:** sticky, wordmark, indikator mode, dan koneksi Drive.
- **Heading:** `Archive.` singkat dengan hitungan folder yang dibaca aktual.
- **Toolbar:** breadcrumb, tautan `Buka di Drive` untuk root yang dipilih, dan tombol `Segarkan`.
- **Folder stage:** grid 12 kolom asimetris pada desktop; nama folder lebih dominan daripada metadata.
- **Folder tile:** objek CSS 3D dirangkai dari tab, paper layer, body, edge, dan shadow. Hanya aksi navigasi internal dan tautan Drive yang ditampilkan.
- **File view:** daftar baris, bukan kartu. Kolom nama, tipe/ukuran, dan aksi baca (`Preview`, `Unduh`, `Drive ↗`).
- **Status region:** teks ringan untuk koneksi, refresh, izin, loading, dan empty state.
- Tidak ada form/dialog pembuatan folder, upload, rename, atau delete karena perubahan dilakukan di Google Drive.

## 3. Typography scale

| Peran | Nilai | Penggunaan |
|---|---|---|
| Archive display | `clamp(48px, 9vw, 108px)` | Judul halaman |
| Folder name | `clamp(19px, 2.1vw, 29px)` desktop | Nama folder |
| Folder name mobile | `20px` | Label folder |
| File name | `13px` | Daftar item |
| UI utility | `12–13px` | Breadcrumb dan kontrol |
| Metadata | `8–10px` | Serial, ukuran, tipe, status |

## 4. Spacing dan bentuk

Rhythm memakai kelipatan empat dengan anchor 8 px. Toolbar dan daftar dibuat rapat; folder stage memiliki whitespace lebih lebar. Radius kontrol tetap persegi atau hampir persegi. Folder memakai lacquer burgundy, trim kuningan, bayangan berat, dan grain halus. File sheets memakai warna vellum tua; UI tidak memakai kumpulan card bulat dengan shadow blur generik.

## 5. Anatomy komponen

### Folder tile

1. Shadow radial mengikuti elevasi.
2. Lapisan vellum tua yang menyembul.
3. Tab terpisah dengan `transform-origin` di bagian bawah.
4. Body folder monokrom dengan grain SVG.
5. Edge tipis untuk ilusi kedalaman.
6. Nomor serial, nama folder, dan tautan Drive bila tersedia.
7. Seluruh tile membuka folder di explorer; tautan Drive adalah kontrol terpisah, bukan button bersarang.

### File row

- Glyph tipe berbasis teks pendek, bukan emoji.
- Nama file adalah teks paling kuat dalam baris.
- Metadata hanya jenis dan ukuran.
- `Preview` dan `Unduh` bersifat baca saja; `Drive ↗` membuka item asli jika link tersedia.
- Tidak ada kontrol edit atau hapus di website.

### Toolbar

- Breadcrumb untuk navigasi internal.
- `Buka di Drive` membuka root Google Drive di tab baru.
- `Segarkan` mengosongkan cache listing dalam memori dan meminta data baru.

## 6. Breakpoint behaviour

| Breakpoint | Perilaku |
|---|---|
| 375 px | Grid dua kolom; folder lebih kecil; tombol toolbar dapat menggunakan lebar penuh; daftar file bertumpuk |
| 768 px | Grid enam kolom dengan posisi folder asimetris; toolbar boleh wrap |
| 1280 px | Grid 12 kolom broken/asimetris; hover lift penuh |
| 1920 px | Lebar konten dibatasi token `--content-max`; whitespace meningkat tanpa membesarkan teks berlebihan |

## 7. Motion dan aksesibilitas

- Idle float sekitar 6 detik, hover lift singkat, tidak ada animasi seragam pada semua section.
- `prefers-reduced-motion` menonaktifkan float/transform transisi; folder tetap dapat dibuka.
- Focus ring jelas dan tidak bergantung pada warna hover.
- Status jaringan dan error memakai live region.
- Kontras utama menggunakan ink/paper; metadata memakai warna sekunder yang tetap terbaca.
- Semua tautan eksternal Drive memakai `noopener noreferrer`.

## 8. Ketersediaan font

Headline memakai Cinzel dan teks editorial memakai Cormorant Garamond dari Google Fonts. Jika font eksternal tidak tersedia, browser menggunakan fallback serif lokal. Folder dan detail objek dibuat dengan CSS, sehingga tidak memerlukan library 3D tambahan.


## Toolbar revisi 0.4

Toolbar menempatkan tombol **Kembali** di samping breadcrumb ketika lokasi bukan root. Breadcrumb dapat membungkus di mobile dan nama folder panjang dipotong secara visual tanpa mengubah nama asli. Tombol refresh dan tautan Drive berada pada kelompok aksi terpisah. Tombol pagination root muncul setelah rak 3D, sedangkan pagination isi folder muncul di bawah daftar file.

## Detail interaksi

- Fokus keyboard tetap memakai focus ring bawaan; custom cursor hanya dekoratif dan tidak menggantikan fokus.
- Hover folder mengangkat objek 3D; parallax memakai pointer position yang dinormalisasi ke sekitar titik tengah rak.
- Reveal konten diaktifkan oleh IntersectionObserver; item dinamis baru diamati melalui MutationObserver.
- Pada `prefers-reduced-motion`, reveal dibuat langsung terlihat dan rotasi/float folder dinonaktifkan.


## Tema Blood Moon / Gothic Victorian

- Background arang: `--color-paper: #100d0f`.
- Teks ivory: `--color-ink: #eadfcf`.
- Aksen blood burgundy: `--color-blood: #78202c`; highlight merah: `--color-blood-bright: #a23842`.
- Kuningan kusam: `--color-brass: #b49a68`; kertas vellum: `--color-vellum: #d9c9aa`.
- Ambient red haze, lingkaran ukiran yang sangat subtil, dan grain dibuat dengan CSS; tidak membutuhkan gambar atau aset resmi game.
- Folder: lacquer burgundy dengan pinggiran kuningan, berkas: vellum/kertas tua, nama folder tetap menjadi fokus utama.
- Teks antarmuka tetap ringkas. Tema tidak menambahkan kutipan panjang, lore dump, atau kontrol pengelolaan file ke UI.
