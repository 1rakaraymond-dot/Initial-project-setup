import { CONFIG } from '../config.js';

let tokenClient;
let accessToken = '';
let tokenExpiresAt = 0;
let pendingRequest = null;
let scriptPromise;

function loadGIS() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => window.google?.accounts?.oauth2
      ? resolve()
      : reject(new Error('Google Identity Services belum tersedia.'));
    script.onerror = () => reject(new Error('Library Google Identity Services gagal dimuat. Periksa koneksi atau pemblokir skrip.'));
    document.head.append(script);
  });
  return scriptPromise;
}

function requestToken(prompt = '') {
  if (pendingRequest) return pendingRequest;
  pendingRequest = new Promise(async (resolve, reject) => {
    try {
      await loadGIS();
      if (!CONFIG.drive.clientId) throw new Error('Isi CONFIG.drive.clientId di scripts/config.js sebelum mengaktifkan Drive live.');
      tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: CONFIG.drive.clientId,
        scope: CONFIG.drive.scopes.join(' '),
        include_granted_scopes: false,
        callback: response => {
          if (response.error || !response.access_token) {
            accessToken = '';
            tokenExpiresAt = 0;
            reject(new Error(response.error_description || response.error || 'Google tidak memberikan token akses.'));
            return;
          }
          accessToken = response.access_token;
          tokenExpiresAt = Date.now() + (Number(response.expires_in || 3600) * 1000) - 60000;
          resolve(accessToken);
        },
        error_callback: error => reject(new Error(error?.message || 'Popup Google ditutup atau tidak dapat dibuka.'))
      });
      tokenClient.requestAccessToken({ prompt });
    } catch (error) {
      reject(error);
    }
  }).finally(() => { pendingRequest = null; });
  return pendingRequest;
}

export const driveAuth = {
  async connect() { return requestToken(''); },
  async getAccessToken() {
    if (accessToken && Date.now() < tokenExpiresAt) return accessToken;
    return requestToken('');
  },
  disconnect() { accessToken = ''; tokenExpiresAt = 0; },
  isConnected() { return Boolean(accessToken && Date.now() < tokenExpiresAt); }
};
