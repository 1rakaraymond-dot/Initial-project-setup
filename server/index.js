import { loadEnvFile, loadConfig, validateConfig } from './config.js';
import { createStorage } from './storage/index.js';
import { createApp } from './app.js';

loadEnvFile();
const config = loadConfig();
const { errors, warnings } = validateConfig(config);
for (const warning of warnings) console.warn(`[config] ⚠ ${warning}`);
if (errors.length) {
  for (const error of errors) console.error(`[config] ✖ ${error}`);
  process.exit(1);
}

const storage = createStorage(config);
try {
  const info = await storage.init();
  console.log(`[storage] ${storage.kind} siap (folder arsip: "${info.name}")`);
} catch (error) {
  console.error(`[storage] ✖ ${error.message}`);
  if (config.production) process.exit(1);
}

const app = createApp({ config, storage });
const server = app.listen(config.port, config.host, () => {
  console.log(`[server] http://${config.host}:${config.port}  ·  admin: ${config.adminPath}  ·  upload maks ${Math.round(config.maxUploadBytes / 1048576)} MB`);
});
// Upload besar bisa lebih lama dari batas bawaan Node (5 menit).
server.requestTimeout = 30 * 60_000;
server.headersTimeout = 60_000;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
