# Google Drive Setup — Read-only

Website ini hanya membaca metadata dan konten file yang dapat diakses akun Google pemilik token. Tambah, ubah nama, pindahkan, dan hapus item dilakukan langsung di Google Drive, bukan di website.

## 1. Siapkan Google Cloud

1. Buka Google Cloud Console, lalu buat atau pilih project.
2. Aktifkan **Google Drive API**.
3. Konfigurasikan OAuth consent screen dan isi identitas aplikasi yang diminta.
4. Buat OAuth Client ID bertipe **Web application**.
5. Tambahkan origin tempat aplikasi dijalankan ke **Authorized JavaScript origins**, misalnya `http://localhost:5173` dan domain production.
6. Salin Client ID publik ke konfigurasi aplikasi. Jangan pernah menaruh client secret di frontend.
7. Deklarasikan scope `https://www.googleapis.com/auth/drive.readonly` pada konfigurasi consent screen sesuai petunjuk Google.

## 2. Pilih folder root

1. Buat atau pilih sebuah folder di Google Drive.
2. Buat sendiri di Drive tujuh subfolder awal bila menginginkan susunan mock yang sama: `Projects`, `Design`, `Development`, `Systems`, `Research`, `Assets`, `Documents`.
3. Salin ID folder dari URL Drive, biasanya setelah `/folders/`.
4. Pastikan akun Google yang digunakan bisa melihat folder tersebut dan isi di dalamnya.

Mode live menampilkan folder aktual yang ada di dalam root ini. Jumlah folder tidak dikunci menjadi tujuh: jika kamu menambah atau menghapus folder di Drive, website akan menampilkan hasil aktual setelah disegarkan.

## 3. Konfigurasikan `scripts/config.js`

```js
export const CONFIG = Object.freeze({
  drive: {
    mode: 'live',
    clientId: 'YOUR_WEB_OAUTH_CLIENT_ID.apps.googleusercontent.com',
    apiKey: '',
    rootFolderId: 'YOUR_EXISTING_FOLDER_ID',
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    pageSize: 100,
    cacheTTL: 60000
  },
  folder3d: {
    perspective: 1200,
    idleTiltX: 8,
    idleTiltY: -4,
    hoverLift: 20,
    openLift: 60,
    staggerMs: 40,
    floatDuration: 6000
  }
});
```

Jalankan aplikasi:

```bash
npm install
npm run dev
```

Buka origin yang terdaftar, klik **Connect Google Drive**, lalu setujui izin baca saja.

## 4. Mengelola isi folder

- Untuk menambah folder atau file, lakukan melalui Google Drive.
- Untuk mengganti nama atau memindahkan file/folder, lakukan melalui Google Drive.
- Untuk menghapus, gunakan antarmuka Google Drive; website tidak melakukan operasi sampah atau delete.
- Kembali ke website dan tekan **Segarkan** agar cache metadata dibuang dan isi folder dibaca ulang.
- `Buka di Drive` membuka root folder. Tautan `Drive ↗` di daftar membuka item terkait bila Google mengembalikan `webViewLink`.
- Preview membuka tautan tampilan yang tersedia. Unduhan file biasa menggunakan media endpoint Drive; file Google Workspace diekspor sebagai PDF.

## 5. Izin dan keamanan

Scope `drive.readonly` mengizinkan aplikasi melihat dan mengunduh file Drive; scope ini tidak memberi aplikasi akses tulis, tetapi tetap luas dan tergolong **restricted** oleh Google karena cakupannya tidak hanya satu folder yang terlihat pada UI. Scope baca metadata saja (`drive.metadata.readonly`) tidak cukup untuk mendownload isi file. Lihat [panduan resmi pemilihan scope Drive API](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

Jika aplikasi sebelumnya sudah menggunakan scope penuh `drive`, cabut akses aplikasi melalui pengaturan keamanan Google Account lalu sambungkan kembali untuk meninjau persetujuan read-only yang baru. Token hanya disimpan di memori JavaScript dan tidak masuk ke localStorage atau sessionStorage.

Untuk peluncuran publik, tinjau ketentuan verifikasi OAuth dan aturan data pengguna Google sebelum meminta restricted scope. Jangan menambahkan client secret ke file frontend.

## 6. Token dan pesan error

- Token di memori, perkiraan masa berlaku satu jam.
- Setelah token tidak berlaku atau API mengembalikan 401, hubungkan ulang melalui tombol Google.
- 403: periksa akun Google, akses folder, dan scope baca yang telah disetujui.
- 404: periksa root folder ID, apakah folder sudah dipindah/dihapus, dan izin akun.
- Folder kosong atau perubahan baru yang belum terlihat: tekan `Segarkan`.

## 7. Batasan teknis

GIS token client memakai token sisi browser, bukan authorization-code flow/PKCE server-side. Ini sesuai untuk prototype personal yang berjalan di browser tetapi bukan pengganti boundary otorisasi backend untuk layanan publik multi-user. Live mode belum bisa diuji sampai pemilik mengisi Client ID, root folder ID, dan authorized origins yang benar.


## Navigasi folder

Saat folder dibuka, breadcrumb menunjukkan jalur saat ini. Tombol **Kembali** naik satu tingkat ke folder induk; klik breadcrumb mana pun untuk melompat ke tingkat yang dipilih. Browser history juga menyimpan jalur folder. Perubahan isi tetap dilakukan di Google Drive, lalu gunakan **Segarkan**.

Website memakai `drive.readonly`; endpoint tulis untuk membuat folder, upload, rename, atau menghapus tidak disediakan.


## Mode publik tanpa login (direkomendasikan untuk kebutuhan ini)

Jika website hanya perlu menampilkan dan mengunduh file tanpa identitas akun pengunjung, gunakan mode `public`. Ini hanya bekerja untuk folder yang pemiliknya sengaja bagikan sebagai **Anyone with the link / Siapa saja yang memiliki link — Viewer / Pelihat**. File di dalamnya akan dapat diakses publik; jangan gunakan untuk dokumen privat.

1. Aktifkan **Google Drive API** pada Google Cloud project.
2. Buat API key di Google Cloud Credentials. Batasi key dengan **HTTP referrers** ke domain website (untuk development, tambahkan origin localhost yang dipakai) dan batasi API ke **Google Drive API**. API key bukan rahasia seperti client secret, tetapi tetap harus dibatasi.
3. Pada Google Drive, klik kanan folder root → Bagikan → General access → Anyone with the link → Viewer. Pastikan hanya data yang memang boleh dilihat publik yang ada di folder itu.
4. Salin ID folder dari URL `https://drive.google.com/drive/folders/FOLDER_ID`.
5. Di `scripts/config.js`, atur:

```js
drive: {
  mode: 'public',
  apiKey: 'YOUR_RESTRICTED_API_KEY',
  rootFolderId: 'YOUR_PUBLIC_FOLDER_ID',
  // other existing options remain as they are
}
```

6. Jalankan `npm install` dan `npm run dev`. Tidak ada tombol login pada mode `public`; folder dibaca otomatis. Tombol **Segarkan** memuat ulang daftar.

### Batasan akses tanpa login

- Mode publik tidak dapat membaca folder privat atau file yang hanya dibagikan kepada akun tertentu. Jika file harus tetap privat, OAuth login memang diperlukan.
- Google Drive API bisa menolak akses API key untuk sebagian file/unduhan atau aturan organisasi; uji dengan folder publik sungguhan.
- Google Workspace native files diekspor sebagai PDF oleh modul unduh.
- API key yang disematkan pada frontend terlihat oleh pengunjung, jadi batasi dengan referrer dan API restriction. Jangan pernah menaruh OAuth client secret di frontend.
