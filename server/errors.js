/** Error yang aman ditampilkan ke klien (pesan sudah disiapkan, tidak membocorkan detail penyimpanan). */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}
