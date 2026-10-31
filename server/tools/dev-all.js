// Menjalankan server API (8787) dan Vite (5173) sekaligus untuk pengembangan.
// Memakai node langsung (tanpa shell) agar aman di Windows meski path mengandung spasi.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { PROJECT_ROOT } from '../config.js';

const vite = path.join(PROJECT_ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const run = args => spawn(process.execPath, args, { cwd: PROJECT_ROOT, stdio: 'inherit' });
const children = [run(['server/index.js']), run([vite])];
const stop = () => children.forEach(c => c.kill());
for (const c of children) c.on('exit', stop);
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
console.log('Dev: situs http://localhost:5173  ·  admin http://localhost:5173/admin.html');
