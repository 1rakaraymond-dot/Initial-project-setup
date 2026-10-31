import crypto from 'node:crypto';

/**
 * ID item yang dikirim ke browser dienkripsi (AES-256-GCM, IV sintetis dari HMAC) sehingga:
 *  - tidak ada ID Google Drive asli yang terlihat di browser/URL,
 *  - klien tidak bisa memalsukan ID untuk menjangkau file di luar folder arsip,
 *  - ID tetap deterministik (bookmark/riwayat browser tetap valid selama APP_SECRET sama).
 */
export function createIdCodec(secret) {
  const derive = info => Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secret), Buffer.from('hunters-archive'), Buffer.from(info), 32));
  const encKey = derive('id-encryption');
  const ivKey = derive('id-iv');
  const TOKEN = /^[A-Za-z0-9_-]{30,1024}$/;

  return {
    encode(id) {
      const plain = Buffer.from(String(id), 'utf8');
      const iv = crypto.createHmac('sha256', ivKey).update(plain).digest().subarray(0, 12);
      const cipher = crypto.createCipheriv('aes-256-gcm', encKey, iv);
      const body = Buffer.concat([cipher.update(plain), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
    },
    decode(token) {
      if (typeof token !== 'string' || !TOKEN.test(token)) return null;
      try {
        const raw = Buffer.from(token, 'base64url');
        if (raw.length < 29) return null;
        const decipher = crypto.createDecipheriv('aes-256-gcm', encKey, raw.subarray(0, 12));
        decipher.setAuthTag(raw.subarray(12, 28));
        return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
      } catch {
        return null;
      }
    }
  };
}

/** Menyegel objek kecil (mis. sesi upload) menjadi token buram: AES-256-GCM dengan IV acak + kedaluwarsa. */
export function createSealer(secret) {
  const key = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secret), Buffer.from('hunters-archive'), Buffer.from('sealed-tokens'), 32));
  return {
    seal(object, ttlMs) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(JSON.stringify({ ...object, exp: Date.now() + ttlMs })), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
    },
    open(token) {
      if (typeof token !== 'string' || token.length < 40 || token.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
      try {
        const raw = Buffer.from(token, 'base64url');
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
        decipher.setAuthTag(raw.subarray(12, 28));
        const data = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8'));
        return data.exp > Date.now() ? data : null;
      } catch {
        return null;
      }
    }
  };
}
