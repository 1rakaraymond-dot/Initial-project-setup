import { defineConfig } from 'vite';

// Dev: `npm run dev:all` menjalankan server API (port 8787) dan Vite (5173). Permintaan /api diteruskan ke server.
export default defineConfig({
  server: {
    proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } }
  },
  build: {
    rollupOptions: { input: { main: 'index.html', admin: 'admin.html' } }
  }
});
