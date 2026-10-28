# UX Specification — Read-only Folder Explorer

**Versi:** 0.3  
**Tujuan:** website hanya menampilkan isi folder Google Drive. Semua perubahan data dilakukan langsung di Google Drive.

## 1. Prinsip produk

- Folder dan nama file adalah fokus utama; tidak ada kutipan, bagian About panjang, atau kartu deskripsi proyek.
- Landing page menampilkan tujuh folder pada mode mock. Dalam mode live, jumlah serta nama folder mengikuti isi aktual dari root folder Google Drive yang dipilih.
- Website tidak membuat folder, tidak mengunggah file, tidak mengubah nama, dan tidak memindahkan item ke sampah.
- Pengguna mengubah isi Drive di Google Drive, lalu menekan **Segarkan** di website untuk membaca data terbaru.
- Website tetap menyediakan navigasi subfolder, pencarian nama file, pagination, preview/buka, unduhan yang didukung, dan tautan langsung ke Drive.

## 2. User flow

```text
Buka website
  ├─ Mode mock → lihat 7 folder contoh dan isi contoh
  │    └─ klik folder → lihat daftar file → preview / unduh
  └─ Mode live
       ├─ Connect Google Drive
       ├─ persetujuan izin baca saja
       ├─ baca folder ID yang sudah ditentukan di config
       ├─ folder dan nama file dirender dari Drive
       ├─ buka subfolder / preview / unduh
       ├─ Buka di Drive → pengguna mengubah item langsung di Drive
       └─ kembali ke website → Segarkan → data terbaru dimuat
```

## 3. Wireframe

```text
┌───────────────────────────────────────────────────────────────┐
│ A. ARCHIVE                     MOCK MODE / DRIVE READ-ONLY     │
│                                               [Connect Drive]  │
├───────────────────────────────────────────────────────────────┤
│ PERSONAL WORKSPACE                                07 FOLDERS   │
│ Archive.                                                       │
│ Isi folder, tanpa lapisan yang tidak diperlukan.               │
├───────────────────────────────────────────────────────────────┤
│ Archive / Folder / Subfolder                   [Buka di Drive] │
│                                                 [Segarkan]     │
│                                                               │
│      [FOLDER 01]              [FOLDER 02]                      │
│  Projects                    Design             [FOLDER 03]    │
│                                             Development        │
│                [FOLDER 04]      [FOLDER 05]                    │
│                Systems          Research                       │
│       [FOLDER 06]                 [FOLDER 07]                  │
│       Assets                     Documents                     │
│                                                               │
│ Status / izin / loading / empty state                          │
└───────────────────────────────────────────────────────────────┘
```

Saat folder dibuka, objek folder diganti daftar file ringkas:

```text
Archive / Projects / Research            [Cari nama file]
NAMA                                JENIS / UKURAN        AKSI
DIR  Research Notes                 FOLDER                Buka · Drive ↗
PDF  Field notes.pdf                PDF · 1.2 MB          Preview · Unduh · Drive ↗
DOC  Project brief                  GOOGLE FILE           Preview · Unduh · Drive ↗
[ Muat file berikutnya ]
```

## 4. State matrix

| Komponen | Default | Hover/focus | Active/loading | Error | Empty |
|---|---|---|---|---|---|
| Koneksi Drive | Tombol Connect Google Drive | Latar sedikit lebih tegas; focus ring terlihat | Tombol dinonaktifkan selama OAuth | Pesan spesifik di status region | Konfigurasi memberi tahu field yang perlu diisi |
| Folder 3D | Kemiringan halus, nama jelas | Lift kecil dan bayangan melebar | Klik membuka subfolder | Status menyatakan kegagalan membaca isi folder | `Folder belum tersedia. Tambahkan atau atur folder langsung di Google Drive, lalu pilih Segarkan.` |
| Breadcrumb | Archive / nama folder | Tautan sedikit lebih gelap | Klik kembali ke bagian hierarki | Status error jika data tidak bisa dimuat | Selalu menyediakan jalan kembali ke root |
| File row | Nama, tipe/ukuran, aksi baca | Nama/aksi diberi underline | Tombol aksi dinonaktifkan ketika request berlangsung | Pesan unduh/preview gagal | `Folder ini kosong. Tambahkan atau hapus item di Google Drive, lalu pilih Segarkan.` |
| Pencarian | Placeholder `Cari nama file` | Border lebih tegas | Filter lokal pada daftar termuat | Tidak perlu request jaringan | `Tidak ada item dengan nama tersebut.` |
| Segarkan | Tombol baca ulang | Hover halus | Dinonaktifkan selama request | Pesan error tetap terlihat; tidak ditimpa pesan sukses | Daftar kosong tetap menampilkan petunjuk edit lewat Drive |
| Buka di Drive | Tautan eksternal hanya ketika URL Drive tersedia | Underline | Membuka tab baru | Bila link tidak tersedia, tautan tidak dirender | Tidak ada aksi eksternal bila tidak tersedia |
| Load more | Muncul jika ada `nextPageToken` | Border lebih kontras | Meminta halaman berikutnya | Item yang telah dimuat tetap ada | Tidak dirender ketika tidak ada token |

## 5. Copywriting final

- Koneksi: `Connect Google Drive`, `Reconnect Drive`.
- Mode: `MOCK MODE`, `DRIVE LIVE`, `DRIVE READ-ONLY`.
- Toolbar: `Buka di Drive`, `Segarkan`.
- Empty root: `Folder belum tersedia. Tambahkan atau atur folder langsung di Google Drive, lalu pilih Segarkan.`
- Empty subfolder: `Folder ini kosong. Tambahkan atau hapus item di Google Drive, lalu pilih Segarkan.`
- Search kosong: `Tidak ada item dengan nama tersebut.`
- Berhasil konek: `Google Drive terhubung dalam mode baca saja. Kelola file langsung di Drive, lalu tekan Segarkan untuk memuat perubahan.`
- Berhasil refresh: `Daftar dimuat ulang dari Google Drive. Perubahan yang dibuat di Drive akan tampil di sini.`
- Izin gagal: `Google menolak akses baca. Pastikan akun yang benar memiliki akses ke folder dan izin Drive read-only telah disetujui.`
- Sesi habis: `Sesi Google Drive berakhir. Klik Hubungkan ulang untuk melanjutkan.`
- Folder ID belum diisi: `Isi CONFIG.drive.rootFolderId di scripts/config.js untuk mode live.`

## 6. Interaksi dan aksesibilitas

- Folder dibuka lewat elemen `<button>` native, dapat digunakan dengan keyboard.
- Breadcrumb, tombol, input, dan tautan memakai elemen semantik.
- Status koneksi, hasil refresh, dan error diumumkan melalui `aria-live="polite"`.
- Tidak menggunakan `alert()` atau `window.confirm()`.
- `prefers-reduced-motion` menonaktifkan float dan transisi gerak folder, sementara navigasi tetap bekerja.
- Tautan Drive dibuka dengan `target="_blank"` dan `rel="noopener noreferrer"` serta hanya dirender untuk domain Drive/Docs yang diizinkan.
- Token akses hanya berada di memori JavaScript; tidak disimpan di `localStorage` atau `sessionStorage`.

## 7. Perilaku data

- Root mock dimulai dengan tujuh folder: Projects, Design, Development, Systems, Research, Assets, Documents.
- Mode live menampilkan folder aktual di dalam `CONFIG.drive.rootFolderId`. Website tidak membuat struktur folder otomatis.
- Mode live memakai scope OAuth `drive.readonly`; tidak ada endpoint tulis yang diekspos oleh wrapper API.
- Pengguna menambah, memindahkan, mengganti nama, atau menghapus file/folder melalui Google Drive itu sendiri.
- Tombol Segarkan membatalkan cache metadata dalam memori dan membaca ulang folder yang sedang dibuka.
- Preview membuka `webViewLink` bila tersedia; file biasa diunduh melalui media endpoint; Google Workspace file diekspor sebagai PDF.
- Mock merupakan data contoh yang tidak disinkronkan dan tidak berubah saat reload.

## 8. Batasan yang diketahui

- Folder ID aktual dan OAuth Client ID harus diisi pemilik proyek.
- Live mode tidak bisa diverifikasi terhadap akun Google sampai kredensial tersebut disediakan.
- Scope `drive.readonly` masih termasuk restricted scope karena dapat membaca dan mengunduh banyak file Drive pemilik akun; jangan memublikasikan aplikasi tanpa meninjau kebutuhan verifikasi dan kebijakan data Google.
- Build browser dan visual QA harus dijalankan dengan dependensi proyek terpasang.


## Tahap 5 — Navigasi dan interaksi folder

- **Kembali:** tombol di toolbar naik satu tingkat, tidak mengubah Drive.
- **Breadcrumb:** tiap segmen merupakan tombol navigasi; `Archive` selalu kembali ke root folder yang dikonfigurasi.
- **Browser Back/Forward:** path folder disimpan di `history.state`, agar navigasi dapat dipulihkan.
- **Loading/navigation:** request listing sebelumnya dibatalkan ketika pengguna berpindah folder dengan cepat. Pesan status membedakan membuka folder, kosong, akses ditolak, dan sesi perlu dihubungkan ulang.
- **Pagination:** daftar root dan daftar subfolder memiliki tombol muat berikutnya masing-masing.
- **Motion:** custom cursor dan parallax aktif pada pointer presisi; `prefers-reduced-motion` dan perangkat touch memakai tampilan statis yang tetap fungsional.
