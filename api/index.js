// Entry point Vercel: mengekspor aplikasi Express sebagai Serverless Function.
// Halaman statis (dist/) disajikan oleh CDN Vercel, bukan oleh Express.
import { loadConfig, validateConfig } from '../server/config.js';
import { createStorage } from '../server/storage/index.js';
import { createApp } from '../server/app.js';

const config = loadConfig(process.env);
const { errors, warnings } = validateConfig(config);
warnings.forEach(w => console.warn(`[config] ${w}`));

let handler;
if (errors.length) {
  errors.forEach(e => console.error(`[config] ${e}`));
  handler = (req, res) => {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Server belum dikonfigurasi dengan benar. Periksa Environment Variables di Vercel.' }));
  };
} else {
  handler = createApp({ config, storage: createStorage(config), distDir: null });
}

export default handler;
