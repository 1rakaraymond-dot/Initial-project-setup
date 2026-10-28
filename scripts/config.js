/** Central configuration. Tokens stay in JS memory and are never persisted to browser storage. */
export const CONFIG = Object.freeze({
  drive: {
    mode: 'public', // 'mock' | 'public' | 'live'. Public mode uses an API key and publicly shared folder; no Google login.
    clientId: '409530570667-l2bnju6jflkanlngsod59mvvmkct22d7.apps.googleusercontent.com', // Google OAuth Web client ID; public client ID only, never a client secret.
    apiKey: 'AIzaSyATvb9Ir-NowhJ2I8ta4KikU-PDenVE2_Q', // Google Drive API key for public/read-only access. Restrict it to Drive API + this site's HTTP referrers.
    rootFolderId: '1aFqORJXVm2J1f1vSsXWc2vQvaaHuC64w', // Existing Drive folder whose direct child folders appear in the explorer.
    scopes: ['https://www.googleapis.com/auth/drive.readonly'], // Used only by optional private live mode; public mode never requests OAuth.
    pageSize: 100, // Safe range: 25-100.
    cacheTTL: 60000 // In-memory metadata cache TTL; safe range: 0-300000 ms.
  },
  cursor: {
    enabled: true, // Safe range: true/false; automatically disabled for touch and reduced-motion users.
    smoothing: 0.36 // Safe range: 0.1-0.8; higher values follow the pointer more quickly.
  },
  parallax: {
    enabled: true, // Safe range: true/false.
    tiltDegrees: 2.6, // Safe range: 0-5 degrees.
    shiftPixels: 4, // Safe range: 0-8 px.
    scrollShiftPixels: 18, // Safe range: 0-30 px.
    baseStrength: 0.55, // Safe range: 0.25-1.0.
    strengthStep: 0.22 // Safe range: 0-0.35.
  },
  scrollReveal: {
    enabled: true, // Safe range: true/false.
    duration: 520, // Safe range: 200-900 ms.
    distance: 12, // Safe range: 0-24 px.
    threshold: 0.06, // Safe range: 0.01-0.25.
    rootMargin: '0px 0px -7% 0px' // Keep modest so content does not wait too long to appear.
  },
  folder3d: {
    perspective: 1200, // Safe range: 800-1200 px.
    idleTiltX: 8, // Safe range: 0-12 deg.
    idleTiltY: -4, // Safe range: -8-8 deg.
    hoverLift: 20, // Safe range: 0-30 px.
    openLift: 60, // Safe range: 20-80 px.
    openDuration: 520, // Safe range: 300-800 ms; flap and paper transition duration.
    staggerMs: 40, // Safe range: 0-100 ms between paper layers.
    dragThreshold: 7, // Safe range: 4-14 px before a pointer gesture becomes a drag.
    dragScale: 1.035, // Safe range: 1.0-1.08 visual scale while dragging.
    floatDuration: 6000 // Safe range: 4000-9000 ms.
  }
});
