# Archive requirements — revision 0.3

## Main direction

- Website berfungsi sebagai folder explorer read-only; bukan pengelola file.
- Root mock dimulai dengan tujuh folder: Projects, Design, Development, Systems, Research, Assets, Documents.
- Dalam mode live, jumlah dan nama folder mengikuti isi aktual dari `CONFIG.drive.rootFolderId`; tujuh folder adalah susunan awal yang disarankan, bukan batas maksimum.
- Folder dan nama file menjadi fokus; tidak ada teks portfolio panjang, quote blocks, atau kartu deskripsi.
- Visual menggunakan tema Bloodborne-inspired Gothic Victorian / Blood Moon, folder CSS 3D asimetris, dan motion disederhanakan pada mobile/reduced-motion settings.

## Data actions supported in website

- Browse root folder dan subfolder.
- Breadcrumb navigation, pencarian nama pada daftar termuat, pagination, dan manual refresh.
- Preview/open item ketika `webViewLink` atau preview asset tersedia.
- Download file biasa dan ekspor dokumen Google Workspace sebagai PDF bila diizinkan.
- Buka root/item asli di Google Drive bila link tersedia.
- **Tidak didukung:** buat folder, upload, rename, move, trash, atau delete dari website. Aksi-aksi itu dilakukan di Google Drive; tekan Segarkan untuk menampilkan perubahan.

## Google Drive live mode

Atur `CONFIG.drive.mode='live'`, isi `CONFIG.drive.clientId`, lalu isi `CONFIG.drive.rootFolderId` dengan ID folder yang sudah ada. Scope yang diminta adalah `https://www.googleapis.com/auth/drive.readonly`; endpoint write telah dihapus dari wrapper API. Scope ini dapat membaca dan mengunduh konten Drive dan tetap berstatus restricted oleh Google. Tinjau persyaratan verifikasi sebelum publikasi. Tidak ada client secret di frontend.

GIS token disimpan di memori saja. Token client browser meminta token lagi ketika token lama sudah tidak berlaku; ini bukan server-side authorization-code/PKCE flow.

## Navigation and motion revision 0.4

- Tombol Kembali naik satu tingkat; breadcrumb bisa melompat langsung ke tingkat mana pun.
- Browser history merekam path yang dibuka untuk mendukung Back/Forward.
- Listing bertingkat membatalkan request sebelumnya agar hasil lama tidak mengganti isi folder yang lebih baru.
- Root listing memiliki pagination sendiri; subfolder memiliki pagination file/subfolder.
- Custom cursor/parallax/scroll reveal memiliki knob di `scripts/config.js` serta fallback untuk touch dan `prefers-reduced-motion`.

## API behaviour

- Listing lazy per folder dan paginasi dengan `pageSize` maksimum 100.
- Metadata disimpan pada cache in-memory dengan TTL yang dapat diatur.
- Tombol Segarkan menghapus cache lalu membaca ulang folder aktif.
- Download file biasa melalui media endpoint; file Google Workspace diekspor menjadi PDF.
- Mock mode memuat tujuh folder dan aset contoh; tidak mendukung CRUD dan tidak mengubah Google Drive.

## Known limits

- Folder ID, OAuth Client ID, dan allowed origins perlu diisi pemilik.
- Live mode belum diverifikasi dengan akun Google nyata pada lingkungan build.
- Scope `drive.readonly` masih cukup luas (lihat/download file Drive akun yang mengizinkan akses) walaupun UI hanya menampilkan root folder konfigurasi.
- Perlu `npm install` dan browser QA sebelum deployment.
